#!/usr/bin/env node
// One-time inventory may scan boards. The user-facing directory never does.
const projectId = process.env.GCLOUD_PROJECT || 'living-atlas-7622a';
const providerFile = require('node:path').join(__dirname, '../.env.' + projectId);
if (!process.env.OFF_GRID_WHAT3WORDS_KEY && require('node:fs').existsSync(providerFile)) {
  const match = require('node:fs')
    .readFileSync(providerFile, 'utf8')
    .match(/^OFF_GRID_WHAT3WORDS_KEY=(.*)$/m);
  if (match) process.env.OFF_GRID_WHAT3WORDS_KEY = match[1].trim();
}
process.env.GCLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});
const { db } = require('../lib/firebase');
const { isOffGridCard, validCoordinates, sourceSpotId } = require('../lib/off-grids/model');
const { resolveWords } = require('../lib/off-grids/location');
const { syncOffGridBoard } = require('../lib/off-grids/source');
const apply = process.argv.includes('--apply');
const offGridOnly = process.argv.includes('--off-grid-only');
(async () => {
  const audit = {
    mode: apply ? 'apply' : 'dry-run',
    boardsScanned: 0,
    eligibleBoards: 0,
    cards: 0,
    privateCards: 0,
    located: 0,
    wordsOnly: 0,
    missingLocation: 0,
    missingId: 0,
    legacyVideos: 0,
    spots: 0,
    publicPreviews: 0,
    repairNeeded: 0,
    failures: [],
  };
  let cursor = null;
  do {
    let q = db
      .collection('boards')
      .orderBy('__name__')
      .select(
        'kind',
        'cards',
        'visibility',
        'owner_user_id',
        'owner_name',
        'owner_display_name',
        'author_name',
        'created_at_iso',
        'updated_at_iso',
      )
      .limit(100);
    if (offGridOnly) q = q.where('kind', '==', 'off-grid');
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    for (const doc of page.docs) {
      audit.boardsScanned++;
      const b = doc.data(),
        cards = (Array.isArray(b.cards) ? b.cards : []).filter((c) => c && isOffGridCard(b, c));
      if (!cards.length) continue;
      audit.eligibleBoards++;
      let updates = new Map();
      for (const c of cards) {
        audit.cards++;
        if (b.visibility !== 'public' || c.authorOnly) audit.privateCards++;
        if (!c.id) audit.missingId++;
        if (c.talkDrop?.url) audit.legacyVideos++;
        if (validCoordinates(c.locationLat ?? c.tour?.lat, c.locationLng ?? c.tour?.lng))
          audit.located++;
        else if (c.what3wordsAddress) {
          audit.wordsOnly++;
          if (apply) {
            try {
              const p = await resolveWords(c.what3wordsAddress);
              updates.set(c.id, { lat: p.lat, lng: p.lng });
            } catch {
              audit.failures.push({ boardId: doc.id, cardId: c.id, reason: 'words-unresolved' });
            }
          }
        } else audit.missingLocation++;
      }
      if (apply) {
        if (updates.size)
          await db.runTransaction(async (tx) => {
            const latest = await tx.get(doc.ref),
              data = latest.data();
            if (!data) return;
            const cards = data.cards.map((c) =>
              updates.has(c.id) && !validCoordinates(c.locationLat, c.locationLng)
                ? { ...c, locationLat: updates.get(c.id).lat, locationLng: updates.get(c.id).lng }
                : c,
            );
            tx.update(doc.ref, { cards });
          });
        await syncOffGridBoard(doc.id);
      }
    }
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  if (apply) {
    const spots = await db.collection('off_grid_spots').get(),
      previews = await db.collection('public_off_grid_spots').get();
    audit.spots = spots.docs.filter((d) => d.data().status !== 'deleted').length;
    audit.publicPreviews = previews.size;
    audit.repairNeeded = spots.docs.filter((d) => d.data().status === 'needs-location').length;
  }
  console.log(JSON.stringify(audit, null, 2));
  if (audit.failures.length) process.exitCode = 2;
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
