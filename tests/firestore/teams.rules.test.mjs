import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
} from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-living-wiki',
    firestore: { rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'teams', 'team-a'), { status: 'active', owner_id: 'owner', name: 'A' }),
      setDoc(doc(db, 'teams', 'team-b'), { status: 'active', owner_id: 'other', name: 'B' }),
      setDoc(doc(db, 'teams', 'team-a', 'members', 'owner'), {
        status: 'active',
        role: 'admin',
        email: 'private@example.com',
      }),
      setDoc(doc(db, 'teams', 'team-a', 'members', 'member'), { status: 'active', role: 'member' }),
      setDoc(doc(db, 'teams', 'team-b', 'members', 'other'), { status: 'active', role: 'admin' }),
      setDoc(doc(db, 'users', 'platform'), { role: 'admin' }),
      setDoc(doc(db, 'team_boards', 'listing'), {
        id: 'listing',
        team_id: 'team-a',
        visibility: 'private',
        cards: [{ notes: 'private work' }],
      }),
      setDoc(doc(db, 'boards', 'listing'), {
        id: 'listing',
        team_id: 'team-a',
        owner_user_id: 'team:team-a',
        visibility: 'public',
        cards: [{ notes: 'approved content' }],
      }),
      setDoc(doc(db, 'public_team_pages', 'team-a'), { id: 'team-a', name: 'A' }),
      setDoc(doc(db, 'users', 'member', 'team_memberships', 'team-a'), {
        teamId: 'team-a',
        status: 'active',
      }),
    ]);
  });
});
test('accepted members read team working copies; visitors, other teams, and uninvited platform admins do not', async () => {
  for (const uid of ['owner', 'member'])
    await assertSucceeds(
      getDoc(doc(env.authenticatedContext(uid).firestore(), 'team_boards', 'listing')),
    );
  for (const uid of ['other', 'pending', 'platform'])
    await assertFails(
      getDoc(doc(env.authenticatedContext(uid).firestore(), 'team_boards', 'listing')),
    );
  await assertFails(
    getDoc(doc(env.unauthenticatedContext().firestore(), 'team_boards', 'listing')),
  );
});
test('public callers receive only public snapshots, never private collections', async () => {
  const db = env.unauthenticatedContext().firestore();
  const snapshot = await assertSucceeds(getDoc(doc(db, 'boards', 'listing')));
  assert.equal(snapshot.data().cards[0].notes, 'approved content');
  await assertSucceeds(getDoc(doc(db, 'public_team_pages', 'team-a')));
  for (const path of [
    'team_invitations',
    'team_contacts',
    'team_conversations',
    'team_participants',
    'team_published_configs',
    'team_voice_sessions',
  ])
    await assertFails(getDoc(doc(db, path, 'listing')));
});
test('server-owned team records cannot be forged even by platform admins', async () => {
  for (const uid of ['owner', 'member', 'platform']) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, 'teams', 'fake-team'), { owner_id: uid }));
    await assertFails(updateDoc(doc(db, 'team_boards', 'listing'), { cards: [] }));
    await assertFails(updateDoc(doc(db, 'boards', 'listing'), { visibility: 'private' }));
    await assertFails(deleteDoc(doc(db, 'boards', 'listing')));
    await assertFails(
      setDoc(doc(db, 'users', uid, 'team_memberships', 'team-b'), { role: 'admin' }),
    );
    await assertFails(
      setDoc(doc(db, 'teams', 'team-a', 'members', uid), { status: 'active', role: 'admin' }),
    );
  }
});
test('a forged team field cannot ride a legacy full-board owner update', async () => {
  await env.withSecurityRulesDisabled(async (context) =>
    setDoc(doc(context.firestore(), 'boards', 'legacy-team'), {
      id: 'legacy-team',
      owner_user_id: 'owner',
      team_id: 'team-a',
      visibility: 'public',
      title: 'Legacy',
      cards: [],
    }),
  );
  await assertFails(
    updateDoc(doc(env.authenticatedContext('owner').firestore(), 'boards', 'legacy-team'), {
      visibility: 'private',
    }),
  );
});
test('removed memberships revoke working-copy access even if the sidebar index is stale', async () => {
  await env.withSecurityRulesDisabled(async (context) =>
    updateDoc(doc(context.firestore(), 'teams', 'team-a', 'members', 'member'), {
      status: 'removed',
    }),
  );
  const db = env.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(db, 'users', 'member', 'team_memberships', 'team-a')));
  await assertFails(getDoc(doc(db, 'team_boards', 'listing')));
  await assertFails(
    getDocs(query(collection(db, 'team_boards'), where('team_id', '==', 'team-a'))),
  );
});
test('member directory email records are not exposed to ordinary teammates', async () => {
  const db = env.authenticatedContext('member').firestore();
  await assertFails(getDoc(doc(db, 'teams', 'team-a', 'members', 'owner')));
  await assertSucceeds(getDoc(doc(db, 'teams', 'team-a', 'members', 'member')));
});
