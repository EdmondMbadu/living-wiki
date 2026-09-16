import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-living-wiki',
    storage: { rules: await readFile(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    await uploadBytes(
      ref(c.storage(), 'off-grid-media/owner/gem/clip/playback.mp4'),
      new Uint8Array([1, 2, 3]),
      { contentType: 'video/mp4' },
    );
  });
});
after(async () => {
  await env?.cleanup();
});
test('originals and renditions require server-issued upload/access checks, even for the owner', async () => {
  for (const c of [
    env.unauthenticatedContext(),
    env.authenticatedContext('owner'),
    env.authenticatedContext('stranger'),
  ]) {
    await assertFails(getBytes(ref(c.storage(), 'off-grid-media/owner/gem/clip/playback.mp4')));
    await assertFails(
      uploadBytes(ref(c.storage(), 'off-grid-originals/owner/gem/fake'), new Uint8Array([1, 2]), {
        contentType: 'video/mp4',
      }),
    );
    await assertFails(
      uploadBytes(
        ref(c.storage(), 'off-grid-media/owner/gem/fake/playback.mp4'),
        new Uint8Array([1, 2]),
        { contentType: 'video/mp4' },
      ),
    );
  }
});
