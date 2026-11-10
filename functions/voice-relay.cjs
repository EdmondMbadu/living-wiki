const { createServer } = require('node:http');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { WebSocket, WebSocketServer } = require('ws');

const policyPath = 'voice_credit_settings/policy';
const ticketPattern = /^\/session\/([a-f0-9-]{36})$/;
const maxPayload = 512 * 1024;

function createVoiceRelay(db, connect = (url) => new WebSocket(url, { handshakeTimeout: 8_000, maxPayload })) {
  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      db.doc(policyPath).get().then(() => response.end('livingwiki-voice-relay'), () => {
        response.writeHead(503).end();
      });
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const ticket = ticketPattern.exec((request.url || '').split('?')[0])?.[1];
    if (!ticket) return socket.destroy();
    const ref = db.doc(`voice_credit_sessions/${ticket}`);
    const policy = db.doc(policyPath);
    const now = Date.now();
    db.runTransaction(async (tx) => {
      const [config, snapshot] = await Promise.all([tx.get(policy), tx.get(ref)]);
      const session = snapshot.data();
      if (!session || session.state !== 'ready' || session.expiresAt <= now) return null;
      if (config.data()?.enabled !== true || (config.data()?.lastDisabledAt || 0) >= session.createdAt) {
        tx.update(ref, { state: 'failed', reconcileAt: now, upstream: FieldValue.delete() });
        return null;
      }
      const upstream = new URL(session.upstream);
      if (upstream.origin !== 'wss://api.elevenlabs.io' || upstream.pathname !== '/v1/convai/conversation'
        || upstream.username || upstream.password) return null;
      tx.update(ref, {
        state: 'connecting', claimedAt: now, upstream: FieldValue.delete(),
        reconcileAt: now + (session.duration + 45) * 1000,
      });
      return { ...session, upstream: upstream.href };
    }).then((session) => {
      if (!session || socket.destroyed) return socket.destroy();
      sockets.handleUpgrade(request, socket, head, (client) => relay(client, connect(session.upstream), ref, policy, session, db));
    }).catch(() => socket.destroy());
  });
  return server;
}

function relay(client, upstream, ref, policy, session, db) {
  let deadline = Infinity;
  let timeout = setTimeout(() => finish(1011, 'Voice connection interrupted', true), 12_000);
  let unsubscribe = () => {};
  let ended = false;
  let sentInit = false;
  let disabled = false;
  let providerRecorded;
  const pending = [];
  let buffered = 0;

  function finish(code, reason, interrupted = false) {
    if (ended) return;
    ended = true;
    clearTimeout(timeout);
    unsubscribe();
    if (upstream.readyState < WebSocket.CLOSING) upstream.close();
    if (client.readyState < WebSocket.CLOSING) client.close(code, reason);
    void Promise.resolve(providerRecorded).catch(() => {}).then(() => db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).data()?.state === 'settled') return;
      const paidGate = session.mode === 'paid' ? db.doc(`voice_credit_visitor_windows/${session.gateKeys[0]}`) : null;
      const gate = paidGate ? await tx.get(paidGate) : null;
      if (paidGate && gate?.data()?.activeTicket === ref.id) tx.update(paidGate, { activeUntil: 0 });
      tx.update(ref, { interrupted, ...(sentInit ? {} : { state: 'failed' }), reconcileAt: Date.now() });
    })).catch((error) => console.error('Could not queue voice settlement', ref.id, error.code));
  }

  unsubscribe = policy.onSnapshot((snapshot) => {
    const offAt = snapshot.data()?.lastDisabledAt;
    if (!disabled && typeof offAt === 'number' && offAt >= session.createdAt) {
      disabled = true;
      if (providerRecorded) clearTimeout(timeout);
      void ref.update({ disabledAt: offAt }).catch((error) => console.error('Could not record switch-off', ref.id, error.code));
    }
  }, () => finish(1011, 'Voice connection interrupted', true));

  upstream.on('open', () => {
    for (const item of pending) upstream.send(item);
    pending.length = 0;
  });
  client.on('message', (raw, binary) => {
    if (ended) return;
    if (!disabled && Date.now() >= deadline) return finish(4000, 'Voice time reached');
    if (binary) return finish(1008, 'Invalid voice message');
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return finish(1008, 'Invalid voice message'); }
    if (!message || typeof message !== 'object') return finish(1008, 'Invalid voice message');
    if (message.type === 'conversation_initiation_client_data') {
      if (sentInit) return finish(1008, 'Session already started');
      sentInit = true;
      message.user_id = session.providerUserId;
      message.dynamic_variables = {
        ...message.dynamic_variables,
        atlas_id: session.atlasId,
        board_id: session.boardId,
        card_id: session.cardId,
        visitor_id: session.providerUserId,
      };
      // Keep existing persona, language and voice overrides, and own the time limit.
      delete message.conversation_config_override?.conversation;
      delete message.conversation_config_override?.tools;
      delete message.conversation_config_override?.agent?.prompt;
      delete message.branch_id;
      delete message.environment;
    } else if (!sentInit && message.type !== 'pong') {
      return finish(1008, 'Voice session must start first');
    }
    const data = JSON.stringify(message);
    if (upstream.readyState === WebSocket.OPEN) {
      if (upstream.bufferedAmount > maxPayload) return finish(1011, 'Voice connection interrupted', true);
      upstream.send(data);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      buffered += Buffer.byteLength(data);
      if (buffered > maxPayload) return finish(1011, 'Voice connection interrupted', true);
      pending.push(data);
    }
  });
  upstream.on('message', (raw, binary) => {
    if (ended || client.readyState !== WebSocket.OPEN) return;
    if (!disabled && Date.now() >= deadline) return finish(4000, 'Voice time reached');
    if (client.bufferedAmount > maxPayload) return finish(1011, 'Voice connection interrupted', true);
    if (!binary && !providerRecorded) {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { /* provider payload is passed through */ }
      const id = message?.conversation_initiation_metadata_event?.conversation_id;
      if (message?.type === 'conversation_initiation_metadata' && typeof id === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(id)) {
        clearTimeout(timeout);
        if (!disabled) {
          deadline = Date.now() + session.duration * 1000;
          timeout = setTimeout(() => finish(4000, 'Voice time reached'), session.duration * 1000);
        }
        providerRecorded = db.runTransaction(async (tx) => {
          const gates = session.gateKeys.map((key) => db.doc(`voice_credit_visitor_windows/${key}`));
          const snapshots = await Promise.all(gates.map((gate) => tx.get(gate)));
          tx.update(ref, { providerId: id, state: 'connected' });
          if (session.mode === 'sponsored') {
            gates.forEach((gate, index) => {
              const value = snapshots[index].data();
              if (value?.activeTicket !== ref.id) return;
              if ((value.windowEndsAt || 0) <= session.createdAt) tx.set(gate, {
                cardId: session.cardId, windowEndsAt: Date.now() + 86_400_000, seconds: 0, resumeUntil: 0,
              }, { merge: true });
            });
          }
        });
        void providerRecorded.catch(() => finish(1011, 'Voice connection interrupted', true));
      }
    }
    client.send(raw, { binary });
  });
  client.on('close', (code) => finish(1000, 'Voice ended', code !== 1000 && code !== 1005));
  client.on('error', () => finish(1011, 'Voice connection interrupted', true));
  upstream.on('close', (code) => finish(code === 1000 ? 1000 : 1011, 'Voice ended', code !== 1000));
  upstream.on('error', () => finish(1011, 'Voice connection interrupted', true));
}

module.exports = { createVoiceRelay };
if (require.main === module) {
  initializeApp({ credential: applicationDefault() });
  createVoiceRelay(getFirestore()).listen(Number(process.env.PORT) || 8080, '0.0.0.0');
}
