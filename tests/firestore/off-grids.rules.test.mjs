import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-living-wiki',
    firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'off_grid_spots/private'), {
      ownerUid: 'owner',
      creatorUid: 'friend',
      visibility: 'private',
      status: 'active',
    });
    await setDoc(doc(db, 'off_grid_spots/private/pin_talks/pending'), {
      contributorUid: 'friend',
      approval: 'pending',
    });
    await setDoc(doc(db, 'public_off_grid_spots/public'), { title: 'Public preview' });
  });
});
after(async () => {
  await env?.cleanup();
});
test('private gems are readable/listable only by their owner', async () => {
  for (const c of [
    env.unauthenticatedContext(),
    env.authenticatedContext('stranger'),
    env.authenticatedContext('friend'),
  ])
    await assertFails(getDoc(doc(c.firestore(), 'off_grid_spots/private')));
  const db = env.authenticatedContext('owner').firestore();
  await assertSucceeds(getDoc(doc(db, 'off_grid_spots/private')));
  await assertSucceeds(
    getDocs(query(collection(db, 'off_grid_spots'), where('ownerUid', '==', 'owner'))),
  );
  await assertFails(getDocs(collection(db, 'off_grid_spots')));
});
test('only owner and contributor can read pending clip records; neither can bypass callables to approve', async () => {
  for (const uid of ['owner', 'friend'])
    await assertSucceeds(
      getDoc(
        doc(env.authenticatedContext(uid).firestore(), 'off_grid_spots/private/pin_talks/pending'),
      ),
    );
  for (const c of [env.unauthenticatedContext(), env.authenticatedContext('stranger')])
    await assertFails(getDoc(doc(c.firestore(), 'off_grid_spots/private/pin_talks/pending')));
  await assertFails(
    setDoc(
      doc(
        env.authenticatedContext('friend').firestore(),
        'off_grid_spots/private/pin_talks/pending',
      ),
      { approval: 'approved' },
    ),
  );
});
test('full gems and previews cannot be forged or crawled by clients', async () => {
  const db = env.authenticatedContext('owner').firestore();
  await assertFails(
    setDoc(doc(db, 'off_grid_spots/new'), { ownerUid: 'owner', visibility: 'public' }),
  );
  await assertFails(setDoc(doc(db, 'public_off_grid_spots/new'), { title: 'Fake' }));
  await assertFails(
    getDocs(collection(env.unauthenticatedContext().firestore(), 'public_off_grid_spots')),
  );
});
test('saves are scoped to their user and reject arbitrary embedded private data', async () => {
  const db = env.authenticatedContext('owner').firestore();
  await assertSucceeds(
    setDoc(doc(db, 'users/owner/saved_off_grid_spots/private'), {
      createdAt: new Date().toISOString(),
    }),
  );
  await assertSucceeds(getDocs(collection(db, 'users/owner/saved_off_grid_spots')));
  await assertFails(
    getDocs(
      collection(
        env.authenticatedContext('stranger').firestore(),
        'users/owner/saved_off_grid_spots',
      ),
    ),
  );
  await assertFails(
    setDoc(doc(db, 'users/owner/saved_off_grid_spots/leak'), {
      createdAt: 'now',
      tip: 'private text',
    }),
  );
  await assertSucceeds(deleteDoc(doc(db, 'users/owner/saved_off_grid_spots/private')));
});
