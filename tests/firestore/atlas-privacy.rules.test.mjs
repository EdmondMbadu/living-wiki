import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-living-wiki',
    firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'atlases/private-avatar'), {
      name: 'Private avatar', user_id: 'avatar-owner', is_public: false, wiki_type: 'person',
      admin_user_ids: ['avatar-admin'], persona_prompt: 'Private working notes',
    });
    await setDoc(doc(db, 'atlases/public-avatar'), {
      name: 'Public avatar', user_id: 'another-owner', is_public: true, wiki_type: 'person',
    });
  });
});

after(async () => { await environment?.cleanup(); });

test('anonymous and signed-in visitors can query the public directory and avatar library', async () => {
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('visitor')]) {
    const db = context.firestore();
    await assertSucceeds(getDoc(doc(db, 'atlases/public-avatar')));
    for (const filters of [
      [where('is_public', '==', true)],
      [where('is_public', '==', true), where('wiki_type', '==', 'person')],
    ]) {
      const result = await assertSucceeds(getDocs(query(collection(db, 'atlases'), ...filters)));
      assert.deepEqual(result.docs.map((document) => document.id), ['public-avatar']);
    }
  }
});

test('the owner can still open and list private avatars', async () => {
  const db = environment.authenticatedContext('avatar-owner').firestore();
  await assertSucceeds(getDoc(doc(db, 'atlases/private-avatar')));
  const result = await assertSucceeds(getDocs(query(collection(db, 'atlases'), where('user_id', '==', 'avatar-owner'))));
  assert.deepEqual(result.docs.map((document) => document.id), ['private-avatar']);
});

test('an assigned admin can still open and list shared private avatars', async () => {
  const db = environment.authenticatedContext('avatar-admin').firestore();
  await assertSucceeds(getDoc(doc(db, 'atlases/private-avatar')));
  const result = await assertSucceeds(getDocs(query(collection(db, 'atlases'), where('admin_user_ids', 'array-contains', 'avatar-admin'))));
  assert.deepEqual(result.docs.map((document) => document.id), ['private-avatar']);
});

test('other visitors cannot retrieve private avatars through direct reads or collection queries', async () => {
  for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('visitor')]) {
    const db = context.firestore();
    await assertFails(getDoc(doc(db, 'atlases/private-avatar')));
    await assertFails(getDocs(collection(db, 'atlases')));
    for (const filter of [
      where('user_id', '==', 'avatar-owner'),
      where('name', '==', 'Private avatar'),
      where('is_public', '==', false),
      where('wiki_type', '==', 'person'),
      where('admin_user_ids', 'array-contains', 'avatar-admin'),
    ]) {
      await assertFails(getDocs(query(collection(db, 'atlases'), filter)));
    }
  }
});
