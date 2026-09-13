const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const { createHash } = require('node:crypto');

// Every database operation is replaced below. An accidental unmocked call must never
// reach the developer's real Firebase project or use their production credentials.
process.env.GCLOUD_PROJECT = 'demo-team-analytics';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-team-analytics' });
const { FieldValue } = require('firebase-admin/firestore');
const { db } = require('../lib/firebase');
const teams = require('../lib/teams');
const { getTeamInsights, recordTeamActivity, submitTeamContact } = require('../lib/team-analytics');
const { recordBoardAnalyticsEvent } = require('../lib/board-analytics');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const today = new Date().toISOString().slice(0, 10);
const dayAgo = (days) =>
  new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
let records;
const snapshot = (path, value) => ({
  id: path.split('/').at(-1),
  exists: value !== undefined,
  data: () => value,
});

function reference(path, filters = []) {
  return {
    path,
    doc: (id) => reference(`${path}/${id}`),
    collection: (id) => reference(`${path}/${id}`),
    where: (field, op, value) => reference(path, [...filters, { field, op, value }]),
    async get() {
      if (path.split('/').length % 2 === 0) return snapshot(path, records.get(path));
      const docs = [...records.entries()]
        .filter(
          ([key, row]) =>
            key.startsWith(`${path}/`) &&
            key.split('/').length === path.split('/').length + 1 &&
            filters.every(({ field, op, value }) => {
              if (op === '==') return row[field] === value;
              if (op === '>=') return row[field] >= value;
              if (op === '<=') return row[field] <= value;
              throw new Error(`Unexpected query operator: ${op}`);
            }),
        )
        .map(([key, row]) => snapshot(key, row));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}

beforeEach(() => {
  records = new Map([
    ['teams/team-a/listings/listing-a', { id: 'listing-a', status: 'draft' }],
    ['teams/team-a/listings/listing-b', { id: 'listing-b', status: 'published' }],
    ['team_boards/listing-a', { team_id: 'team-a', team_status: 'published' }],
    ['boards/listing-a', { team_id: 'team-a', visibility: 'public', owner_user_id: 'team:team-a' }],
  ]);
  mock.method(db, 'collection', (name) => reference(name));
  mock.method(db, 'runTransaction', async () => {
    throw new Error('Unexpected transaction');
  });
  mock.method(teams, 'requireTeamMember', async (teamId, uid) => {
    assert.equal(teamId, 'team-a');
    assert.equal(uid, 'member');
    return { team: { tracking_since: `${dayAgo(40)}T00:00:00Z` }, member: { role: 'member' } };
  });
  mock.method(teams, 'isActiveTeamMember', async (_, uid) => uid === 'member');
});
afterEach(() => mock.restoreAll());

const report = (days = 30) =>
  getTeamInsights.run({ auth: { uid: 'member' }, data: { teamId: 'team-a', days } });

test('new teams report real empty counters, but unknown voice duration stays null', async () => {
  const result = await report();
  assert.deepEqual(result.totals, {
    views: 0,
    participants: 0,
    chats: 0,
    messages: 0,
    contacts: 0,
    voiceSeconds: null,
  });
  assert.deepEqual(Object.keys(result.listings).sort(), ['listing-a', 'listing-b']);
  assert.deepEqual(result.listings['listing-a'], result.totals);
  assert.equal(result.voiceTrackingSince, null);
});

for (const days of [7, 30, 90]) {
  test(`${days}-day reports include UTC boundaries, exclude other teams, and deduplicate participants and contacts`, async () => {
    const start = dayAgo(days - 1);
    const previous = dayAgo(days);
    const future = dayAgo(-1);
    for (const [id, value] of Object.entries({
      first: {
        teamId: 'team-a',
        boardId: 'listing-a',
        day: start,
        views: 2,
        chats: 1,
        messages: 3,
        voiceSeconds: 30,
      },
      today: {
        teamId: 'team-a',
        boardId: 'listing-b',
        day: today,
        views: 4,
        chats: 2,
        messages: 5,
        voiceSeconds: 60,
      },
      old: { teamId: 'team-a', boardId: 'listing-a', day: previous, views: 100 },
      future: { teamId: 'team-a', boardId: 'listing-a', day: future, views: 200 },
      other: { teamId: 'team-other', boardId: 'listing-a', day: today, views: 300 },
    }))
      records.set(`team_analytics_daily/${id}`, value);
    records.set('team_participants/returning', {
      teamId: 'team-a',
      last_day: today,
      activity: {
        [`listing-a__${start}`]: true,
        [`listing-a__${today}`]: true,
        [`listing-b__${today}`]: true,
      },
    });
    records.set('team_participants/second', {
      teamId: 'team-a',
      last_day: start,
      activity: { [`listing-a__${start}`]: true },
    });
    records.set('team_participants/old', {
      teamId: 'team-a',
      last_day: previous,
      activity: { [`listing-a__${previous}`]: true },
    });
    records.set('team_participants/future', {
      teamId: 'team-a',
      last_day: future,
      activity: { [`listing-a__${future}`]: true },
    });
    records.set('team_participants/other', {
      teamId: 'team-other',
      last_day: today,
      activity: { [`listing-a__${today}`]: true },
    });
    records.set('team_contact_stats/returning', {
      teamId: 'team-a',
      boardId: 'listing-a',
      last_day: today,
      days: [start, today],
    });
    records.set('team_contact_stats/second-listing', {
      teamId: 'team-a',
      boardId: 'listing-b',
      last_day: start,
      days: [start],
    });
    records.set('team_contact_stats/old', {
      teamId: 'team-a',
      boardId: 'listing-a',
      last_day: previous,
      days: [previous],
    });
    records.set('team_contact_stats/future', {
      teamId: 'team-a',
      boardId: 'listing-a',
      last_day: future,
      days: [future],
    });
    records.set('team_contact_stats/other', {
      teamId: 'team-other',
      boardId: 'listing-a',
      last_day: today,
      days: [today],
    });
    let result = await report(days);
    assert.equal(result.days, days);
    assert.deepEqual(result.totals, {
      views: 6,
      participants: 2,
      chats: 3,
      messages: 8,
      contacts: 2,
      voiceSeconds: null,
    });
    assert.deepEqual(result.listings['listing-a'], {
      views: 2,
      participants: 2,
      chats: 1,
      messages: 3,
      contacts: 1,
      voiceSeconds: null,
    });
    assert.deepEqual(result.listings['listing-b'], {
      views: 4,
      participants: 1,
      chats: 2,
      messages: 5,
      contacts: 1,
      voiceSeconds: null,
    });
    records.set('teams/team-a/runtime/voice_webhook', { verified: true, first_verified_at: start });
    result = await report(days);
    assert.equal(result.totals.voiceSeconds, 90);
    assert.equal(result.listings['listing-a'].voiceSeconds, 30);
    assert.equal(result.listings['listing-b'].voiceSeconds, 60);
    assert.equal(result.voiceTrackingSince, start);
  });
}

test('query failures are errors, not zero-filled reports', async () => {
  mock.method(db, 'collection', () => {
    throw new Error('Database unavailable');
  });
  await assert.rejects(report(), /Database unavailable/);
});
test('analytics require authentication and team membership', async () => {
  await assert.rejects(getTeamInsights.run({ data: { teamId: 'team-a' } }), {
    code: 'unauthenticated',
  });
  mock.method(teams, 'requireTeamMember', async () => {
    throw new Error('Membership revoked');
  });
  await assert.rejects(report(), /Membership revoked/);
});

function transaction() {
  const writes = [];
  return {
    writes,
    get: async (ref) => snapshot(ref.path, records.get(ref.path)),
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.path, records.get(ref.path))),
    create: (ref, value) => writes.push({ operation: 'create', path: ref.path, value }),
    set: (ref, value) => writes.push({ operation: 'set', path: ref.path, value }),
  };
}
const activity = {
  teamId: 'team-a',
  boardId: 'listing-a',
  visitorId: 'visitor-123456',
  sessionId: 'session-123456',
  day: today,
};
test('a view counts once per listing, session, and UTC day', async () => {
  let tx = transaction();
  await recordTeamActivity(tx, { ...activity, type: 'board_view' });
  assert.equal(tx.writes.length, 2);
  const daily = tx.writes.find((row) => row.path.startsWith('team_analytics_daily/'));
  assert.deepEqual(daily.value.views, FieldValue.increment(1));
  const receipt = tx.writes.find((row) => row.path.startsWith('team_visit_receipts/'));
  records.set(receipt.path, receipt.value);
  tx = transaction();
  await recordTeamActivity(tx, { ...activity, type: 'board_view' });
  assert.equal(tx.writes.length, 0);
  await recordTeamActivity(tx, { ...activity, day: dayAgo(-1), type: 'board_view' });
  assert.equal(tx.writes.length, 2);
});
test('visitor messages increment messages, but create only one chat per listing session', async () => {
  let tx = transaction();
  await recordTeamActivity(tx, { ...activity, type: 'talking_card_message' });
  let daily = tx.writes.find((row) => row.path.startsWith('team_analytics_daily/'));
  assert.deepEqual(daily.value.chats, FieldValue.increment(1));
  assert.deepEqual(daily.value.messages, FieldValue.increment(1));
  const receipt = tx.writes.find((row) => row.path.startsWith('team_chat_receipts/'));
  records.set(receipt.path, receipt.value);
  tx = transaction();
  await recordTeamActivity(tx, { ...activity, type: 'talking_card_message' });
  daily = tx.writes.find((row) => row.path.startsWith('team_analytics_daily/'));
  assert.equal(daily.value.chats, undefined);
  assert.deepEqual(daily.value.messages, FieldValue.increment(1));
  assert.ok(tx.writes.find((row) => row.path.startsWith('team_participants/')));
});
test('voice starts/ends and another team listing never fabricate messages or minutes', async () => {
  const tx = transaction();
  await recordTeamActivity(tx, { ...activity, type: 'talking_card_voice_start' });
  await recordTeamActivity(tx, { ...activity, type: 'talking_card_voice_end' });
  await recordTeamActivity(tx, { ...activity, teamId: 'team-other', type: 'board_view' });
  assert.equal(tx.writes.length, 0);
});

const request = (uid) => ({
  ...(uid ? { auth: { uid } } : {}),
  data: {
    boardId: 'listing-a',
    eventId: 'event-12345678',
    visitorId: activity.visitorId,
    sessionId: activity.sessionId,
    eventType: 'board_view',
  },
  rawRequest: { headers: { 'user-agent': 'Mozilla/5.0 Chrome/140.0' }, ip: '127.0.0.1' },
});
test('recording excludes signed-in team previews, private listings, and automated traffic', async () => {
  assert.deepEqual(await recordBoardAnalyticsEvent.run(request('member')), {
    accepted: false,
    reason: 'team_member',
  });
  const bot = request();
  bot.rawRequest.headers['user-agent'] = 'HeadlessChrome';
  assert.deepEqual(await recordBoardAnalyticsEvent.run(bot), {
    accepted: false,
    reason: 'automated',
  });
  records.set('boards/listing-a', { team_id: 'team-a', visibility: 'private' });
  assert.deepEqual(await recordBoardAnalyticsEvent.run(request()), {
    accepted: false,
    reason: 'private',
  });
});
test('replayed event receipts cannot double-count visitor messages', async () => {
  const input = request();
  input.data.eventType = 'talking_card_message';
  records.set(`board_analytics_event_receipts/${hash('listing-a:event-12345678')}`, {
    event_type: 'talking_card_message',
  });
  const tx = transaction();
  mock.method(db, 'runTransaction', (callback) => callback(tx));
  assert.deepEqual(await recordBoardAnalyticsEvent.run(input), {
    accepted: false,
    reason: 'duplicate',
  });
  assert.equal(tx.writes.length, 0);
});
test('signed-in team members cannot inflate the visitor contact count', async () => {
  await assert.rejects(
    submitTeamContact.run({
      auth: { uid: 'member' },
      data: {
        boardId: 'listing-a',
        requestId: 'contact-12345678',
        name: 'Agent',
        email: 'agent@example.com',
        message: 'Testing the form',
        consent: true,
      },
    }),
    { code: 'failed-precondition' },
  );
});
