import { randomUUID, createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { geminiApiKey, translateBoardTextSegments } from './gemini';
import { BOARD_TRANSLATION_SCHEMA_VERSION, isBoardTranslationLanguage, extractBoardTranslationSource, boardTranslationSegmentsComplete } from './board-translation';
import { liveCardTranslationSource, liveCardTranslationCacheId, readyLiveCardTranslation } from './live-card-translation';

export const translateLiveCard = onCall({ region: 'us-central1', cors: true, timeoutSeconds: 120,
  memory: '512MiB', concurrency: 8, maxInstances: 10, secrets: [geminiApiKey] }, async (request) => {
  const boardId = String(request.data?.boardId ?? '');
  const cardId = String(request.data?.cardId ?? '');
  const language = request.data?.targetLanguage;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(boardId) || (cardId && !/^[A-Za-z0-9_-]{1,160}$/.test(cardId)) || !isBoardTranslationLanguage(language)) {
    throw new HttpsError('invalid-argument', 'Choose a valid card and language.');
  }
  const board = (await db.collection('boards').doc(boardId).get()).data();
  if (!board) throw new HttpsError('not-found', 'This board could not be found.');
  const isOwner = !!request.auth?.uid && board['owner_user_id'] === request.auth.uid;
  if (!['public', 'unlisted'].includes(board['visibility']) && !isOwner && request.auth?.token?.['admin'] !== true) {
    throw new HttpsError('permission-denied', 'This board is private.');
  }
  let source;
  try { source = liveCardTranslationSource(board, cardId); }
  catch { throw new HttpsError('not-found', 'This card is not available in Live view.'); }
  const cacheRef = db.collection('board_card_translations').doc(liveCardTranslationCacheId(boardId, language, cardId));
  const response = (segments: typeof source.segments, cached: boolean) => ({ boardId, cardId, targetLanguage: language,
    sourceLanguage: source.sourceLanguage, fingerprint: source.fingerprint, schemaVersion: BOARD_TRANSLATION_SCHEMA_VERSION,
    expectedSegmentCount: segments.length, segments, cached,
    changed: segments.some((segment, index) => segment.text !== source.segments[index]?.text) });
  const existing = (await cacheRef.get()).data();
  if (readyLiveCardTranslation(existing, source)) return response(existing.segments, true);

  // A valid whole-board cache can satisfy this request without provider work.
  const whole = (await db.collection('board_translations').doc(createHash('sha256').update(`${boardId}:${language}`).digest('hex')).get()).data();
  let reused: typeof source.segments | null = null;
  if (whole?.['status'] === 'ready') {
    try {
      const fullSource = extractBoardTranslationSource(board);
      if (whole['fingerprint'] === fullSource.fingerprint && boardTranslationSegmentsComplete(fullSource.segments, whole['segments'])) {
        const byKey = new Map(whole['segments'].map((segment) => [segment.key, segment]));
        const selected = source.segments.map((segment) => byKey.get(segment.key));
        if (selected.every((segment) => !!segment)) reused = selected as typeof source.segments;
      }
    } catch { /* Large boards still support individual cards. */ }
  }
  const token = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const value = (await tx.get(cacheRef)).data();
    if (readyLiveCardTranslation(value, source)) return false;
    if (value?.['status'] === 'generating' && value['fingerprint'] === source.fingerprint && value['lease_expires_at_ms'] > Date.now()) return false;
    tx.set(cacheRef, { board_id: boardId, card_id: cardId, target_language: language,
      fingerprint: source.fingerprint, status: 'generating', lease_token: token,
      lease_expires_at_ms: Date.now() + 125_000, updated_at: FieldValue.serverTimestamp() });
    return true;
  });
  if (!acquired) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const value = (await cacheRef.get()).data();
      if (readyLiveCardTranslation(value, source)) return response(value.segments, true);
      if (value?.['fingerprint'] !== source.fingerprint || value['status'] !== 'generating') break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new HttpsError('aborted', 'This card translation is still being prepared.');
  }
  try {
    if (!reused && source.segments.length) {
      const visitorId = String(request.data?.anonymousVisitorId ?? '');
      const actor = request.auth?.uid || `${request.rawRequest.ip}:${/^[A-Za-z0-9_-]{8,128}$/.test(visitorId) ? visitorId : String(request.rawRequest.headers['user-agent'] ?? '').slice(0, 240)}`;
      const quota = db.collection('live_translation_limits').doc(createHash('sha256').update(actor).digest('hex'));
      await db.runTransaction(async (tx) => {
        const value = (await tx.get(quota)).data();
        const reset = !value || Date.now() - value['started'] >= 30 * 60_000;
        const count = reset ? 0 : Number(value['count'] || 0);
        const characters = reset ? 0 : Number(value['characters'] || 0);
        if (count >= (request.auth ? 300 : 120) || characters + source.sourceCharacters > (request.auth ? 1_000_000 : 300_000)) {
          throw new HttpsError('resource-exhausted', 'Translation is temporarily busy. Please try again later.');
        }
        tx.set(quota, { started: reset ? Date.now() : value!['started'], count: count + 1, characters: characters + source.sourceCharacters });
      });
    }
    const started = Date.now();
    const segments = reused ?? await translateBoardTextSegments(source.segments, language);
    const committed = await db.runTransaction(async (tx) => {
      const current = (await tx.get(cacheRef)).data();
      if (current?.['lease_token'] !== token) return false;
      tx.set(cacheRef, { status: 'ready', segments, lease_token: FieldValue.delete(), lease_expires_at_ms: 0,
        updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!committed) throw new HttpsError('aborted', 'The card changed while translation was preparing.');
    logger.info('Live card translation ready.', { boardId, cardId, language, durationMs: Date.now() - started, reused: !!reused });
    return response(segments, !!reused);
  } catch (error) {
    await db.runTransaction(async (tx) => {
      if ((await tx.get(cacheRef)).data()?.['lease_token'] === token) tx.set(cacheRef, {
        status: 'error', lease_token: FieldValue.delete(), lease_expires_at_ms: 0,
      }, { merge: true });
    });
    logger.error('Live card translation failed.', { boardId, cardId, language, errorMessage: error instanceof Error ? error.message : String(error) });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', 'We could not translate this card right now. Please try again.');
  }
});
