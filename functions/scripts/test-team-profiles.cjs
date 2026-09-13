const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');

// Never connect these regression tests to a real account or database.
process.env.GCLOUD_PROJECT = 'demo-team-profiles';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-team-profiles' });
const { db } = require('../lib/firebase');
const { teamCommand, getPublicTeamPage } = require('../lib/teams');
let records;
let profileReads;
const snapshot = (path) => ({
  id: path.split('/').at(-1),
  exists: records.has(path),
  data: () => records.get(path),
});
function reference(path, filters = []) {
  return {
    path,
    doc: (id) => reference(`${path}/${id}`),
    collection: (id) => reference(`${path}/${id}`),
    where: (field, op, value) => {
      assert.equal(op, '==');
      return reference(path, [...filters, [field, value]]);
    },
    orderBy: () => reference(path, filters),
    limit: () => reference(path, filters),
    async get() {
      if (path.split('/').length % 2 === 0) return snapshot(path);
      const docs = [...records.keys()]
        .filter(
          (key) =>
            key.startsWith(`${path}/`) &&
            key.split('/').length === path.split('/').length + 1 &&
            filters.every(([field, value]) => records.get(key)[field] === value),
        )
        .map(snapshot);
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
beforeEach(() => {
  profileReads = [];
  records = new Map([
    ['teams/team-a', { status: 'active', public_enabled: true }],
    ['team_slugs/team-a', { team_id: 'team-a' }],
    ['public_team_pages/team-a', { name: 'Team A', members: [{ uid: 'removed' }] }],
  ]);
  for (const [uid, status, visible] of [
    ['viewer', 'active', false],
    ['agent', 'active', true],
    ['removed', 'removed', true],
  ]) {
    records.set(`teams/team-a/members/${uid}`, {
      status,
      public_visible: visible,
      role: 'member',
      name: 'Old name',
      photo_url: 'https://example.com/old.jpg',
      email: `${uid}@private.example`,
      public_email: '',
      joined_at: '2026-09-01',
    });
    records.set(`users/${uid}`, {
      displayName: `Current ${uid}`,
      profilePictureType: 'image',
      photoURL: `https://example.com/${uid}.jpg`,
      email: 'secret@example.com',
      role: 'admin',
      privateNotes: 'Never share this',
    });
  }
  mock.method(db, 'collection', (path) => reference(path));
  mock.method(db, 'getAll', async (...refs) =>
    refs.map((ref) => {
      if (ref.path.startsWith('users/')) profileReads.push(ref.path);
      return snapshot(ref.path);
    }),
  );
});
afterEach(() => mock.restoreAll());

const dashboard = (uid = 'viewer') =>
  teamCommand.run({
    auth: { uid },
    data: { action: 'dashboard', teamId: 'team-a' },
  });

test('dashboard resolves current member photos on every read without exposing private account fields', async () => {
  const result = await dashboard();
  assert.deepEqual(result.members.map((member) => member.uid).sort(), ['agent', 'viewer']);
  const agent = result.members.find((member) => member.uid === 'agent');
  assert.equal(agent.name, 'Current agent');
  assert.equal(agent.photoUrl, 'https://example.com/agent.jpg');
  assert.equal(agent.role, 'member');
  assert.equal(agent.email, undefined);
  assert.equal(agent.privateNotes, undefined);
  records.get('users/agent').photoURL = 'https://example.com/updated.jpg';
  assert.equal(
    (await dashboard()).members.find((member) => member.uid === 'agent').photoUrl,
    'https://example.com/updated.jpg',
  );
});

test('public profiles include only active opted-in members, with fresh photos and no private fields', async () => {
  const result = await getPublicTeamPage.run({ data: { slug: 'team-a' } });
  assert.deepEqual(
    result.page.members.map((member) => member.uid),
    ['agent'],
  );
  assert.deepEqual(profileReads, ['users/agent']);
  const agent = result.page.members[0];
  assert.equal(agent.photoUrl, 'https://example.com/agent.jpg');
  for (const field of ['email', 'role', 'privateNotes', 'shared_voice'])
    assert.equal(agent[field], undefined);
});

test('unauthorized dashboard requests and unpublished public pages never resolve account profiles', async () => {
  await assert.rejects(dashboard('outsider'), { code: 'permission-denied' });
  records.get('teams/team-a').public_enabled = false;
  await assert.rejects(getPublicTeamPage.run({ data: { slug: 'team-a' } }), { code: 'not-found' });
  assert.deepEqual(profileReads, []);
});
