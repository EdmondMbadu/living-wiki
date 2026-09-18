import { createHash } from 'node:crypto';
import { getDownloadURL } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import sharp from 'sharp';
import { db, storage } from './firebase';
import type { BoardWizardListingImage } from './board-wizard-listing';

export type UploadedListingPhoto = { id: string; storagePath: string };
export type PreparedListingPhoto = {
  index: number;
  mimeType: 'image/jpeg';
  base64: string;
  contentHash: string;
  cacheScope: string;
};
export type ListingPhotoUploadScope = { userId: string; teamId: string; draftId: string };

/** Storage references are scoped before any Admin SDK read, including cache hits. */
export function normalizeUploadedListingPhotos(value: unknown, scope: ListingPhotoUploadScope): UploadedListingPhoto[] {
  const validId = /^[A-Za-z0-9_-]{1,180}$/;
  if (!validId.test(scope.draftId) || (scope.teamId && !validId.test(scope.teamId))) {
    throw new HttpsError('invalid-argument', 'Reopen the listing builder before uploading photos.');
  }
  if (!Array.isArray(value) || !value.length || value.length > 24) {
    throw new HttpsError('invalid-argument', 'Choose between 1 and 24 property photos.');
  }
  const prefix = scope.teamId
    ? `team-media/${scope.teamId}/${scope.draftId}/`
    : `users/${scope.userId}/boards/${scope.draftId}/listing-photos/`;
  const ids = new Set<string>();
  const paths = new Set<string>();
  return value.map((item) => {
    const photo = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const id = typeof photo.id === 'string' ? photo.id : '';
    const storagePath = typeof photo.storagePath === 'string' ? photo.storagePath : '';
    if (!validId.test(id) || ids.has(id) || paths.has(storagePath)
      || !storagePath.startsWith(prefix) || storagePath.length > 1000
      || !storagePath.slice(prefix.length) || storagePath.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new HttpsError('invalid-argument', 'An uploaded photo does not belong to this listing draft. Select the photos again.');
    }
    ids.add(id);
    paths.add(storagePath);
    return { id, storagePath };
  });
}

export function assertListingPhotoTeamAccess(team: unknown, member: unknown): void {
  const teamRecord = team as Record<string, unknown> | undefined;
  const memberRecord = member as Record<string, unknown> | undefined;
  if (teamRecord?.['status'] !== 'active' || memberRecord?.['status'] !== 'active') {
    throw new HttpsError('permission-denied', 'Your team access changed. Reopen the listing before using its photos.');
  }
}

export async function loadUploadedListingPhotos(photos: UploadedListingPhoto[], scope: ListingPhotoUploadScope): Promise<{
  images: BoardWizardListingImage[];
  preparedPhotos: PreparedListingPhoto[];
}> {
  photos = normalizeUploadedListingPhotos(photos, scope);
  if (scope.teamId) {
    const [team, member] = await db.getAll(
      db.doc(`teams/${scope.teamId}`), db.doc(`teams/${scope.teamId}/members/${scope.userId}`),
    );
    assertListingPhotoTeamAccess(team.data(), member.data());
  }
  const cacheScope = scope.teamId ? `team:${scope.teamId}` : `user:${scope.userId}`;
  const images: BoardWizardListingImage[] = [];
  const preparedPhotos: PreparedListingPhoto[] = [];
  // Bound image decoding and downloads rather than loading 24 full files at once.
  for (let start = 0; start < photos.length; start += 4) {
    const group = await Promise.all(photos.slice(start, start + 4).map(async (photo, offset) => {
      const index = start + offset;
      const file = storage.bucket().file(photo.storagePath);
      try {
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size);
        if (!/^image\/(jpeg|png|webp)$/.test(metadata.contentType || '') || !size || size > 10 * 1024 * 1024) {
          throw new Error('Invalid photo type or size.');
        }
        const [bytes] = await file.download();
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Invalid photo size.');
        const resized = await sharp(bytes, { limitInputPixels: 30_000_000 }).rotate()
          .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 68, mozjpeg: true }).toBuffer();
        return {
          image: {
            url: scope.teamId ? `team-media:${photo.storagePath}` : await getDownloadURL(file),
            alt: `Uploaded property photo ${index + 1}`,
            evidence: 'user-upload' as const,
          },
          prepared: {
            index, mimeType: 'image/jpeg' as const, base64: resized.toString('base64'),
            contentHash: createHash('sha256').update(resized).digest('hex'), cacheScope,
          },
        };
      } catch {
        throw new HttpsError('failed-precondition', `Uploaded photo ${index + 1} could not be read. Remove it or select it again before generating.`);
      }
    }));
    for (const result of group) { images.push(result.image); preparedPhotos.push(result.prepared); }
  }
  return { images, preparedPhotos };
}
