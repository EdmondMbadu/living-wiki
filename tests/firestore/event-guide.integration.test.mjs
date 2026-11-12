import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
const { db } = require('./lib/firebase');
const {
  askEventGuide, createEventGuideItinerary, isEventVoiceCard, loadCesEventGuideDemo,
  previewEventGuideImport, readEventGuide, readEventGuideItinerary, saveEventGuideDataset, sendEventGuideItinerary, updateEventGuideItinerary,
} = require('./lib/event-guide-functions');

const boardId = 'event-guide-test-board';
const cardId = 'event-guide-test-card';
const atlasId = 'event-guide-test-avatar';
const owner = 'event-guide-test-owner';
const target = { boardId, cardId };
const board = db.collection('boards').doc(boardId);
const call = (fn, data, uid) => fn.run({ data, ...(uid ? { auth: { uid } } : {}), rawRequest: { ip: '192.0.2.10' } });
const fixture = {
  name: 'CES 2027', datasetId: '', startDate: '2027-01-05', endDate: '2027-01-09', timeZone: 'America/Los_Angeles',
  informationUrl: 'https://example.org/event', privacyUrl: 'https://example.org/privacy', travelMinutes: 30,
};

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the Firestore emulator.');
  await board.set({ owner_user_id: owner, visibility: 'private', cards: [] });
});

after(async () => {
  await board.delete();
});

test('organizer imports and publishes, a QR guest asks and plans, and confirmed email sends once', async () => {
  await assert.rejects(call(loadCesEventGuideDemo, target), { code: 'unauthenticated' });
  await assert.rejects(call(loadCesEventGuideDemo, target, 'other-owner'), { code: 'permission-denied' });
  const demo = await call(loadCesEventGuideDemo, target, owner);
  const preview = await call(previewEventGuideImport, {
    boardId, kind: 'schedule', filename: 'test.md', startDate: fixture.startDate,
    base64: Buffer.from('| Date | Title | Start | End | Location |\n|---|---|---|---|---|\n| 2027-01-06 | Test session | 10:00 | 10:40 | LVCC |').toString('base64'),
  }, owner);
  assert.equal(preview.sessions[0].title, 'Test session');
  const settings = await call(saveEventGuideDataset, { boardId, settings: fixture, dataset: demo }, owner);
  assert.equal((await call(saveEventGuideDataset, { boardId, settings, dataset: {} }, owner)).datasetId, settings.datasetId);
  const card = { id: cardId, conversation: { provider: 'atlas', atlasId, event: settings } };
  const atlas = db.collection('atlases').doc(atlasId);
  await atlas.set({ user_id: owner, is_public: false, name: 'Amy' });
  await board.update({ cards: [card] });
  await assert.rejects(call(readEventGuide, target), { code: 'permission-denied' });
  assert.equal((await call(readEventGuide, target, owner)).scheduleCount, 200);
  const organizerRecords = await call(readEventGuide, { ...target, includeRecords: true }, owner);
  assert.equal(organizerRecords.sessions.length, 200);
  assert.equal(organizerRecords.exhibitors.length, 35);
  await board.update({ visibility: 'unlisted' });
  assert.equal((await call(readEventGuide, { ...target, includeRecords: true })).sessions, undefined);
  assert.equal(await isEventVoiceCard(boardId, cardId, undefined, atlasId), true);
  await assert.rejects(isEventVoiceCard(boardId, cardId, undefined, 'different-atlas'), { code: 'permission-denied' });

  const lookup = await call(askEventGuide, { ...target, question: 'Where is the Waymo booth?' });
  assert.match(lookup.exhibitors[0].location, /3741/);
  const plan = await call(createEventGuideItinerary, { ...target, preferences: {
    days: ['2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08'], interests: 'AI and robotics', mustSee: 'Waymo',
  } });
  assert.equal(plan.days.length, 5);
  const request = { ...target, id: plan.id, key: plan.key, email: 'guest@example.org', consent: true };
  await assert.rejects(call(sendEventGuideItinerary, { ...request, consent: false }), { code: 'invalid-argument' });
  await assert.rejects(call(sendEventGuideItinerary, { ...request, key: '0'.repeat(64) }), { code: 'not-found' });
  const sendgrid = require('@sendgrid/mail');
  const originalSend = sendgrid.send;
  const originalKey = process.env.SENDGRID_API_KEY;
  process.env.SENDGRID_API_KEY = 'SG.event-guide-test';
  let sent = 0;
  sendgrid.send = async (message) => {
    assert.equal(message.to, 'guest@example.org');
    assert.match(message.html, /Waymo/);
    assert.match(message.subject, /CES 2027/);
    sent++;
    return [{ statusCode: 202 }, {}];
  };
  try {
    const results = await Promise.allSettled([call(sendEventGuideItinerary, request), call(sendEventGuideItinerary, request)]);
    assert.ok(results.some((result) => result.status === 'fulfilled' && result.value.sent));
    assert.equal((await call(sendEventGuideItinerary, request)).sent, true);
    assert.equal(sent, 1);
    await assert.rejects(call(sendEventGuideItinerary, { ...request, email: 'different@example.org' }), { code: 'failed-precondition' });
    const typedSession = 'event-text-session-123';
    const tracked = await call(askEventGuide, { ...target, question: 'Where is the Waymo booth?',
      analyticsSessionId: typedSession, analyticsRequestId: 'event-text-turn-123', analyticsVisitorId: 'event-visitor-123' }, owner);
    assert.equal(tracked.historySaved, true);
    assert.match(tracked.answer, /3741/);
    const combined = await call(createEventGuideItinerary, { ...target, preferences: { days: ['2027-01-06'], mustSee: 'Waymo' } }, owner);
    const recap = { ...request, recap: true, id: combined.id, key: combined.key, textSessions: [typedSession], editableItinerary: true };
    await assert.rejects(call(sendEventGuideItinerary, recap, 'other-user'), { code: 'permission-denied' });
    let editLink;
    sendgrid.send = async (message) => {
      assert.match(message.subject, /Your event recap/);
      assert.match(message.html, /Where is the Waymo booth\?/);
      assert.match(message.html, /3741/);
      assert.match(message.html, /Your itinerary/);
      assert.match(message.html, /href="https:\/\/livingwiki\.com\/">LivingWiki<|href="https:\/\/livingwiki\.com">LivingWiki</);
      assert.match(message.text, /LivingWiki\nhttps:\/\/livingwiki\.com/);
      editLink = new URL(message.html.match(/href="(https:\/\/livingwiki\.com\/event-itinerary#[^"]+)"/)[1]);
      sent++;
      return [{ statusCode: 202 }, {}];
    };
    assert.equal((await call(sendEventGuideItinerary, recap, owner)).sent, true);
    assert.equal((await call(sendEventGuideItinerary, recap, owner)).sent, true);
    assert.equal(sent, 2);
    const [editId, editKey] = editLink.hash.slice(1).split('.');
    const editAccess = { id: editId, key: editKey };
    assert.equal(editId, combined.id);
    assert.notEqual(editKey, combined.key);
    assert.ok(!editLink.search);
    await assert.rejects(call(readEventGuideItinerary, { id: editId, key: combined.key }), { code: 'not-found' });
    await assert.rejects(call(sendEventGuideItinerary, { ...recap, key: editKey }, owner), { code: 'not-found' });
    const draft = await call(readEventGuideItinerary, editAccess);
    assert.deepEqual(draft.preferences.days, ['2027-01-06']);
    assert.equal(draft.preferences.mustSee, 'Waymo');
    assert.equal(draft.transcript, undefined);
    const day = draft.plan.days.find(item => item.attending);
    const removed = await call(updateEventGuideItinerary, { ...editAccess, revision: draft.revision, remove: { date: day.date, index: 0 } });
    assert.equal(removed.plan.days.find(item => item.date === day.date).items.length, day.items.length - 1);
    await assert.rejects(call(updateEventGuideItinerary, { ...editAccess, revision: draft.revision, preferences: draft.preferences }), { code: 'aborted' });
    const rebuilt = await call(updateEventGuideItinerary, {
      ...editAccess, revision: removed.revision, preferences: { ...draft.preferences, days: ['2027-01-07'] },
    });
    assert.deepEqual(rebuilt.plan.days.filter(item => item.attending).map(item => item.date), ['2027-01-07']);
    assert.deepEqual(await call(readEventGuideItinerary, editAccess), rebuilt);
    await board.update({ visibility: 'private' });
    await assert.rejects(call(readEventGuideItinerary, editAccess), { code: 'permission-denied' });
    assert.equal((await call(readEventGuideItinerary, editAccess, owner)).revision, rebuilt.revision);
    await board.update({ visibility: 'unlisted' });
    sendgrid.send = async message => {
      assert.match(message.html, /Where is the Waymo booth\?/);
      assert.doesNotMatch(message.html, /Your itinerary/);
      sent++;
      return [{ statusCode: 202 }, {}];
    };
    const recapOnly = { ...target, recap: true, requestId: 'event-recap-123', textSessions: [typedSession], email: request.email, consent: true };
    assert.equal((await call(sendEventGuideItinerary, recapOnly, owner)).sent, true);
    assert.equal((await call(sendEventGuideItinerary, recapOnly, owner)).sent, true);
    assert.equal(sent, 3);

    const replacement = await call(saveEventGuideDataset, { boardId, settings, dataset: preview }, owner);
    assert.notEqual(replacement.datasetId, settings.datasetId);
    assert.equal((await call(readEventGuide, target)).scheduleCount, 200);
    await board.update({ cards: [{ ...card, conversation: { ...card.conversation, event: replacement } }] });
    assert.equal((await call(readEventGuide, target)).scheduleCount, 1);
    await board.update({ cards: [{ ...card, authorOnly: true }] });
    await assert.rejects(call(askEventGuide, { ...target, question: 'Waymo?' }), { code: 'permission-denied' });
    await assert.rejects(call(sendEventGuideItinerary, request), { code: 'permission-denied' });
    await board.update({ visibility: 'public', owner_user_id: 'foreign-owner', cards: [card] });
    await assert.rejects(call(readEventGuide, target), { code: 'not-found' });
  } finally {
    await atlas.delete();
    sendgrid.send = originalSend;
    if (originalKey === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalKey;
  }
});

test('event voice requires the recording notice and saves verified internal duration, transcript and audio access', async () => {
  const { createElevenLabsVoiceSession, syncCardVoiceAnalytics, getCardAnalytics, getCardConversation, getEventConversationAudio } = require('./lib/index');
  const atlas = db.collection('atlases').doc(atlasId);
  const originalFetch = globalThis.fetch;
  const keys = ['ELEVENLABS_API_KEY', 'ELEVENLABS_EVENT_AGENT_ID', 'ELEVENLABS_RECORDED_EVENT_AGENT_ID', 'ELEVENLABS_AGENT_ID'];
  const previous = keys.map((key) => process.env[key]);
  process.env.ELEVENLABS_API_KEY = 'test-voice-key';
  process.env.ELEVENLABS_EVENT_AGENT_ID = 'agent_eventfixture';
  process.env.ELEVENLABS_RECORDED_EVENT_AGENT_ID = 'agent_recordedfixture';
  process.env.ELEVENLABS_AGENT_ID = 'agent_generic_fixture';
  const urls = [];
  globalThis.fetch = async (input) => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify({ signed_url: 'wss://example.org/event-voice', voices: [] }), { status: 200 });
  };
  try {
    await atlas.set({ user_id: owner, is_public: false, name: 'Amy', wiki_type: 'person' });
    await board.set({ owner_user_id: owner, visibility: 'public', cards: [{
      id: cardId, conversation: { provider: 'atlas', atlasId, event: { ...fixture, datasetId: 'c'.repeat(64) } },
    }] });
    const input = { ...target, atlasId, experience: 'event-talking-card', connectionType: 'websocket', anonymousVisitorId: 'visitor_event_fixture_123456' };
    const legacy = await call(createElevenLabsVoiceSession, input, owner);
    assert.equal(legacy.agentId, 'agent_eventfixture');
    assert.doesNotMatch(legacy.userId, /^card_/);
    const beforeInvalidNotice = urls.length;
    await assert.rejects(call(createElevenLabsVoiceSession, { ...input, eventVoiceHistoryVersion: 99 }), { code: 'failed-precondition' });
    assert.equal(urls.length, beforeInvalidNotice);
    input.eventVoiceHistoryVersion = 1;
    const session = await call(createElevenLabsVoiceSession, input, owner);
    assert.equal(session.signedUrl, 'wss://example.org/event-voice');
    assert.equal(session.agentId, 'agent_recordedfixture');
    assert.match(session.userId, /^card_/);
    assert.ok(urls.some((url) => url.searchParams.get('agent_id') === 'agent_recordedfixture'));
    assert.ok(urls.every((url) => url.searchParams.get('agent_id') !== 'agent_generic_fixture'));
    const originalRequestCount = urls.length;
    await board.update({ visibility: 'private' });
    await assert.rejects(call(createElevenLabsVoiceSession, input), { code: 'permission-denied' });
    assert.equal(urls.length, originalRequestCount);
    const conversationId = 'event_test_conversation';
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/audio')) return new Response(Buffer.from('test audio'), { headers: { 'content-type': 'audio/mpeg' } });
      return new Response(JSON.stringify({
        agent_id: session.agentId, conversation_id: conversationId, user_id: session.userId, status: 'done', has_audio: true,
        metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000), call_duration_secs: 181 },
        transcript: [
          { role: 'agent', message: 'Welcome', time_in_call_secs: 0 },
          { role: 'user', message: 'Where is the robotics demo?', time_in_call_secs: 8 },
          { role: 'agent', message: 'The robotics demo is in Hall A.', time_in_call_secs: 20 },
        ],
      }));
    };
    assert.equal((await call(syncCardVoiceAnalytics, { sessionId: session.userId, conversationId }, owner)).pending, false);
    const report = await call(getCardAnalytics, { ...target, audience: 'internal' }, owner);
    const row = report.conversations.find(item => item.id === session.userId);
    assert.equal(row.durationSeconds, 181);
    assert.equal(row.canReadTranscript, true);
    assert.equal(report.activity.totals.seconds, 181);
    const detail = await call(getCardConversation, { ...target, conversationId: row.id }, owner);
    assert.deepEqual(detail.turns.map(turn => turn.text), ['Welcome', 'Where is the robotics demo?', 'The robotics demo is in Hall A.']);
    assert.equal(detail.hasAudio, true);
    await assert.rejects(call(getEventConversationAudio, { ...target, conversationId: row.id }, 'other-user'), { code: 'permission-denied' });
    const audio = await call(getEventConversationAudio, { ...target, conversationId: row.id }, owner);
    assert.equal(Buffer.from(audio.audio, 'base64').toString(), 'test audio');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await atlas.delete();
  }
});
