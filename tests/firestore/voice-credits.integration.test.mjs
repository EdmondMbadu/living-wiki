import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the Firestore emulator for voice credit tests.');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki' });
process.env.VOICE_CREDITS_RELAY_URL = 'https://voice-relay.example.test';
process.env.VOICE_CREDITS_STRIPE_PRICE_ID = 'price_testVoice';
process.env.ELEVENLABS_API_KEY = 'mock-provider-key';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase');
const { reserveBoardVoice, settleVoiceCreditSession, fulfillVoiceCreditPurchase, refundVoiceCreditPurchase,
  voiceCreditsCommand, reconcileVoiceCredits } = require('./lib/voice-credits');
const { createVoiceRelay } = require('./voice-relay.cjs');
const { WebSocket, WebSocketServer } = require('ws');
const stripeModule = require('./lib/stripe-client');

const config = db.doc('voice_credit_settings/policy');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const currentMonth = () => new Date().toISOString().slice(0, 7);
const ticket = (session) => new URL(session.signedUrl).pathname.split('/').at(-1);
const meter = (boardId) => db.doc(`voice_credit_board_months/${hash(`${boardId}:${currentMonth()}`)}`);
const configData = { enabled: true, monthlyMinutes: 6, boardMinutes: 3, changedAt: 1 };
const call = (data, uid, claim = false) => ({
  data, rawRequest: { ip: '127.0.0.1' }, ...(uid ? { auth: { uid, token: { voiceCreditsSuperAdmin: claim } } } : {}),
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await read()) return;
    await pause(50);
  }
  throw new Error('Timed out waiting for state.');
}
async function setup() {
  const boardId = randomUUID();
  const host = randomUUID();
  const guest = randomUUID();
  const cardId = 'avatar';
  await config.set(configData);
  await db.doc(`boards/${boardId}`).set({
    owner_user_id: host, visibility: 'public', title: 'Talking board', cards: [cardId, 'other-card']
      .map((id) => ({ id, conversation: { atlasId: 'agent' } })),
  });
  const input = {
    boardId, cardId, atlasId: 'agent', expectedHost: `user_${host}`, guest, paid: false, agentId: 'agent_test',
    upstream: 'wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=secret',
    providerUserId: `credit_${randomUUID()}`,
  };
  return { host, boardId, input };
}
after(async () => db.terminate());

test('Off bypasses quotas and denies ordinary admins permission to switch', async () => {
  const { input } = await setup();
  await config.set({ ...configData, enabled: false });
  const ordinary = randomUUID();
  const privileged = randomUUID();
  await Promise.all([
    db.doc(`users/${ordinary}`).set({ role: 'admin' }),
    db.doc(`users/${privileged}`).set({ role: 'admin' }),
  ]);
  assert.equal(await reserveBoardVoice(input), null);
  assert.deepEqual(await voiceCreditsCommand.run(call({ action: 'status' }, ordinary)), { enabled: false, admin: false });
  await assert.rejects(voiceCreditsCommand.run(call({ action: 'set-policy', enabled: true }, ordinary)), { code: 'permission-denied' });
  assert.equal((await voiceCreditsCommand.run(call({ action: 'status' }, privileged, true))).admin, true);
  await assert.rejects(voiceCreditsCommand.run(call({ action: 'checkout' }, ordinary)), { code: 'failed-precondition' });
});

test('Concurrent calls share a board cap, interrupted callers resume the remainder, and paid callers use their own wallet', async () => {
  const { host, boardId, input } = await setup();
  const attempts = await Promise.allSettled([reserveBoardVoice(input), reserveBoardVoice({ ...input, guest: randomUUID() })]);
  const success = attempts.find((attempt) => attempt.status === 'fulfilled').value;
  const failure = attempts.find((attempt) => attempt.status === 'rejected').reason;
  assert.equal(success.seconds, 180);
  assert.equal(failure.details.voiceCreditReason, 'sponsored-empty');
  const granted = (await db.doc(`voice_credit_sessions/${ticket(success)}`).get()).data();
  assert.equal(granted.upstream.includes('secret'), true);
  assert.equal(success.signedUrl.includes('secret'), false);
  await Promise.all([settleVoiceCreditSession(ticket(success), 42, Date.now()), settleVoiceCreditSession(ticket(success), 42, Date.now())]);
  assert.equal((await meter(boardId).get()).data().used, 42);

  const actor = randomUUID();
  const paidWallet = db.doc(`voice_credit_wallets/user_${actor}`);
  await paidWallet.set({ seconds: 750 });
  const payingGuest = randomUUID();
  const second = await reserveBoardVoice({ ...input, guest: payingGuest });
  assert.equal(second.seconds, 138);
  // The creator can lower sponsorship to zero. A visitor can still opt in to paid time.
  await db.doc(`voice_credit_board_limits/${boardId}`).set({ minutes: 0 });
  const paid = await reserveBoardVoice({ ...input, uid: actor, guest: payingGuest, paid: true });
  assert.equal(paid.seconds, 600);
  await assert.rejects(reserveBoardVoice({ ...input, uid: actor, guest: payingGuest, paid: true }),
    (error) => error.details.voiceCreditReason === 'in-progress');
  await settleVoiceCreditSession(ticket(second), 100, Date.now(), true);
  await settleVoiceCreditSession(ticket(paid), 55, Date.now());
  assert.equal((await paidWallet.get()).data().seconds, 695);
  assert.equal((await meter(boardId).get()).data().used, 142);
  assert.equal((await db.doc(`voice_credit_wallets/user_${host}`).get()).exists, false);
});

test('A sponsored session is board-wide and another board draws from the same creator pool', async () => {
  const { host, boardId, input } = await setup();
  await config.set({ ...configData, monthlyMinutes: 3 });
  const first = await reserveBoardVoice(input);
  await settleVoiceCreditSession(ticket(first), 150, Date.now(), true);
  const resumed = await reserveBoardVoice(input);
  assert.equal(resumed.seconds, 30);
  await settleVoiceCreditSession(ticket(resumed), 20, Date.now());
  await assert.rejects(reserveBoardVoice({ ...input, cardId: 'other-card' }), (error) => error.details.voiceCreditReason === 'free-used');
  const secondId = randomUUID();
  await db.doc(`boards/${secondId}`).set({ owner_user_id: host, visibility: 'unlisted', cards: [{ id: input.cardId, conversation: { atlasId: input.atlasId } }] });
  const second = await reserveBoardVoice({ ...input, boardId: secondId });
  assert.equal(second.seconds, 10);
  await settleVoiceCreditSession(ticket(second), 10, Date.now());
  assert.equal((await meter(boardId).get()).data().used, 170);
  assert.equal((await meter(secondId).get()).data().used, 10);
});

test('Only a confirmed Checkout credits the wallet, duplicate fulfillment and refunds are harmless', async (t) => {
  await setup();
  const uid = randomUUID();
  let metadata, reference;
  t.mock.method(stripeModule, 'getStripeClient', () => ({
    prices: { retrieve: async () => ({ active: true, type: 'one_time', currency: 'usd', unit_amount: 499 }) },
    checkout: { sessions: { create: async (data) => {
      metadata = data.metadata;
      assert.deepEqual(data.payment_intent_data.metadata, metadata);
      reference = data.client_reference_id;
      assert.match(data.success_url, /^https:\/\/www.livingwiki.com\/boards\/board-a\?voiceCard=avatar&voiceCheckout=success/);
      return { id: 'cs_test_voiceExample', livemode: false, url: 'https://checkout.stripe.com/example' };
    } } },
  }));
  await voiceCreditsCommand.run(call({ action: 'checkout', origin: 'https://www.livingwiki.com', returnPath: '/boards/board-a?voiceCard=avatar' }, uid));
  const doc = db.doc(`voice_credit_wallets/user_${uid}`);
  const report = { id: 'cs_test_voiceExample', metadata, client_reference_id: reference, amount_total: 499,
    currency: 'usd', livemode: false, payment_intent: 'pi_voiceTest', mode: 'payment', payment_status: 'unpaid' };
  assert.equal(await fulfillVoiceCreditPurchase(report), false);
  assert.equal((await doc.get()).exists, false);
  report.payment_status = 'paid';
  assert.equal(await fulfillVoiceCreditPurchase({ ...report, amount_total: 1 }), false);
  assert.equal(await fulfillVoiceCreditPurchase({ ...report, client_reference_id: 'another-user' }), false);
  const charge = { payment_intent: 'pi_voiceTest', amount: 499, amount_refunded: 0, currency: 'usd', livemode: false, metadata };
  const inquiry = { id: 'dp_voiceTest', closed: false, lost: false };
  // Stripe can deliver a dispute before the corresponding Checkout event.
  await refundVoiceCreditPurchase(charge, inquiry);
  assert.deepEqual(await Promise.all([fulfillVoiceCreditPurchase(report), fulfillVoiceCreditPurchase(report)]), [true, true]);
  assert.equal((await doc.get()).data().seconds, 0);
  await refundVoiceCreditPurchase(charge, { ...inquiry, closed: true });
  await refundVoiceCreditPurchase(charge, inquiry);
  assert.equal((await doc.get()).data().seconds, 3600);
  const refund = { ...charge, amount_refunded: 499 };
  await Promise.all([refundVoiceCreditPurchase(refund), refundVoiceCreditPurchase(refund)]);
  assert.equal((await doc.get()).data().seconds, 0);
});

test('The relay ends the upstream connection at the real limit and switching Off stops charging active calls', async (t) => {
  const { boardId, input } = await setup();
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(upstream, 'listening');
  const relay = createVoiceRelay(db, () => new WebSocket(`ws://127.0.0.1:${upstream.address().port}`));
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  t.after(async () => {
    upstream.clients.forEach((client) => client.terminate());
    relay.closeAllConnections();
    await Promise.all([new Promise((resolve) => upstream.close(resolve)), new Promise((resolve) => relay.close(resolve))]);
  });
  let received;
  let upstreamClosed;
  upstream.on('connection', (socket) => {
    upstreamClosed = once(socket, 'close');
    socket.once('message', (bytes) => {
      received = JSON.parse(bytes.toString());
      socket.send(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: {
        conversation_id: 'conv_verified',
      } }));
    });
  });
  async function connect(session) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.address().port}/session/${ticket(session)}?source=js_sdk&version=1.0.0`);
    await once(ws, 'open');
    const message = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', user_id: 'wrong',
      dynamic_variables: { atlas_id: 'wrong', visitor_id: 'wrong' },
      conversation_config_override: { conversation: { max_duration_seconds: 7200 } } }));
    await message;
    return ws;
  }
  await meter(boardId).set({ used: 179 });
  const session = await reserveBoardVoice(input);
  const ws = await connect(session);
  assert.equal(received.user_id, input.providerUserId);
  assert.equal(received.dynamic_variables.atlas_id, input.atlasId);
  assert.equal(received.dynamic_variables.visitor_id, input.providerUserId);
  assert.equal(received.conversation_config_override.conversation, undefined);
  const [code] = await once(ws, 'close');
  assert.equal(code, 4000);
  await upstreamClosed;
  const sessionRef = db.doc(`voice_credit_sessions/${ticket(session)}`);
  await waitFor(async () => (await sessionRef.get()).data()?.reconcileAt <= Date.now());

  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), 'https://api.elevenlabs.io/v1/convai/conversations/conv_verified');
    return Response.json({ conversation_id: 'conv_verified', user_id: input.providerUserId, agent_id: input.agentId, status: 'done',
      metadata: { call_duration_secs: 1, start_time_unix_secs: Math.floor(Date.now() / 1000) - 1 } });
  });
  await reconcileVoiceCredits.run({});
  assert.equal((await sessionRef.get()).data().seconds, 1);

  await meter(boardId).set({ used: 179 });
  const next = await reserveBoardVoice({ ...input, guest: randomUUID(), providerUserId: 'credit_off' });
  const nextSocket = await connect(next);
  const offAt = Date.now();
  await config.set({ ...configData, enabled: false, lastDisabledAt: offAt });
  const nextRef = db.doc(`voice_credit_sessions/${ticket(next)}`);
  await waitFor(async () => (await nextRef.get()).data()?.disabledAt === offAt);
  await pause(1100);
  assert.equal(nextSocket.readyState, WebSocket.OPEN);
  const nextClosed = once(nextSocket, 'close');
  nextSocket.close();
  await nextClosed;
  await upstreamClosed;
  await waitFor(async () => (await nextRef.get()).data()?.reconcileAt <= Date.now());
  await settleVoiceCreditSession(ticket(next), 4, offAt);
  assert.equal((await nextRef.get()).data().seconds, 0);
  assert.equal(await reserveBoardVoice({ ...input, guest: randomUUID() }), null);
});
