// Explicit live verification: calls translation and speech generation for one public board.
// This may generate billable translation/audio; it never edits the authored board.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, doc, getDoc, terminate } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const boardId = process.argv[2];
if (!/^[A-Za-z0-9_-]{8,128}$/.test(boardId ?? '')) {
  throw new Error('Usage: node scripts/verify-board-language-live.mjs BOARD_ID [REPORT_PATH]');
}
const runtime = { window: {} };
runInNewContext(await readFile(new URL('../public/runtime-config.js', import.meta.url), 'utf8'), runtime);
const config = runtime.window.__LIVING_ATLAS_CONFIG__?.firebase;
assert.equal(config?.projectId, 'living-atlas-7622a', 'Verify the intended production project.');
const app = initializeApp(config, 'board-language-verification');
const firestore = getFirestore(app);
const functions = getFunctions(app, 'us-central1');
const report = [];
const languages = process.argv[4]?.split(',') ?? ['es', 'fr', 'ja', 'pt', 'en', 'de', 'zh'];
assert(languages.length && languages.every(language => ['en', 'es', 'fr', 'ja', 'pt', 'de', 'zh'].includes(language)));
try {
  const snapshot = await getDoc(doc(firestore, 'boards', boardId));
  assert(snapshot.exists(), 'Public board must exist and be readable.');
  const board = snapshot.data();
  assert(['public', 'unlisted'].includes(board.visibility));
  const card = board.cards.find(card => !card.authorOnly && (card.tour?.guideScript || card.notes || card.shortSummary || card.subtitle));
  assert(card, 'The board must have a narrated public card.');
  const field = card.tour?.guideScript ? 'tour.guideScript' : card.notes ? 'notes' : card.shortSummary ? 'shortSummary' : 'subtitle';
  const originalText = card.tour?.guideScript || card.notes || card.shortSummary || card.subtitle;
  const translate = httpsCallable(functions, 'translateBoard', { timeout: 300_000 });
  const speech = httpsCallable(functions, 'synthesizeChatAnswerSpeech', { timeout: 120_000 });
  for (const language of languages) {
    try {
      const { data: translation } = await translate({ boardId, targetLanguage: language });
      assert.equal(translation.boardId, boardId);
      assert.equal(translation.targetLanguage, language);
      assert.equal(translation.segments.length, translation.expectedSegmentCount);
      const text = translation.segments.find(segment => segment.key === `cardsById.${card.id}.${field}`)?.text;
      assert(text, `Translated ${field} must be present.`);
      if (language !== translation.sourceLanguage) assert.notEqual(text, originalText);
      const requestedText = text.slice(0, 4000);
      const { data: audio } = await speech({
        boardId, cardId: card.id, text: requestedText, mode: 'tour',
        narratorVoiceId: board.stackNarratorVoiceId || null, contentLanguage: language,
        anonymousVisitorId: 'livingwiki-board-language-verification',
      });
      assert.equal(audio.provider, 'elevenlabs');
      // Speech normalization removes display punctuation/Markdown. The spoken words must match.
      const spokenWords = value => value.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      assert.equal(spokenWords(audio.speechText), spokenWords(requestedText));
      assert(audio.audioUrl, 'Provider audio must be available.');
      const response = await fetch(audio.audioUrl, { headers: { Range: 'bytes=0-127' } });
      assert(response.ok, `Audio download returned ${response.status}.`);
      assert.match(response.headers.get('content-type') ?? '', /audio\/mpeg/);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(bytes.length > 10, 'Audio must not be empty.');
      const mp3 = new TextDecoder().decode(bytes.slice(0, 3)) === 'ID3'
        || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
      assert(mp3, 'Audio must contain an MP3 header.');
      const result = { language, passed: true, segments: translation.segments.length,
        title: translation.segments.find(segment => segment.key === 'board.title')?.text,
        speechCharacters: requestedText.length, voiceId: audio.voiceId,
        cachedTranslation: translation.cached, cachedAudio: audio.cached };
      report.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      const result = { language, passed: false, error: error.message, code: error.code };
      report.push(result);
      console.error(JSON.stringify(result));
    }
  }
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({ boardId, report }, null, 2));
  assert(report.every(result => result.passed), 'At least one live narration language failed.');
} finally {
  await terminate(firestore);
  await deleteApp(app);
}
