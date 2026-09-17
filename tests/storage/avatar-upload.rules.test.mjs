import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-living-wiki';
const ownerUid = 'avatar-owner';
const otherUid = 'another-user';
let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await Promise.all([
    testEnvironment.clearFirestore(),
    testEnvironment.clearStorage(),
  ]);
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'atlases', 'new-avatar'), {
      user_id: ownerUid,
      admin_user_ids: [],
      is_public: false,
    });
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

async function seedTeam() {
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'teams', 'team-a'), { status: 'active' });
    await setDoc(doc(context.firestore(), 'teams', 'team-a', 'members', ownerUid), { status: 'active', role: 'admin' });
    await setDoc(doc(context.firestore(), 'teams', 'team-a', 'members', 'team-member'), { status: 'active', role: 'member' });
  });
}

test('team media is private, immutable, membership-scoped, and revoked immediately on removal', async () => {
  await seedTeam();
  const path = 'team-media/team-a/listing-a/image.png';
  const owner = testEnvironment.authenticatedContext(ownerUid).storage();
  const member = testEnvironment.authenticatedContext('team-member').storage();
  await assertSucceeds(uploadBytes(ref(member, path), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ref(owner, path)));
  await assertSucceeds(getBytes(ref(member, path)));
  await assertFails(getBytes(ref(testEnvironment.unauthenticatedContext().storage(), path)));
  await assertFails(getBytes(ref(testEnvironment.authenticatedContext(otherUid).storage(), path)));
  await assertFails(uploadBytes(ref(owner, path), new Uint8Array([4]), { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(member, path)));
  await assertFails(uploadBytes(ref(member, 'team-media/team-a/listing-a/script.svg'), new Uint8Array([1]), { contentType: 'image/svg+xml' }));
  await testEnvironment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'teams', 'team-a', 'members', 'team-member'), { status: 'removed', role: 'member' }));
  await assertFails(getBytes(ref(member, path)));
});

test('team branding is public-readable but only team admins can upload it', async () => {
  await seedTeam();
  const path = 'team-branding/team-a/logo.png';
  const admin = testEnvironment.authenticatedContext(ownerUid).storage();
  await assertSucceeds(uploadBytes(ref(admin, path), new Uint8Array([1]), { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ref(testEnvironment.unauthenticatedContext().storage(), path)));
  await assertFails(uploadBytes(ref(testEnvironment.authenticatedContext('team-member').storage(), 'team-branding/team-a/other.png'), new Uint8Array([1]), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(admin, 'team-branding/team-b/logo.png'), new Uint8Array([1]), { contentType: 'image/png' }));
});

test('only explicitly authorized board admins can view private board media across teams and owners', async () => {
  const paths = [
    'team-media/team-a/listing-a/image.png',
    'public-team-media/team-a/listing-a/image.png',
    `users/${ownerUid}/video-library/boards/private-board/full/vertical/video.mp4`,
  ];
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', 'board-admin'), { role: 'admin', board_admin_access: true });
    await setDoc(doc(context.firestore(), 'users', 'platform'), { role: 'admin' });
    await setDoc(doc(context.firestore(), 'users', 'flagged-user'), { role: 'user', board_admin_access: true });
    await setDoc(doc(context.firestore(), 'teams', 'team-a'), { status: 'archived' });
    for (const path of [...paths, `users/${ownerUid}/voice-samples/private.mp3`, `users/${ownerUid}/video-library/personal.mp4`]) {
      await uploadBytes(ref(context.storage(), path), new Uint8Array([1]), { contentType: path.endsWith('.png') ? 'image/png' : 'video/mp4' });
    }
  });
  const admin = testEnvironment.authenticatedContext('board-admin').storage();
  const outsider = testEnvironment.authenticatedContext(otherUid).storage();
  for (const path of paths) {
    await assertSucceeds(getBytes(ref(admin, path)));
    await assertFails(getBytes(ref(outsider, path)));
    await assertFails(getBytes(ref(testEnvironment.authenticatedContext('platform').storage(), path)));
    await assertFails(getBytes(ref(testEnvironment.authenticatedContext('flagged-user').storage(), path)));
    await assertFails(getBytes(ref(testEnvironment.unauthenticatedContext().storage(), path)));
    await assertFails(deleteObject(ref(admin, path)));
    await assertFails(uploadBytes(ref(admin, path), new Uint8Array([2]), { contentType: 'image/png' }));
  }
  await assertFails(uploadBytes(ref(admin, 'team-media/team-a/listing-a/new.png'), new Uint8Array([2]), { contentType: 'image/png' }));
  await assertFails(getBytes(ref(admin, `users/${ownerUid}/voice-samples/private.mp3`)));
  await assertFails(getBytes(ref(admin, `users/${ownerUid}/video-library/personal.mp4`)));
  await testEnvironment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'board-admin'), { role: 'admin', board_admin_access: false }));
  for (const path of paths) await assertFails(getBytes(ref(admin, path)));
});

test('published team media requires the matching public snapshot and becomes private when unpublished', async () => {
  await seedTeam();
  const path = 'public-team-media/team-a/listing-a/image.png';
  await testEnvironment.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage(), path), new Uint8Array([1]), { contentType: 'image/png' });
    await setDoc(doc(context.firestore(), 'boards', 'listing-a'), { visibility: 'public', team_id: 'team-a' });
  });
  const visitor = testEnvironment.unauthenticatedContext().storage();
  await assertSucceeds(getBytes(ref(visitor, path)));
  await testEnvironment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'boards', 'listing-a'), { visibility: 'private', team_id: 'team-a' }));
  await assertFails(getBytes(ref(visitor, path)));
});

test('private board videos and trailers in both formats are readable only by the owner', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  const outsiderStorage = testEnvironment.authenticatedContext(otherUid).storage();
  const publicStorage = testEnvironment.unauthenticatedContext().storage();
  for (const kind of ['full', 'trailer']) {
    for (const ratio of ['vertical', 'landscape']) {
      const path = `users/${ownerUid}/video-library/boards/private-board/${kind}/${ratio}/video.mp4`;
      await assertSucceeds(uploadBytes(ref(ownerStorage, path), new Uint8Array([1, 2, 3]), { contentType: 'video/mp4' }));
      await assertSucceeds(getBytes(ref(ownerStorage, path)));
      await assertFails(getBytes(ref(outsiderStorage, path)));
      await assertFails(getBytes(ref(publicStorage, path)));
      await assertFails(uploadBytes(ref(outsiderStorage, path), new Uint8Array([4]), { contentType: 'video/mp4' }));
    }
  }
});

test('owner can upload and delete a public-readable image in their avatar namespace', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  const portrait = ref(ownerStorage, `users/${ownerUid}/avatars/new-avatar/chat-guide.png`);

  await assertSucceeds(uploadBytes(portrait, new Uint8Array([1, 2, 3]), { contentType: 'image/png' }));
  const publicStorage = testEnvironment.unauthenticatedContext().storage();
  await assertSucceeds(getBytes(ref(publicStorage, portrait.fullPath)));
  await assertSucceeds(deleteObject(portrait));
});

test('another user cannot write to or delete an owners avatar namespace', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  const portraitPath = `users/${ownerUid}/avatars/new-avatar/chat-guide.png`;
  await assertSucceeds(uploadBytes(ref(ownerStorage, portraitPath), new Uint8Array([1]), { contentType: 'image/png' }));

  const otherStorage = testEnvironment.authenticatedContext(otherUid).storage();
  await assertFails(uploadBytes(ref(otherStorage, portraitPath), new Uint8Array([2]), { contentType: 'image/png' }));
  await assertFails(deleteObject(ref(otherStorage, portraitPath)));
});

test('avatar namespace rejects non-image content and images at the ten megabyte boundary', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  await assertFails(uploadBytes(
    ref(ownerStorage, `users/${ownerUid}/avatars/new-avatar/not-an-image.txt`),
    new Uint8Array([1]),
    { contentType: 'text/plain' },
  ));
  await assertFails(uploadBytes(
    ref(ownerStorage, `users/${ownerUid}/avatars/new-avatar/too-large.png`),
    new Uint8Array(10 * 1024 * 1024),
    { contentType: 'image/png' },
  ));
});

test('existing Atlas-owner image uploads remain allowed and outsiders remain denied', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  const existingPath = 'atlases/new-avatar/chat-guide.png';
  await assertSucceeds(uploadBytes(ref(ownerStorage, existingPath), new Uint8Array([1]), { contentType: 'image/png' }));

  const otherStorage = testEnvironment.authenticatedContext(otherUid).storage();
  await assertFails(uploadBytes(ref(otherStorage, existingPath), new Uint8Array([2]), { contentType: 'image/png' }));
});

test('voice samples accept audio through 60 MB and reject larger uploads', async () => {
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  const bytes = new Uint8Array((60 * 1024 * 1024) + 1);
  await assertSucceeds(uploadBytes(
    ref(ownerStorage, `users/${ownerUid}/voice-samples/new/at-limit.wav`),
    bytes.subarray(0, 60 * 1024 * 1024),
    { contentType: 'audio/wav' },
  ));
  await assertFails(uploadBytes(
    ref(ownerStorage, `users/${ownerUid}/voice-samples/new/over-limit.wav`),
    bytes,
    { contentType: 'audio/wav' },
  ));
});

test('voice samples remain private and reject non-audio content', async () => {
  const path = `users/${ownerUid}/voice-samples/new/private.mp3`;
  const ownerStorage = testEnvironment.authenticatedContext(ownerUid).storage();
  await assertSucceeds(uploadBytes(ref(ownerStorage, path), new Uint8Array([1]), { contentType: 'audio/mpeg' }));

  const otherStorage = testEnvironment.authenticatedContext(otherUid).storage();
  await assertFails(getBytes(ref(otherStorage, path)));
  await assertFails(uploadBytes(ref(otherStorage, path), new Uint8Array([2]), { contentType: 'audio/mpeg' }));
  await assertFails(uploadBytes(
    ref(ownerStorage, `users/${ownerUid}/voice-samples/new/not-audio.txt`),
    new Uint8Array([1]),
    { contentType: 'text/plain' },
  ));
});
