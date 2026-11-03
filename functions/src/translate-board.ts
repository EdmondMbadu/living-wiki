import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { isLinkReadableVisibility } from './board-visibility';
import { isOriginalEnglish } from './board-translation-source';
import { geminiApiKey, translateBoardTextSegments } from './board-translation-provider';
import { BOARD_TRANSLATION_SCHEMA_VERSION, boardTranslationSegmentsComplete, extractBoardTranslationSource, isBoardTranslationLanguage, type BoardTranslationLanguage, type BoardTranslationSegment } from './board-translation';
const callableRegion = 'us-central1';
const stringOrEmpty = (value: unknown): string => typeof value === 'string' ? value : '';

export const translateBoard = onCall(
  {
    region: callableRegion,
    cors: true,
    timeoutSeconds: 300,
    memory: '1GiB',
    concurrency: 8,
    maxInstances: 10,
    secrets: [geminiApiKey],
  },
  async (request, response) => {
    const boardId = stringOrEmpty(request.data?.boardId).trim();
    const targetLanguage = request.data?.targetLanguage;
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(boardId) || !isBoardTranslationLanguage(targetLanguage)) {
      throw new HttpsError('invalid-argument', 'Choose a valid board and translation language.');
    }

    const boardSnapshot = await db.collection('boards').doc(boardId).get();
    if (!boardSnapshot.exists) {
      throw new HttpsError('not-found', 'This board could not be found.');
    }
    const board = boardSnapshot.data() as Record<string, unknown>;
    const ownerUserId = stringOrEmpty(board['owner_user_id']);
    const isOwner = !!request.auth?.uid && request.auth.uid === ownerUserId;
    const isAdmin = request.auth?.token?.['admin'] === true;
    if (!isLinkReadableVisibility(board['visibility']) && !isOwner && !isAdmin) {
      throw new HttpsError('permission-denied', 'This board is private.');
    }

    let source;
    try {
      source = extractBoardTranslationSource(board);
    } catch (error) {
      throw new HttpsError(
        'resource-exhausted',
        error instanceof Error ? error.message : 'This board is too large to translate.',
      );
    }
    if (!source.segments.length || (targetLanguage === 'en' && isOriginalEnglish(source.segments))) {
      return {
        boardId,
        targetLanguage,
        sourceLanguage: source.sourceLanguage,
        fingerprint: source.fingerprint,
        schemaVersion: BOARD_TRANSLATION_SCHEMA_VERSION,
        expectedSegmentCount: source.segments.length,
        segments: source.segments,
        cached: true,
        changed: false,
      };
    }

    const cacheId = createHash('sha256')
      .update(`${boardId}:${targetLanguage}`)
      .digest('hex');
    const cacheRef = db.collection('board_translations').doc(cacheId);
    const cached = await cacheRef.get();
    const cachedData = cached.data() as Record<string, unknown> | undefined;
    if (cached.exists
      && cachedData?.['status'] === 'ready'
      && cachedData['fingerprint'] === source.fingerprint
      && boardTranslationSegmentsComplete(source.segments, cachedData['segments'])) {
      return boardTranslationCallableResponse(
        boardId,
        targetLanguage,
        source.sourceLanguage,
        source.fingerprint,
        source.segments.length,
        cachedData['segments'],
        true,
        cachedData['changed'] === true,
      );
    }

    const leaseToken = randomUUID();
    const now = Date.now();
    const leaseExpiresAt = now + 5 * 60 * 1000;
    const acquired = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(cacheRef);
      const value = snapshot.data() as Record<string, unknown> | undefined;
      if (value?.['status'] === 'ready' && value['fingerprint'] === source.fingerprint
        && boardTranslationSegmentsComplete(source.segments, value['segments'])) {
        return 'ready';
      }
      const existingLease = typeof value?.['lease_expires_at_ms'] === 'number'
        ? value['lease_expires_at_ms']
        : 0;
      if (value?.['status'] === 'generating'
        && value['fingerprint'] === source.fingerprint
        && existingLease > now) {
        return 'wait';
      }
      transaction.set(cacheRef, {
        board_id: boardId,
        target_language: targetLanguage,
        source_language: source.sourceLanguage,
        fingerprint: source.fingerprint,
        status: 'generating',
        partial_segments: [],
        lease_token: leaseToken,
        lease_expires_at_ms: leaseExpiresAt,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return 'acquired';
    });

    if (acquired === 'ready') {
      const ready = await cacheRef.get();
      return boardTranslationCallableResponse(
        boardId,
        targetLanguage,
        source.sourceLanguage,
        source.fingerprint,
        source.segments.length,
        ready.data()?.['segments'],
        true,
        ready.data()?.['changed'] === true,
      );
    }
    const progressResponse = (segments: BoardTranslationSegment[]) => ({
      ...boardTranslationCallableResponse(boardId, targetLanguage, source.sourceLanguage, source.fingerprint,
        segments.length, segments, false, segments.some((segment) => source.segments.find((item) => item.key === segment.key)?.text !== segment.text)),
      totalSegmentCount: source.segments.length,
    });
    const emit = async (segments: BoardTranslationSegment[]) => {
      if (request.acceptsStreaming && response && !response.signal?.aborted) {
        // A disconnected viewer must not discard work that can serve the next visitor.
        await response.sendChunk(progressResponse(segments)).catch(() => false);
      }
    };
    if (acquired === 'wait') {
      let emitted = 0;
      for (let attempt = 0; attempt < 120; attempt++) {
        const ready = await cacheRef.get();
        const value = ready.data() as Record<string, unknown> | undefined;
        if (value?.['fingerprint'] !== source.fingerprint) break;
        if (value['status'] === 'ready' && boardTranslationSegmentsComplete(source.segments, value['segments'])) {
          return boardTranslationCallableResponse(boardId, targetLanguage, source.sourceLanguage, source.fingerprint,
            source.segments.length, value['segments'], true, value['changed'] === true);
        }
        if (value['status'] !== 'generating') break;
        const partial = value['partial_segments'];
        if (Array.isArray(partial) && partial.length > emitted) {
          const subset = source.segments.filter((segment) => partial.some((item) => item?.key === segment.key));
          if (boardTranslationSegmentsComplete(subset, partial)) { await emit(partial); emitted = partial.length; }
        }
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      throw new HttpsError('aborted', 'This translation is still being prepared. Please try again.');
    }

    try {
      await consumeBoardTranslationQuota(request, source.sourceCharacters);
      await emit([]);
      const progress = new Map<string, BoardTranslationSegment>();
      let progressWrite = Promise.resolve();
      const segments = await translateBoardTextSegments(source.segments, targetLanguage, (batch) => {
        progressWrite = progressWrite.then(async () => {
          for (const segment of batch) progress.set(segment.key, segment);
          const partial = source.segments.flatMap((segment) => progress.has(segment.key) ? [progress.get(segment.key)!] : []);
          const current = await db.runTransaction(async (tx) => {
            const value = (await tx.get(cacheRef)).data();
            if (value?.['lease_token'] !== leaseToken || value['fingerprint'] !== source.fingerprint) return false;
            tx.update(cacheRef, {partial_segments: partial});
            return true;
          });
          if (current) await emit(partial);
        });
        return progressWrite;
      });
      const changed = segments.some(
        (segment, index) => segment.text !== source.segments[index]?.text,
      );
      const committed = await db.runTransaction(async (tx) => {
        const value = (await tx.get(cacheRef)).data();
        if (value?.['lease_token'] !== leaseToken || value['fingerprint'] !== source.fingerprint) return false;
        tx.set(cacheRef, {
        board_id: boardId,
        target_language: targetLanguage,
        source_language: source.sourceLanguage,
        fingerprint: source.fingerprint,
        status: 'ready',
        segments,
        changed,
        source_characters: source.sourceCharacters,
        lease_token: FieldValue.delete(),
        lease_expires_at_ms: 0,
        generated_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        partial_segments: FieldValue.delete(),
      }, { merge: true });
        return true;
      });
      if (!committed) throw new HttpsError('aborted', 'The board changed while translation was preparing.');
      return boardTranslationCallableResponse(
        boardId,
        targetLanguage,
        source.sourceLanguage,
        source.fingerprint,
        source.segments.length,
        segments,
        false,
        changed,
      );
    } catch (error) {
      logger.error('Board translation failed.', {
        boardId,
        targetLanguage,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await db.runTransaction(async (tx) => {
        if ((await tx.get(cacheRef)).data()?.['lease_token'] === leaseToken) {
          tx.update(cacheRef, {status: 'error', lease_token: FieldValue.delete(), lease_expires_at_ms: 0,
            partial_segments: FieldValue.delete(), updated_at: FieldValue.serverTimestamp()});
        }
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'We could not translate this board right now. Please try again.');
    }
  },
);

async function consumeBoardTranslationQuota(
  request: CallableRequest<unknown>,
  sourceCharacters: number,
): Promise<void> {
  const uid = request.auth?.uid ?? '';
  const forwardedFor = stringOrEmpty(request.rawRequest.headers['x-forwarded-for']).split(',')[0]?.trim() ?? '';
  const userAgent = stringOrEmpty(request.rawRequest.headers['user-agent']).slice(0, 240);
  const actor = uid || `${forwardedFor}:${userAgent}`;
  const actorHash = createHash('sha256').update(actor || 'anonymous').digest('hex');
  const quotaRef = db.collection('board_translation_limits').doc(actorHash);
  const windowMs = 30 * 60 * 1000;
  const maximumRequests = uid ? 30 : 10;
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(quotaRef);
    const value = snapshot.data() as Record<string, unknown> | undefined;
    const windowStartedAt = typeof value?.['window_started_at_ms'] === 'number'
      ? value['window_started_at_ms']
      : 0;
    const count = typeof value?.['count'] === 'number' ? value['count'] : 0;
    const reset = now - windowStartedAt >= windowMs;
    if (!reset && count >= maximumRequests) {
      throw new HttpsError(
        'resource-exhausted',
        'You have translated several boards recently. Please try again in a little while.',
      );
    }
    transaction.set(quotaRef, {
      window_started_at_ms: reset || !windowStartedAt ? now : windowStartedAt,
      count: reset ? 1 : count + 1,
      source_characters: FieldValue.increment(sourceCharacters),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

function boardTranslationCallableResponse(
  boardId: string,
  targetLanguage: BoardTranslationLanguage,
  sourceLanguage: BoardTranslationLanguage,
  fingerprint: string,
  expectedSegmentCount: number,
  value: unknown,
  cached: boolean,
  changed: boolean,
): {
  boardId: string;
  targetLanguage: BoardTranslationLanguage;
  sourceLanguage: BoardTranslationLanguage;
  fingerprint: string;
  schemaVersion: number;
  expectedSegmentCount: number;
  segments: BoardTranslationSegment[];
  cached: boolean;
  changed: boolean;
} {
  const segments = Array.isArray(value)
    ? value.flatMap((item) => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const key = stringOrEmpty(record['key']).slice(0, 256);
        const text = stringOrEmpty(record['text']).slice(0, 16_000);
        return key && text ? [{ key, text }] : [];
      })
    : [];
  if (segments.length !== expectedSegmentCount) {
    throw new HttpsError('unavailable', 'This board translation is incomplete. Please try again.');
  }
  return {
    boardId, targetLanguage, sourceLanguage, fingerprint,
    schemaVersion: BOARD_TRANSLATION_SCHEMA_VERSION,
    expectedSegmentCount, segments, cached, changed,
  };
}

