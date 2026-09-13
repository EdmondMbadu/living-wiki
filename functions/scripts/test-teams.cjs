const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHmac } = require('node:crypto');
const { resolve } = require('node:path');
// Discovery needs a bucket for existing Storage triggers, but never invokes handlers.
// Keep the test process scoped to a demo project, without production credentials.
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'demo-living-wiki',
  storageBucket: 'demo-living-wiki.appspot.com',
});
const { loadStack } = require('../node_modules/firebase-functions/lib/runtime/loader');
const {
  applyTeamSettingsPatch,
  teamSlug,
  teamEmail,
  canPublishTeamListing,
  publicTeamBoard,
  teamPageProjection,
  validInvitation,
  mergeTeamBoard,
  teamListingSummary,
  currentTeamMemberIdentity,
  teamMemberProjection,
} = require('../lib/team-model');
const { teamVoiceWebhook, verifyTeamVoiceWebhook } = require('../lib/team-voice');

test('full Firebase discovery excludes the deferred team webhook and its secret', async () => {
  // Use the same SDK discovery routine as Firebase CLI, not just a source-text check.
  const stack = await loadStack(resolve(__dirname, '..'));
  assert.equal(stack.endpoints.teamVoiceWebhook, undefined);
  for (const [name, endpoint] of Object.entries(stack.endpoints)) {
    assert.equal(
      (endpoint.secretEnvironmentVariables || []).some(
        (secret) => secret.key === 'ELEVENLABS_TEAM_WEBHOOK_SECRET',
      ),
      false,
      `${name} must not require the deferred webhook secret`,
    );
  }
  assert.equal(
    (stack.params || []).some((param) => param.name === 'ELEVENLABS_TEAM_WEBHOOK_SECRET'),
    false,
  );
  for (const name of [
    'teamCommand',
    'getPublicTeamPage',
    'getTeamInvitationPreview',
    'getTeamInsights',
    'submitTeamContact',
    'manageTeamContacts',
    'getTeamConversations',
    'createElevenLabsVoiceSession',
    'synthesizeChatAnswerSpeech',
  ]) {
    assert.ok(stack.endpoints[name], `${name} must remain available`);
  }
});

test('the optional voice webhook retains its secret binding and rejects an unconfigured secret', () => {
  assert.deepEqual(teamVoiceWebhook.__endpoint.secretEnvironmentVariables, [
    { key: 'ELEVENLABS_TEAM_WEBHOOK_SECRET' },
  ]);
  assert.equal(verifyTeamVoiceWebhook(Buffer.from('{}'), '', ''), false);
});

test('team slugs and public contact fields are normalized', () => {
  assert.equal(teamSlug('  Élite Real Estate  '), 'elite-real-estate');
  assert.equal(teamEmail(' AGENT@EXAMPLE.COM '), 'agent@example.com');
  assert.equal(teamEmail('bad email'), '');
  const projected = teamPageProjection('team', {
    name: 'Team',
    accent: 'red; background:url(x)',
    website: 'javascript:alert(1)',
    owner_id: 'private',
    contact_email: 'OK@example.com',
  });
  assert.equal(projected.website, '');
  assert.equal(projected.accent, '#216b4c');
  assert.equal(projected.owner_id, undefined);
});
test('team settings preserve omitted fields, clear optional values, and allowlist writes', () => {
  const original = {
    name: 'Team',
    description: 'Description',
    about: 'About',
    logo_url: 'https://example.com/logo.png',
    hero_url: 'https://example.com/cover.png',
    hero_position: 75,
    accent: '#123456',
    website: 'https://example.com/',
    contact_email: 'team@example.com',
    contact_phone: '123',
    public_enabled: true,
    owner_id: 'owner',
    slug: 'team',
    revision: 4,
  };
  const logoOnly = applyTeamSettingsPatch(original, { logoUrl: 'https://example.com/new.png' });
  assert.deepEqual(logoOnly, { ...original, logo_url: 'https://example.com/new.png' });
  const cleared = applyTeamSettingsPatch(original, {
    name: '  ',
    description: '',
    about: '',
    logoUrl: '',
    heroUrl: '',
    website: '',
    contactEmail: '',
    contactPhone: '',
    accent: '',
    owner_id: 'attacker',
    slug: 'changed',
    revision: 99,
  });
  assert.deepEqual(cleared, {
    ...original,
    description: '',
    about: '',
    logo_url: '',
    hero_url: '',
    hero_position: 50,
    website: '',
    contact_email: '',
    contact_phone: '',
    accent: '#216b4c',
  });
  assert.equal(applyTeamSettingsPatch(original, { publicEnabled: false }).public_enabled, false);
  assert.equal(applyTeamSettingsPatch(original, { heroUrl: null }).hero_url, '');
  assert.equal(original.hero_position, 75);
});
test('team membership does not imply publication or private-contact authority', () => {
  assert.equal(canPublishTeamListing('member', 'a', { representative_id: 'b' }), false);
  assert.equal(canPublishTeamListing('member', 'b', { representative_id: 'b' }), true);
  assert.equal(canPublishTeamListing('admin', 'a', { representative_id: 'b' }), true);
});
test('team avatars resolve the current profile, including icon changes and photo removal', () => {
  const member = {
    name: 'Original',
    photo_url: 'https://example.com/old.jpg',
    role: 'member',
    public_visible: false,
  };
  const current = currentTeamMemberIdentity(member, {
    displayName: 'Updated',
    profilePictureType: 'image',
    photoURL: 'https://example.com/current.jpg',
    email: 'private@example.com',
    role: 'admin',
  });
  assert.equal(current.photo_url, 'https://example.com/current.jpg');
  assert.equal(current.name, 'Updated');
  assert.equal(current.role, 'member');
  assert.equal(current.public_visible, false);
  assert.equal(current.email, undefined);
  assert.equal(teamMemberProjection('agent', current).photoUrl, 'https://example.com/current.jpg');
  const icon = currentTeamMemberIdentity(member, {
    profilePictureType: 'icon',
    profileIcon: 'city-scribe',
    photoURL: 'https://example.com/old.jpg',
  });
  assert.equal(icon.photo_url, '');
  assert.equal(teamMemberProjection('agent', icon).profileIcon, 'city-scribe');
  assert.equal(
    currentTeamMemberIdentity(member, { profilePictureType: null, photoURL: null }).photo_url,
    '',
  );
  assert.equal(currentTeamMemberIdentity(member, undefined), member);
  assert.equal(
    currentTeamMemberIdentity(member, { displayName: 'Legacy' }).photo_url,
    member.photo_url,
  );
  assert.equal(
    currentTeamMemberIdentity(member, {
      profilePictureType: 'image',
      photoURL: 'javascript:alert(1)',
    }).photo_url,
    '',
  );
});
test('invitations require matching email, pending state, and an unexpired deadline', () => {
  const invitation = { email: 'person@example.com', status: 'pending', expires_at_ms: 2000 };
  assert.equal(validInvitation(invitation, 'person@example.com', 1000), true);
  assert.equal(validInvitation(invitation, 'person@example.com', 2000), false);
  assert.equal(validInvitation(invitation, 'another@example.com', 1000), false);
  assert.equal(
    validInvitation({ ...invitation, status: 'accepted' }, 'person@example.com', 1000),
    false,
  );
});
test('public snapshots exclude work notes, private cards, grants, email lists, and unknown fields', () => {
  const board = publicTeamBoard(
    {
      id: 'b',
      title: 'Home',
      backNote: 'INTERNAL',
      secret: 'private',
      voice_owner_id: 'secret-owner',
      cards: [
        {
          id: 'c',
          title: 'Living room',
          stackNarration: 'Bright and spacious.',
          contactDetails: { name: 'Agent', email: 'public@example.com' },
          secret: 'private',
          conversation: {
            version: 1,
            provider: 'atlas',
            atlasId: 'public-avatar',
            openingMessage: 'Hello',
            privateKey: 'secret',
          },
          relatedCards: [
            { id: 'private-child', authorOnly: true },
            { id: 'safe-child', title: 'Bedroom', internal: 'secret' },
          ],
        },
        { id: 'hidden', authorOnly: true },
      ],
    },
    't',
    { name: 'Team' },
    'now',
  );
  assert.equal(board.owner_user_id, 'team:t');
  assert.equal(board.backNote, undefined);
  assert.equal(board.secret, undefined);
  assert.equal(board.voice_owner_id, undefined);
  assert.equal(board.cards.length, 1);
  assert.equal(board.cards[0].secret, undefined);
  assert.equal(board.cards[0].conversation.privateKey, undefined);
  assert.equal(board.cards[0].relatedCards.length, 1);
  assert.equal(board.cards[0].stackNarration, 'Bright and spacious.');
  assert.equal(board.cards[0].contactDetails.email, 'public@example.com');
});
test('three-way merge keeps independent card edits and current metadata', () => {
  const base = {
    title: 'Home',
    cards: [
      { id: 'a', notes: 'before a' },
      { id: 'b', notes: 'before b' },
    ],
  };
  const live = { ...base, cards: [{ id: 'a', notes: 'colleague a' }, base.cards[1]] };
  const incoming = { ...base, cards: [base.cards[0], { id: 'b', notes: 'my b' }] };
  const merged = mergeTeamBoard(live, base, incoming);
  assert.equal(merged.cards[0].notes, 'colleague a');
  assert.equal(merged.cards[1].notes, 'my b');
});
test('conflicting edits, deletes, and reorders never silently replace a colleague’s work', () => {
  const base = { title: 'Home', cards: [{ id: 'a', notes: 'before' }, { id: 'b' }] };
  const live = { ...base, cards: [{ id: 'a', notes: 'colleague' }, { id: 'b' }] };
  assert.throws(
    () => mergeTeamBoard(live, base, { ...base, cards: [{ id: 'a', notes: 'mine' }, { id: 'b' }] }),
    /conflict/,
  );
  assert.throws(() => mergeTeamBoard(live, base, { ...base, cards: [{ id: 'b' }] }), /conflict/);
  assert.throws(
    () =>
      mergeTeamBoard({ ...base, cards: [...base.cards, { id: 'c' }] }, base, {
        ...base,
        cards: [...base.cards].reverse(),
      }),
    /conflict/,
  );
  assert.throws(
    () => mergeTeamBoard({ ...base, title: 'Theirs' }, base, { ...base, title: 'Mine' }),
    /conflict/,
  );
});
test('published-state counters remain distinct from unsaved public changes', () => {
  assert.equal(
    teamListingSummary({
      id: 'b',
      team_status: 'published',
      team_revision: 3,
      published_revision: 2,
    }).hasUnpublishedChanges,
    true,
  );
  assert.equal(
    teamListingSummary({ id: 'b', team_status: 'draft', team_revision: 3, published_revision: 0 })
      .hasUnpublishedChanges,
    false,
  );
});
test('ElevenLabs signatures use raw bytes, reject stale/future timestamps, and compare safely', () => {
  const body = Buffer.from('{"type":"post_call_transcription"}');
  const timestamp = 1800000000;
  const secret = 'test-only-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  const header = `t=${timestamp},v0=${signature}`;
  assert.equal(verifyTeamVoiceWebhook(body, header, secret, timestamp * 1000), true);
  assert.equal(verifyTeamVoiceWebhook(Buffer.from('{}'), header, secret, timestamp * 1000), false);
  assert.equal(verifyTeamVoiceWebhook(body, header, secret, (timestamp + 1900) * 1000), false);
  assert.equal(verifyTeamVoiceWebhook(body, header, secret, (timestamp - 1900) * 1000), false);
  assert.equal(verifyTeamVoiceWebhook(body, 't=bad,v0=00', secret, timestamp * 1000), false);
});
