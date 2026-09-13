import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db, storage } = require('./lib/firebase');
const sgMail = require('@sendgrid/mail');
const { getAuth } = require('firebase-admin/auth');
const { teamCommand } = require('./lib/teams');
const {
  getTeamInsights,
  submitTeamContact,
  manageTeamContacts,
  getTeamConversations,
} = require('./lib/team-analytics');
const { recordBoardAnalyticsEvent } = require('./lib/board-analytics');
const { recordVerifiedTeamCall } = require('./lib/team-voice');
const users = new Map();
const command = (uid, action, data = {}) =>
  teamCommand.run({
    data: { action, ...data },
    auth: { uid, token: { email: `${uid}@example.com`, email_verified: true } },
    rawRequest: { ip: '127.0.0.1', headers: { 'user-agent': 'Team integration tests' } },
  });
const now = () => new Date().toISOString();
const create = (uid, requestId = `request-${uid}`, slug = `team-${uid}`) =>
  command(uid, 'create', { name: `Team ${uid}`, slug, requestId });
let originalGetUser;
let originalBucket;
let originalSend;
let originalApiKey;
const removedPrefixes = [];
before(() => {
  originalBucket = storage.bucket;
  storage.bucket = () => ({
    name: 'demo-living-wiki.appspot.com',
    deleteFiles: async ({ prefix }) => {
      removedPrefixes.push(prefix);
    },
  });
  originalSend = sgMail.send;
  originalApiKey = sgMail.setApiKey;
  sgMail.send = async () => [{ statusCode: 202 }];
  sgMail.setApiKey = () => {};
  process.env.SENDGRID_API_KEY = 'local-test-only';
});
before(() => {
  assert.ok(
    process.env.FIRESTORE_EMULATOR_HOST,
    'This test must run against the emulator, never production.',
  );
  originalGetUser = getAuth().getUser;
  getAuth().getUser = async (uid) =>
    users.get(uid) || { uid, email: `${uid}@example.com`, emailVerified: true, displayName: uid };
});
after(async () => {
  getAuth().getUser = originalGetUser;
  storage.bucket = originalBucket;
  sgMail.send = originalSend;
  sgMail.setApiKey = originalApiKey;
  delete process.env.SENDGRID_API_KEY;
  await db.terminate();
});
beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-living-wiki/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  users.clear();
});
async function addMember(teamId, uid, role = 'member') {
  await db
    .doc(`teams/${teamId}/members/${uid}`)
    .set({ uid, role, status: 'active', name: uid, email: `${uid}@example.com` });
  await db
    .doc(`teams/${teamId}`)
    .update({ member_count: require('firebase-admin/firestore').FieldValue.increment(1) });
}
async function save(
  teamId,
  uid = 'owner',
  boardId = 'listing-a',
  board = {
    title: 'Beautiful home',
    cards: [
      { id: 'a', title: 'Living room', notes: 'A', tags: ['real-estate', 'listing'] },
      { id: 'b', title: 'Kitchen', notes: 'B' },
    ],
  },
  revision = 0,
) {
  return (await command(uid, 'saveListing', { teamId, boardId, board, revision })).board;
}

test('concurrent creation enforces one team, is idempotent, and never grants platform admin', async () => {
  const results = await Promise.allSettled([
    create('owner', 'request-a', 'team-a'),
    create('owner', 'request-b', 'team-b'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const [fulfilled] = results.filter((r) => r.status === 'fulfilled');
  const teamId = fulfilled.value.teamId;
  const team = (await db.doc(`teams/${teamId}`).get()).data();
  assert.equal(team.owner_id, 'owner');
  assert.equal((await db.doc('users/owner').get()).data()?.role, undefined);
  const firstRequest = team.slug === 'team-a' ? 'request-a' : 'request-b';
  assert.equal((await create('owner', firstRequest, team.slug)).teamId, teamId);
});
test('platform admin may create several teams but team admins still have one creation allowance', async () => {
  await db.doc('users/platform').set({ role: 'admin' });
  assert.notEqual(
    (await create('platform', 'one', 'platform-one')).teamId,
    (await create('platform', 'two', 'platform-two')).teamId,
  );
  const { teamId } = await create('owner');
  await addMember(teamId, 'colleague', 'admin');
  await create('colleague');
  await assert.rejects(create('colleague', 'second', 'another-colleague'), /one team/);
});
test('invitation acceptance is verified, email-bound, explicit, and idempotent', async () => {
  const { teamId } = await create('owner');
  const inviteId = 'invitation-a';
  await db.doc(`team_invitations/${inviteId}`).set({
    team_id: teamId,
    team_name: 'Team',
    email: 'invitee@example.com',
    role: 'member',
    status: 'pending',
    expires_at_ms: Date.now() + 100000,
  });
  await assert.rejects(
    command('wrong', 'respondInvitation', { inviteId, accept: true }),
    /email address/,
  );
  users.set('invitee', { uid: 'invitee', email: 'invitee@example.com', emailVerified: false });
  await assert.rejects(
    command('invitee', 'respondInvitation', { inviteId, accept: true }),
    /Verify/,
  );
  users.delete('invitee');
  await command('invitee', 'respondInvitation', { inviteId, accept: true });
  await command('invitee', 'respondInvitation', { inviteId, accept: true });
  assert.equal((await db.doc(`teams/${teamId}`).get()).data().member_count, 2);
  assert.equal((await db.doc(`teams/${teamId}/members/invitee`).get()).data().status, 'active');
});
test('members collaborate while representative publication, ownership, and cross-team boundaries are enforced', async () => {
  const { teamId } = await create('owner');
  const other = await create('other');
  await addMember(teamId, 'member');
  const board = await save(teamId);
  await assert.rejects(
    command('member', 'listing', { teamId, boardId: board.id, operation: 'publish', revision: 1 }),
    /representative/,
  );
  await assert.rejects(
    command('other', 'saveListing', {
      teamId: other.teamId,
      boardId: board.id,
      board,
      revision: 1,
    }),
    /different team/,
  );
  await assert.rejects(
    command('member', 'member', { teamId, operation: 'role', memberId: 'owner', role: 'member' }),
    /admins/,
  );
  await assert.rejects(
    command('owner', 'member', { teamId, operation: 'remove', memberId: 'owner' }),
    /ownership/,
  );
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'publish',
    revision: 1,
  });
  const changed = await save(
    teamId,
    'member',
    board.id,
    { ...board, title: 'New private title' },
    1,
  );
  assert.equal(changed.team_revision, 2);
  assert.equal(changed.owner_user_id, `team:${teamId}`);
  assert.equal((await db.doc(`boards/${board.id}`).get()).data().title, 'Beautiful home');
});
test('different-card edits merge, same-card conflicts reject, and removal retains the listing', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  const base = await save(teamId);
  await save(
    teamId,
    'owner',
    base.id,
    { ...base, cards: [{ ...base.cards[0], notes: 'Owner changed A' }, base.cards[1]] },
    1,
  );
  const merged = await save(
    teamId,
    'member',
    base.id,
    { ...base, cards: [base.cards[0], { ...base.cards[1], notes: 'Member changed B' }] },
    1,
  );
  assert.deepEqual(
    merged.cards.map((c) => c.notes),
    ['Owner changed A', 'Member changed B'],
  );
  await assert.rejects(
    save(
      teamId,
      'member',
      base.id,
      { ...base, cards: [{ ...base.cards[0], notes: 'Conflict' }, base.cards[1]] },
      1,
    ),
    /colleague/,
  );
  await command('owner', 'member', { teamId, operation: 'remove', memberId: 'member' });
  await assert.rejects(save(teamId, 'member', base.id, merged, merged.team_revision), /access/);
  assert.equal((await db.doc(`team_boards/${base.id}`).get()).exists, true);
});
test('voice grants belong to the voice owner, survive rep assignment, and cannot be forged', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  const board = await save(teamId);
  await db.doc('user_narrator_voices/member/voices/voice-one').set({
    status: 'ready',
    name: 'My voice',
    voice_revision: 3,
    provider_voice_id: 'private-provider-id',
  });
  await assert.rejects(
    command('owner', 'voice', { teamId, operation: 'share', voiceId: 'voice-one', consent: true }),
    /ready voice/,
  );
  await command('member', 'voice', {
    teamId,
    operation: 'share',
    voiceId: 'voice-one',
    consent: true,
  });
  await command('owner', 'voice', {
    teamId,
    operation: 'select',
    boardId: board.id,
    revision: 1,
    ownerId: 'member',
    voiceId: 'voice-one',
    voiceRevision: 3,
  });
  const selected = (await db.doc(`team_boards/${board.id}`).get()).data();
  assert.equal(selected.representative_id, 'owner');
  assert.equal(selected.voice_owner_id, 'member');
  await command('member', 'voice', { teamId, operation: 'revoke' });
  await assert.rejects(
    command('owner', 'listing', { teamId, boardId: board.id, operation: 'publish', revision: 2 }),
    /no longer shared/,
  );
});
test('analytics count distinct period participants, exclude members, and deduplicate repeated views', async () => {
  const { teamId } = await create('owner');
  const board = await save(teamId);
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'publish',
    revision: 1,
  });
  let n = 0;
  const event = (type, uid) =>
    recordBoardAnalyticsEvent.run({
      data: {
        boardId: board.id,
        eventId: `event-${String(++n).padStart(14, '0')}`,
        visitorId: 'visitor-12345678',
        sessionId: 'session-12345678',
        eventType: type,
      },
      auth: uid ? { uid } : undefined,
      rawRequest: { headers: { 'user-agent': 'Mozilla/5.0' }, ip: '127.0.0.1' },
    });
  await event('board_view');
  await event('board_view');
  await event('board_engaged');
  await event('talking_card_message');
  await event('talking_card_message');
  await event('board_view', 'owner');
  const report = await getTeamInsights.run({ auth: { uid: 'owner' }, data: { teamId, days: 30 } });
  assert.equal(report.totals.views, 1);
  assert.equal(report.totals.participants, 1);
  assert.equal(report.totals.chats, 1);
  assert.equal(report.totals.messages, 2);
  assert.equal(report.totals.contacts, 0);
  assert.equal(report.totals.voiceSeconds, null);
});
test('explicit contact requests are deduplicated and private to representative/admin', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  const board = await save(teamId);
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'publish',
    revision: 1,
  });
  const data = {
    boardId: board.id,
    requestId: 'contact-request-1',
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'A showing please',
    consent: true,
  };
  await submitTeamContact.run({ data, rawRequest: { ip: '127.0.0.1' } });
  await submitTeamContact.run({ data, rawRequest: { ip: '127.0.0.1' } });
  await assert.rejects(
    manageTeamContacts.run({ auth: { uid: 'member' }, data: { teamId, boardId: board.id } }),
    /assigned representative/,
  );
  const result = await manageTeamContacts.run({
    auth: { uid: 'owner' },
    data: { teamId, boardId: board.id },
  });
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].requests, 1);
  const report = await getTeamInsights.run({ auth: { uid: 'owner' }, data: { teamId, days: 30 } });
  assert.equal(report.totals.contacts, 1);
});
test('verified call callbacks are idempotent, agent-bound, and use server-issued attribution', async () => {
  const start = Math.floor(Date.now() / 1000);
  const sessionId = 'team_12345678-1234-1234-1234-123456789012';
  await db.doc('teams/team-a').set({ status: 'active' });
  await db.doc('team_boards/listing-a').set({ team_id: 'team-a' });
  await db.doc(`team_voice_sessions/${sessionId}`).set({
    teamId: 'team-a',
    boardId: 'listing-a',
    agentId: 'agent-a',
    representativeId: 'rep-a',
    internal: false,
    issued_at_ms: start * 1000,
    conversationId: null,
  });
  const event = {
    type: 'post_call_transcription',
    data: {
      user_id: sessionId,
      conversation_id: 'conversation-a',
      agent_id: 'agent-a',
      metadata: { start_time_unix_secs: start, call_duration_secs: 90 },
      transcript: [{ role: 'user', message: 'Hello' }],
    },
  };
  await recordVerifiedTeamCall({ ...event, data: { ...event.data, agent_id: 'attacker-agent' } });
  assert.equal((await db.doc('team_conversations/conversation-a').get()).exists, false);
  await recordVerifiedTeamCall(event);
  await recordVerifiedTeamCall(event);
  const docs = await db.collection('team_analytics_daily').get();
  assert.equal(docs.size, 1);
  assert.equal(docs.docs[0].data().voiceSeconds, 90);
});

test('identical save retries do not create revisions or duplicate listings', async () => {
  const { teamId } = await create('owner');
  const first = await save(teamId);
  const retry = await save(teamId);
  assert.equal(first.team_revision, retry.team_revision);
  assert.equal((await db.doc(`teams/${teamId}`).get()).data().listing_count, 1);
  assert.equal((await db.collection(`team_boards/${first.id}/revisions`).get()).size, 1);
});

test('invitation batches are atomic, normalize emails, and reject premature resends', async () => {
  const { teamId } = await create('owner');
  const result = await command('owner', 'invite', {
    teamId,
    emails: 'New@Example.com, new@example.com,',
    role: 'member',
  });
  assert.equal(result.invitations.length, 1);
  assert.equal(result.invitations[0].delivery, 'sent');
  assert.equal((await db.collection(`teams/${teamId}/members`).get()).size, 1);
  await assert.rejects(
    command('owner', 'invite', { teamId, emails: 'another@example.com,new@example.com' }),
    /Wait a minute/,
  );
  assert.equal((await db.collection('team_invitations').get()).size, 1);
  await assert.rejects(
    command('owner', 'invite', { teamId, emails: 'another@example.com,invalid' }),
    /invalid/,
  );
  assert.equal((await db.collection('team_invitations').get()).size, 1);
});

test('shared wizard drafts support colleagues, reject stale writes, and complete without creator ownership', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  const draftId = 'shared-wizard';
  await command('owner', 'wizard', {
    teamId,
    draftId,
    operation: 'save',
    revision: 0,
    draft: { title: 'Draft' },
  });
  const second = await command('member', 'wizard', {
    teamId,
    draftId,
    operation: 'save',
    revision: 1,
    draft: { title: 'Colleague draft' },
  });
  assert.equal(second.revision, 2);
  await assert.rejects(
    command('owner', 'wizard', {
      teamId,
      draftId,
      operation: 'save',
      revision: 1,
      draft: { title: 'Stale' },
    }),
    /teammate/,
  );
  await assert.rejects(
    command('member', 'wizard', { teamId, draftId, operation: 'delete' }),
    /creator/,
  );
  await save(teamId, 'member', draftId);
  await command('member', 'wizard', {
    teamId,
    draftId,
    operation: 'delete',
    completedBoardId: draftId,
  });
  assert.equal((await db.doc(`teams/${teamId}/wizard_drafts/${draftId}`).get()).exists, false);
});

test('copy and move preserve personal ownership boundaries, reset voice/video, and reserve stable aliases', async () => {
  const { teamId } = await create('owner');
  const source = {
    id: 'personal-home',
    title: 'Personal home',
    owner_user_id: 'owner',
    visibility: 'public',
    custom_slug: 'my-home',
    updated_at_iso: now(),
    created_at_iso: now(),
    stackNarratorVoiceId: 'personal:private-voice',
    socialVideoUrl:
      'https://firebasestorage.googleapis.com/v0/b/demo-living-wiki.appspot.com/o/users%2Fowner%2Fboards%2Fvideo.mp4?alt=media',
    cards: [{ id: 'original-card', title: 'Living room', tags: ['real-estate'] }],
  };
  await db.doc('boards/personal-home').set(source);
  const copy = await command('owner', 'transferListing', {
    teamId,
    boardId: source.id,
    updatedAt: source.updated_at_iso,
    operation: 'copy',
    requestId: 'copy-1',
  });
  const copied = (await db.doc(`team_boards/${copy.boardId}`).get()).data();
  assert.notEqual(copied.cards[0].id, 'original-card');
  assert.equal(copied.socialVideoUrl, '');
  assert.equal(copied.voice_owner_id, '');
  assert.equal((await db.doc('boards/personal-home').get()).data().owner_user_id, 'owner');
  assert.equal(
    (
      await command('owner', 'transferListing', {
        teamId,
        boardId: source.id,
        updatedAt: source.updated_at_iso,
        operation: 'copy',
        requestId: 'copy-1',
      })
    ).boardId,
    copy.boardId,
  );
  await assert.rejects(
    command('owner', 'transferListing', {
      teamId,
      boardId: source.id,
      updatedAt: 'outdated',
      operation: 'move',
    }),
    /changed/,
  );
  await command('owner', 'transferListing', {
    teamId,
    boardId: source.id,
    updatedAt: source.updated_at_iso,
    operation: 'move',
  });
  assert.equal((await db.doc('boards/personal-home').get()).data().visibility, 'private');
  await command('owner', 'listing', {
    teamId,
    boardId: source.id,
    operation: 'publish',
    revision: 1,
  });
  assert.equal((await db.doc('boards/personal-home').get()).data().custom_slug, 'my-home');
});

test('private Talking Card knowledge prevents publishing without exposing a partial snapshot', async () => {
  const { teamId } = await create('owner');
  await db.doc('atlases/private-agent').set({ user_id: 'owner', is_public: false });
  const board = await save(teamId, 'owner', 'with-private-agent', {
    title: 'Private knowledge',
    cards: [{ id: 'agent-card', title: 'Ask us', conversation: { atlasId: 'private-agent' } }],
  });
  await assert.rejects(
    command('owner', 'listing', { teamId, boardId: board.id, operation: 'publish', revision: 1 }),
    /Private knowledge/,
  );
  assert.equal((await db.doc(`boards/${board.id}`).get()).exists, false);
  assert.equal((await db.doc(`team_boards/${board.id}`).get()).data().team_status, 'draft');
});

test('team archive is read-only, restore never republishes, and permanent deletion releases creator quota', async () => {
  const { teamId } = await create('owner');
  const board = await save(teamId);
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'publish',
    revision: 1,
  });
  await command('owner', 'lifecycle', { teamId, operation: 'archive' });
  await assert.rejects(save(teamId, 'owner', board.id, board, 2), /Restore this team/);
  assert.equal((await command('owner', 'allowance')).canCreate, false);
  await command('owner', 'lifecycle', { teamId, operation: 'restore' });
  assert.equal((await db.doc(`boards/${board.id}`).get()).data().visibility, 'private');
  await command('owner', 'lifecycle', { teamId, operation: 'archive' });
  await assert.rejects(
    command('owner', 'lifecycle', { teamId, operation: 'delete', confirmName: 'wrong' }),
    /exact name/,
  );
  await command('owner', 'lifecycle', { teamId, operation: 'delete', confirmName: 'Team owner' });
  assert.equal((await db.doc(`teams/${teamId}`).get()).exists, false);
  assert.equal((await db.doc(`team_boards/${board.id}`).get()).exists, false);
  assert.equal((await command('owner', 'allowance')).canCreate, true);
  assert.ok(removedPrefixes.includes(`team-media/${teamId}/`));
  assert.equal((await db.doc('team_slugs/team-owner').get()).data().deleted, true);
});

test('permanent listing deletion is retryable, erases private contacts, and cannot be undone by stale saves', async () => {
  const { teamId } = await create('owner');
  const board = await save(teamId);
  await db
    .doc('team_contacts/private-contact')
    .set({ teamId, boardId: board.id, message: 'private' });
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'archive',
    revision: 1,
  });
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'delete',
    revision: 2,
  });
  await command('owner', 'listing', {
    teamId,
    boardId: board.id,
    operation: 'delete',
    revision: 2,
  });
  assert.equal((await db.doc('team_contacts/private-contact').get()).exists, false);
  const tombstone = (await db.doc(`boards/${board.id}`).get()).data();
  assert.equal(tombstone.visibility, 'private');
  assert.equal(tombstone.title, 'Unavailable listing');
  assert.deepEqual(tombstone.cards, []);
  assert.equal((await db.doc(`teams/${teamId}`).get()).data().listing_count, 0);
  await assert.rejects(save(teamId), /permanently deleted/);
});

test('public profiles require self opt-in and removal withdraws the public member', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  await command('owner', 'update', {
    teamId,
    revision: 1,
    name: 'Public team',
    publicEnabled: true,
  });
  await assert.rejects(
    command('owner', 'member', {
      teamId,
      memberId: 'member',
      operation: 'profile',
      publicVisible: true,
    }),
    /opt in/,
  );
  await command('member', 'member', {
    teamId,
    operation: 'profile',
    publicVisible: true,
    title: 'Advisor',
    contactEmail: 'public@example.com',
  });
  const page = (await db.doc(`public_team_pages/${teamId}`).get()).data();
  assert.equal(page.members.length, 1);
  assert.equal(page.members[0].contactEmail, 'public@example.com');
  assert.equal(page.members[0].email, undefined);
  await command('owner', 'member', { teamId, memberId: 'member', operation: 'remove' });
  assert.equal((await db.doc(`public_team_pages/${teamId}`).get()).data().members.length, 0);
});

test('contacts and verified conversations paginate without cross-listing or member leakage', async () => {
  const { teamId } = await create('owner');
  await addMember(teamId, 'member');
  const board = await save(teamId);
  const batch = db.batch();
  for (let i = 0; i < 27; i++)
    batch.set(db.doc(`team_contacts/contact-${i}`), {
      teamId,
      boardId: board.id,
      name: `Visitor ${i}`,
      last_at: now(),
    });
  for (let i = 0; i < 12; i++)
    batch.set(db.doc(`team_conversations/call-${i}`), {
      teamId,
      boardId: board.id,
      startedAt: now(),
      durationSeconds: 12,
      transcript: [],
    });
  await batch.commit();
  const args = { auth: { uid: 'owner' }, data: { teamId, boardId: board.id } };
  const first = await manageTeamContacts.run(args);
  const next = await manageTeamContacts.run({
    ...args,
    data: { ...args.data, cursor: first.nextCursor },
  });
  assert.equal(first.contacts.length, 25);
  assert.equal(next.contacts.length, 2);
  assert.equal(new Set([...first.contacts, ...next.contacts].map((c) => c.id)).size, 27);
  const calls = await getTeamConversations.run(args);
  assert.equal(calls.conversations.length, 10);
  assert.ok(calls.nextCursor);
  await assert.rejects(
    getTeamConversations.run({ ...args, auth: { uid: 'member' } }),
    /assigned representative/,
  );
  await db
    .doc('team_contacts/foreign-contact')
    .set({ teamId: 'other', boardId: 'other', last_at: now() });
  await assert.rejects(
    manageTeamContacts.run({ ...args, data: { ...args.data, cursor: 'foreign-contact' } }),
    /Reload contacts/,
  );
});

test('late verified callbacks cannot recreate deleted team data', async () => {
  const start = Math.floor(Date.now() / 1000);
  const sessionId = 'team_12345678-1234-1234-1234-123456789012';
  await db.doc(`team_voice_sessions/${sessionId}`).set({
    teamId: 'deleted',
    boardId: 'deleted-listing',
    agentId: 'agent',
    issued_at_ms: start * 1000,
  });
  await recordVerifiedTeamCall({
    type: 'post_call_transcription',
    data: {
      user_id: sessionId,
      agent_id: 'agent',
      conversation_id: 'late-call',
      metadata: { start_time_unix_secs: start, call_duration_secs: 30 },
    },
  });
  assert.equal((await db.collection('team_conversations').get()).size, 0);
  assert.equal((await db.collection('team_analytics_daily').get()).size, 0);
});
