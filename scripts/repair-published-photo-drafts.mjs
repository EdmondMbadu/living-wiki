#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const apply = process.argv.includes('--apply');
admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'living-atlas-7622a' });
const db = admin.firestore();

// Only clear stale flags on boards already public. Never change visibility or cards.
const snapshots = await db.collection('boards').where('photoStudioDraft', '==', true)
  .select('title', 'visibility', 'photoStudioDraft').get();
const affected = snapshots.docs.filter((snapshot) => snapshot.data().visibility === 'public');
console.log(JSON.stringify({ apply, affected: affected.map((snapshot) => ({ id: snapshot.id, title: snapshot.data().title })) }));
for (const snapshot of affected) {
  if (!apply) continue;
  await snapshot.ref.update({
    photoStudioDraft: false,
    server_updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { lastUpdateTime: snapshot.updateTime });
  console.log(JSON.stringify({ repaired: snapshot.id }));
}
await admin.app().delete();
