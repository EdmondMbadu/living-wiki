// Read-only board access plus normal translation calls. Uncached languages use the existing provider.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, getDoc, doc, terminate } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { CONTENT_LANGUAGES } from '../functions/lib/content-language.js';

const [boardId, languageList = 'es', output] = process.argv.slice(2);
assert.match(boardId ?? '', /^[A-Za-z0-9_-]{8,128}$/, 'Provide a board ID, language codes and optional report path.');
const languages = languageList.split(',');
assert(languages.every((language) => CONTENT_LANGUAGES.some(({id}) => id === language)), 'Choose supported language codes.');
const runtime = { window: {} };
runInNewContext(await readFile(new URL('../public/runtime-config.js', import.meta.url), 'utf8'), runtime);
const config = runtime.window.__LIVING_ATLAS_CONFIG__?.firebase;
assert.equal(config?.projectId, 'living-atlas-7622a');
const app = initializeApp(config, 'translation-timing');
const db = getFirestore(app);
const callable = httpsCallable(getFunctions(app, 'us-central1'), 'translateBoard', {timeout:300_000});
const report = { boardId, measuredAt: new Date().toISOString(), runs: [] };
try {
  const board = (await getDoc(doc(db, 'boards', boardId))).data();
  assert(board && ['public','unlisted'].includes(board.visibility), 'Use a public/link-readable board.');
  for (const language of languages) {
    for (let pass = 1; pass <= 2; pass++) {
      const started = performance.now();
      let firstTextMs = null;
      let chunks = 0;
      const response = await callable.stream({boardId, targetLanguage:language});
      void response.data.catch(() => undefined);
      for await (const chunk of response.stream) {
        if (chunk.segments?.length) { firstTextMs ??= Math.round(performance.now() - started); chunks++; }
      }
      const result = await response.data;
      const completeMs = Math.round(performance.now() - started);
      assert.equal(result.segments.length, result.expectedSegmentCount);
      const run = {language, pass, cached:result.cached, firstTextMs:firstTextMs ?? completeMs,
        completeMs, chunks, segments:result.segments.length};
      report.runs.push(run);
      console.log(JSON.stringify(run));
    }
  }
  if (output) await writeFile(output, JSON.stringify(report, null, 2)+'\n');
} finally { await terminate(db); await deleteApp(app); }
