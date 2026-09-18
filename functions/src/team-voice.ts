import { isLinkReadableVisibility } from './board-visibility';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { isActiveTeamMember, requireTeamMember, requireVoiceGrant } from './teams';
import { teamText, type TeamRecord } from './team-model';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function teamWorkingBoard(boardId: string, uid: string): Promise<TeamRecord | null> {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(boardId)) return null;
  const board = (await db.collection('team_boards').doc(boardId).get()).data();
  if (!board) return null;
  const { team } = await requireTeamMember(board['team_id'], uid);
  if (team['status'] !== 'active' || board['team_status'] === 'archived')
    throw new HttpsError('failed-precondition', 'Restore this team listing before editing.');
  return board;
}

export async function teamVoiceBinding(
  boardId: string,
  uid: string | null,
  publicOnly = false,
): Promise<{
  board: TeamRecord;
  config: TeamRecord;
  providerVoiceId: string;
  internal: boolean;
} | null> {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(boardId)) return null;
  const [publicDoc, draftDoc, configDoc] = await db.getAll(
    db.collection('boards').doc(boardId),
    db.collection('team_boards').doc(boardId),
    db.collection('team_published_configs').doc(boardId),
  );
  const draft = draftDoc.data();
  const published = publicDoc.data();
  if (!draft?.['team_id'] && !published?.['team_id']) return null;
  const teamId = draft?.['team_id'] || published?.['team_id'];
  const internal = !!uid && (await isActiveTeamMember(teamId, uid));
  const board = internal && !publicOnly ? draft : published;
  const config = internal && !publicOnly ? draft : configDoc.data();
  if (!board || !config || (!internal && !isLinkReadableVisibility(board['visibility'])))
    throw new HttpsError('permission-denied', 'This team listing is not available.');
  const team = (await db.collection('teams').doc(teamId).get()).data();
  if (team?.['status'] !== 'active')
    throw new HttpsError('permission-denied', 'This team is not active.');
  let providerVoiceId = '';
  if (config['voice_owner_id']) {
    try {
      await requireVoiceGrant(
        teamId,
        config['voice_owner_id'],
        config['voice_id'],
        config['voice_revision'],
      );
      const voice = (
        await db
          .collection('user_narrator_voices')
          .doc(config['voice_owner_id'])
          .collection('voices')
          .doc(config['voice_id'])
          .get()
      ).data();
      providerVoiceId = voice?.['provider_voice_id'] || '';
    } catch {
      // A revoked grant never silently falls back to someone else's personal voice.
      providerVoiceId = '';
    }
  }
  return { board, config, providerVoiceId, internal };
}

export async function issueTeamVoiceSession(
  binding: NonNullable<Awaited<ReturnType<typeof teamVoiceBinding>>>,
  boardId: string,
  agentId: string,
  visitorId: string,
): Promise<string> {
  const sessionId = `team_${randomUUID()}`;
  await db
    .collection('team_voice_sessions')
    .doc(sessionId)
    .create({
      teamId: binding.board['team_id'],
      boardId,
      agentId,
      representativeId: binding.config['representative_id'] || '',
      visitorHash: hash(visitorId),
      internal: binding.internal,
      issued_at_ms: Date.now(),
      expires_at: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
      conversationId: null,
    });
  return sessionId;
}

/** Mirrors ElevenLabs' documented v0 HMAC over timestamp.rawBody, with constant-time comparison. */
export function verifyTeamVoiceWebhook(
  body: Buffer,
  header: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!secret || body.length > 2_000_000) return false;
  const parts = header.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2) || '';
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 30 * 60_000)
    return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  return parts
    .filter((part) => /^v0=[0-9a-f]{64}$/i.test(part))
    .some((part) => timingSafeEqual(expected, Buffer.from(part.slice(3), 'hex')));
}

export async function recordVerifiedTeamCall(event: TeamRecord): Promise<void> {
  if (event['type'] !== 'post_call_transcription') return;
  const data = event['data'] || {};
  const sessionId = teamText(data['user_id'], 100);
  const conversationId = teamText(data['conversation_id'], 180);
  if (!/^team_[a-f0-9-]{36}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,180}$/.test(conversationId))
    return;
  const seconds = Number(data['metadata']?.['call_duration_secs']);
  const start = Number(data['metadata']?.['start_time_unix_secs']) * 1000;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 6 * 3600 || !Number.isFinite(start))
    throw new Error('Invalid call timing.');
  await db.runTransaction(async (tx) => {
    const sessionRef = db.collection('team_voice_sessions').doc(sessionId);
    const callRef = db.collection('team_conversations').doc(conversationId);
    const [sessionDoc, existing] = await tx.getAll(sessionRef, callRef);
    const session = sessionDoc.data();
    if (
      !session ||
      existing.exists ||
      session['conversationId'] ||
      session['agentId'] !== data['agent_id']
    )
      return;
    if (start < session['issued_at_ms'] - 60_000 || start > session['issued_at_ms'] + 60 * 60_000)
      return;
    const teamRef = db.collection('teams').doc(session['teamId']);
    const runtimeRef = teamRef.collection('runtime').doc('voice_webhook');
    const [team, listing, runtime] = await tx.getAll(
      teamRef,
      db.collection('team_boards').doc(session['boardId']),
      runtimeRef,
    );
    if (
      !['active', 'archived'].includes(team.data()?.['status']) ||
      listing.data()?.['team_id'] !== session['teamId']
    )
      return;
    const day = new Date(start).toISOString().slice(0, 10);
    tx.update(sessionRef, { conversationId });
    const transcript = Array.isArray(data['transcript'])
      ? data['transcript'].slice(0, 100).map((turn: TeamRecord) => ({
          role: turn['role'] === 'user' ? 'user' : 'agent',
          message: teamText(turn['message'], 2000),
          seconds: Number(turn['time_in_call_secs']) || 0,
        }))
      : [];
    tx.create(callRef, {
      teamId: session['teamId'],
      boardId: session['boardId'],
      representativeId: session['representativeId'],
      startedAt: new Date(start).toISOString(),
      durationSeconds: seconds,
      transcript,
      internal: session['internal'],
      expires_at: Timestamp.fromMillis(Date.now() + 90 * 86_400_000),
    });
    tx.set(runtimeRef, {
      verified: true,
      first_verified_at: runtime.data()?.['first_verified_at'] || new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    });
    if (!session['internal']) {
      tx.set(
        db
          .collection('team_analytics_daily')
          .doc(hash(`${session['teamId']}:${session['boardId']}:${day}`)),
        {
          teamId: session['teamId'],
          boardId: session['boardId'],
          representativeId: session['representativeId'],
          day,
          voiceSeconds: FieldValue.increment(seconds),
        },
        { merge: true },
      );
    }
  });
}

// Prepared for a future provider integration, but intentionally not exported from index.ts.
export const teamVoiceWebhook = onRequest(
  // Bind this optional integration's secret only to its endpoint. Declaring a global
  // secret parameter would also block deploying core team functions before provider setup.
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    secrets: ['ELEVENLABS_TEAM_WEBHOOK_SECRET'],
    cors: false,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }
    if (
      !verifyTeamVoiceWebhook(
        request.rawBody,
        request.get('elevenlabs-signature') || '',
        process.env['ELEVENLABS_TEAM_WEBHOOK_SECRET'] || '',
      )
    ) {
      response.status(401).send('Invalid signature');
      return;
    }
    let event: TeamRecord;
    try {
      event = JSON.parse(request.rawBody.toString('utf8'));
    } catch {
      response.status(400).send('Invalid JSON');
      return;
    }
    try {
      await recordVerifiedTeamCall(event);
      response.status(200).send('Received');
    } catch {
      response.status(500).send('Please retry');
    }
  },
);
