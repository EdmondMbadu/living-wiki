import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';

process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase');
const { kiwiApply, kiwiPreferences, kiwiTalk } = require('./lib/kiwi');

const call = (fn, uid, data = {}) => fn.run({ data,
  ...(uid ? { auth: { uid, token: { email: `${uid}@example.com`, email_verified: true } } } : {}),
  rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'Kiwi integration tests' } },
});
const proposal = (uid, proposalId, action, details = {}) => db.doc(`users/${uid}/kiwi_actions/${proposalId}`).set({
  action, teamId: '', boardId: '', baseUpdatedAt: '', baseRevision: 0,
  createdAt: Date.now(), expiresAt: Date.now() + 900_000, status: 'pending',
  resultBoardId: `result-${proposalId}`, ...details,
});

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Kiwi tests must use the Firestore emulator.'));
beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`, { method: 'DELETE' });
});
after(async () => { await db.terminate(); });

test('visitors cannot get a Kiwi name, talk, or apply an action', async () => {
  await assert.rejects(call(kiwiPreferences, null), /Sign in/);
  await assert.rejects(call(kiwiTalk, null, { message: 'Hello' }), /Sign in/);
  await assert.rejects(call(kiwiApply, null, { proposalId: 'anything' }), /Sign in/);
});

test('the assistant name belongs only to the signed-in account', async () => {
  assert.equal((await call(kiwiPreferences, 'alice')).name, 'Kiwi');
  assert.equal((await call(kiwiPreferences, 'alice', { operation: 'setName', name: 'Pip' })).name, 'Pip');
  assert.equal((await call(kiwiPreferences, 'alice')).name, 'Pip');
  assert.equal((await call(kiwiPreferences, 'bob')).name, 'Kiwi');
});

test('Kiwi creates a personal board once and does not expose private boards without a plan', async () => {
  await db.doc('users/alice').set({ displayName: 'Alice', role: 'user' });
  const photo = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tea.jpg/1400px-Tea.jpg';
  const create = { kind: 'create_board', title: 'Garden plan', description: 'Spring planting',
    visibility: 'public', tone: 'green', cards: [{ title: 'Seed ideas', subtitle: '', notes: '', type: 'idea', imageUrl: photo, imageSource: 'generated' }] };
  await proposal('alice', 'create-one', create);
  assert.deepEqual(await call(kiwiApply, 'alice', { proposalId: 'create-one' }), { boardId: 'result-create-one', applied: true });
  assert.deepEqual(await call(kiwiApply, 'alice', { proposalId: 'create-one' }), { boardId: 'result-create-one', applied: true });
  const board = (await db.doc('boards/result-create-one').get()).data();
  assert.equal(board.owner_user_id, 'alice');
  assert.equal(board.cards.length, 1);
  assert.equal(board.cards[0].imageUrl, photo);
  assert.deepEqual(board.cards[0].imageUrls, [photo]);
  assert.equal(board.cards[0].imageSource, 'generated');
  assert.equal(board.imageUrl, photo);
  assert.equal(board.visibility, 'public');
  await proposal('alice', 'private-one', { ...create, visibility: 'private' });
  await assert.rejects(call(kiwiApply, 'alice', { proposalId: 'private-one' }), /eligible plan/);
  assert.equal((await db.doc('boards/result-private-one').get()).exists, false);
  await proposal('alice', 'empty-one', { ...create, cards: [] });
  await assert.rejects(call(kiwiApply, 'alice', { proposalId: 'empty-one' }), /at least one card/);
});

test('Kiwi cannot edit another person’s board and rejects stale personal edits', async () => {
  await db.doc('users/alice').set({ displayName: 'Alice' });
  await db.doc('users/bob').set({ displayName: 'Bob' });
  await db.doc('boards/board-a').set({ id: 'board-a', owner_user_id: 'alice',
    visibility: 'public', title: 'Alice board', cards: [], updated_at_iso: 'before' });
  await proposal('bob', 'attack', { kind: 'update_board', boardId: 'board-a', title: 'Stolen' },
    { boardId: 'board-a', resultBoardId: 'board-a', baseUpdatedAt: 'before' });
  await assert.rejects(call(kiwiApply, 'bob', { proposalId: 'attack' }), /Only the owner/);
  assert.equal((await db.doc('boards/board-a').get()).data().title, 'Alice board');
  await proposal('alice', 'stale', { kind: 'update_board', boardId: 'board-a', title: 'New title' },
    { boardId: 'board-a', resultBoardId: 'board-a', baseUpdatedAt: 'older' });
  await assert.rejects(call(kiwiApply, 'alice', { proposalId: 'stale' }), /changed after Kiwi/);
});

test('team edits require current membership and use team revision history', async () => {
  await db.doc('users/alice').set({ displayName: 'Alice' });
  await db.doc('teams/team-a').set({ id: 'team-a', name: 'Garden Team', logo_url: '', status: 'active', listing_count: 1 });
  await db.doc('teams/team-a/members/alice').set({ uid: 'alice', role: 'member', status: 'active' });
  const board = { id: 'team-board', team_id: 'team-a', team_revision: 1,
    team_status: 'draft', title: 'Team board', cards: [], visibility: 'private',
    owner_user_id: 'team:team-a', updated_at_iso: 'before' };
  await db.doc('team_boards/team-board').set(board);
  await db.doc('team_boards/team-board/revisions/1').set(board);
  await proposal('alice', 'team-change', { kind: 'add_card', boardId: 'team-board',
    card: { title: 'Planting schedule', subtitle: '', notes: '', type: 'idea' } },
    { teamId: 'team-a', boardId: 'team-board', resultBoardId: 'team-board', baseRevision: 1 });
  await call(kiwiApply, 'alice', { proposalId: 'team-change' });
  const saved = (await db.doc('team_boards/team-board').get()).data();
  assert.equal(saved.cards.length, 1);
  assert.equal(saved.team_revision, 2);
  assert.equal(saved.visibility, 'private');
  assert.equal((await db.doc('team_boards/team-board/revisions/2').get()).exists, true);
  assert.deepEqual(await call(kiwiApply, 'alice', { proposalId: 'team-change' }), { boardId: 'team-board', applied: true });
  await db.doc('teams/team-a/members/alice').update({ status: 'removed' });
  await proposal('alice', 'after-removal', { kind: 'update_board', boardId: 'team-board', title: 'Bad' },
    { teamId: 'team-a', boardId: 'team-board', resultBoardId: 'team-board', baseRevision: 2 });
  await assert.rejects(call(kiwiApply, 'alice', { proposalId: 'after-removal' }), /no longer have access/);
});

test('Kiwi email requires a verified owner, shareable board, and fresh review', async () => {
  const { kiwiEmail } = require('./lib/index');
  await assert.rejects(call(kiwiEmail, null, { proposalId: 'email-one' }), /Sign in/);
  await db.doc('boards/board-a').set({ id: 'board-a', owner_user_id: 'alice', visibility: 'public',
    title: 'Alice board', cards: [], updated_at_iso: 'first' });
  await proposal('bob', 'not-owner', { kind: 'email_board', boardId: 'board-a', email: 'friend@example.com' },
    { boardId: 'board-a', resultBoardId: 'board-a', baseUpdatedAt: 'first' });
  await assert.rejects(call(kiwiEmail, 'bob', { proposalId: 'not-owner' }), /Only the board owner/);
  await proposal('alice', 'private-email', { kind: 'email_board', boardId: 'board-a', email: 'friend@example.com' },
    { boardId: 'board-a', resultBoardId: 'board-a', baseUpdatedAt: 'first' });
  await db.doc('boards/board-a').update({ visibility: 'private' });
  await assert.rejects(call(kiwiEmail, 'alice', { proposalId: 'private-email' }), /Private boards/);
  await db.doc('boards/board-a').update({ visibility: 'public', updated_at_iso: 'second' });
  await assert.rejects(call(kiwiEmail, 'alice', { proposalId: 'private-email' }), /board changed/);
});
