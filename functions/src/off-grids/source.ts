import { db, storage } from '../firebase';
import {
  bucketObject,
  isOffGridCard,
  publicPreview,
  sourceSpotId,
  text,
  validCoordinates,
} from './model';
import { resolveWords } from './location';
import sharp from 'sharp';
import { placePhotoUrl, stablePlacePhotoUrl } from '../place-photo';
export async function syncOffGridBoard(boardId: string, attempt = 0): Promise<void> {
  const boardRef = db.doc(`boards/${boardId}`),
    snapshot = await boardRef.get(),
    board = snapshot.data();
  const old = await db.collection('off_grid_spots').where('sourceRef.boardId', '==', boardId).get();
  const cards = Array.isArray(board?.cards)
    ? board.cards.filter((c: any) => c && isOffGridCard(board!, c) && typeof c.id === 'string')
    : [];
  const projected = await Promise.all(
    cards.map(async (card: any) => {
      const id = sourceSpotId(boardId, card.id),
        previous = old.docs.find((d) => d.id === id)?.data();
      let lat = card.locationLat ?? card.tour?.lat,
        lng = card.locationLng ?? card.tour?.lng;
      const words =
        text(card.what3wordsAddress, 240) ||
        text(card.subtitle, 500)
          .match(/\/\/\/([\p{L}\p{M}.'’ -]+\.[\p{L}\p{M}'’ -]+\.[\p{L}\p{M}'’ -]+)/u)?.[1]
          ?.split(' ·')[0]
          ?.trim() ||
        '';
      let area = '';
      if (!validCoordinates(lat, lng) && words) {
        try {
          const resolved = await resolveWords(words);
          lat = resolved.lat;
          lng = resolved.lng;
          area = resolved.nearestPlace;
        } catch {
          /* Preserve an owner-visible repair state instead of inventing a point. */
        }
      }
      const version = snapshot.updateTime?.toDate().toISOString() || new Date().toISOString();
      const now = board!.updated_at_iso || version,
        located = validCoordinates(lat, lng);
      const coverOriginal = bucketObject(card.imageUrl, storage.bucket().name);
      const proxyPhoto = placePhotoUrl(card.imageUrl)
        ? stablePlacePhotoUrl(card.imageUrl, card.placeId)
        : '';
      const sourceCover = coverOriginal || proxyPhoto;
      let coverPath = previous?.coverPath || '',
        coverLargePath = previous?.coverLargePath || '';
      if (
        sourceCover &&
        !previous?.customCover &&
        (!coverPath || previous?.sourceCoverPath !== sourceCover)
      ) {
        try {
          let bytes: Buffer;
          if (coverOriginal) {
            [bytes] = await storage.bucket().file(coverOriginal).download();
          } else {
            const response = await fetch(proxyPhoto, { signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error('Source photo unavailable');
            bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 10 * 1024 * 1024) throw new Error('Photo too large');
          }
          const image = sharp(bytes, { limitInputPixels: 40000000 }).rotate();
          const base = `off-grid-media/${board!.owner_user_id}/${id}/source-${Buffer.from(version).toString('hex')}`;
          const small = await image
              .clone()
              .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer(),
            large = await image
              .clone()
              .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 85 })
              .toBuffer();
          coverPath = base + '/cover.webp';
          coverLargePath = base + '/cover-large.webp';
          await Promise.all([
            storage
              .bucket()
              .file(coverPath)
              .save(small, {
                metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
              }),
            storage
              .bucket()
              .file(coverLargePath)
              .save(large, {
                metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
              }),
          ]);
        } catch {
          coverPath = '';
          coverLargePath = '';
        }
      }
      const creatorUid = card.contributorUserId || board!.owner_user_id;
      const spot = {
        ...previous,
        ownerUid: board!.owner_user_id,
        creatorUid,
        creatorName:
          text(card.contributorName, 80) ||
          text(board!.owner_display_name, 80) ||
          text(board!.owner_name, 80) ||
          text(board!.author_name, 80) ||
          'A LivingWiki explorer',
        title: text(card.title, 80),
        tip: text(card.notes, 1600),
        location: located
          ? {
              lat,
              lng,
              words,
              source: 'legacy',
              confirmedAt: now,
              area: area || previous?.location?.area || '',
            }
          : null,
        status: located ? 'active' : 'needs-location',
        visibility: board!.visibility === 'public' && !card.authorOnly ? 'public' : 'private',
        createdAt: previous?.createdAt || card.createdAt || board!.created_at_iso || now,
        updatedAt: now,
        sourceRef: { boardId, cardId: card.id },
        sourceVersion: version,
        sourceCoverPath: sourceCover || '',
        coverPath,
        coverLargePath,
        allowContributions: previous?.allowContributions !== false,
        clipCount: previous?.clipCount || 0,
      };
      const legacyPath = bucketObject(card.talkDrop?.url, storage.bucket().name);
      return { id, spot, legacyPath, caption: text(card.talkDrop?.fileName, 120) };
    }),
  );
  let committed = true;
  const keep = new Set(projected.map((p) => p.id));
  const removed = old.docs.filter((d) => !keep.has(d.id));
  const batches = Math.max(1, Math.ceil(projected.length / 100), Math.ceil(removed.length / 100));
  for (let batch = 0; batch < batches && committed; batch++) {
    const incoming = projected.slice(batch * 100, (batch + 1) * 100),
      withdrawn = removed.slice(batch * 100, (batch + 1) * 100);
    committed = await db.runTransaction(async (tx) => {
      const current = await tx.get(boardRef);
      if (current.updateTime?.toMillis() !== snapshot.updateTime?.toMillis()) return false;
      const latest = await Promise.all(
        incoming.map((p) => tx.get(db.doc(`off_grid_spots/${p.id}`))),
      );
      const clips = await Promise.all(
        incoming.map((p) => tx.get(db.doc(`off_grid_spots/${p.id}/pin_talks/legacy`))),
      );
      for (let i = 0; i < incoming.length; i++) {
        const p = incoming[i],
          managed = latest[i].data();
        // A slow source image download must not overwrite a concurrent PinTalk,
        // cover selection, access note or contribution preference.
        if (managed) {
          p.spot.clipCount = managed.clipCount || 0;
          p.spot.allowContributions = managed.allowContributions !== false;
          Object.assign(p.spot, {
            ...(managed.accessNote ? { accessNote: managed.accessNote } : {}),
            ...(managed.customCover
              ? {
                  customCover: true,
                  coverPath: managed.coverPath,
                  coverLargePath: managed.coverLargePath,
                }
              : {}),
          });
        }
        if (p.legacyPath) {
          if (!clips[i].exists) {
            p.spot.clipCount++;
            tx.set(clips[i].ref, {
              legacyPath: p.legacyPath,
              contributorUid: p.spot.creatorUid,
              contributorName: p.spot.creatorName,
              approval: 'approved',
              featured: !managed?.clipCount,
              duration: null,
              caption: p.caption,
              createdAt: p.spot.createdAt,
            });
          } else if (clips[i].data()?.legacyPath !== p.legacyPath)
            tx.update(clips[i].ref, { legacyPath: p.legacyPath });
        } else if (clips[i].exists) {
          tx.delete(clips[i].ref);
          p.spot.clipCount = Math.max(0, p.spot.clipCount - 1);
        }
        tx.set(latest[i].ref, p.spot);
        const preview = publicPreview(p.spot, p.id),
          previewRef = db.doc(`public_off_grid_spots/${p.id}`);
        preview ? tx.set(previewRef, preview) : tx.delete(previewRef);
      }
      for (const doc of withdrawn) {
        tx.update(doc.ref, {
          status: 'deleted',
          visibility: 'private',
          updatedAt: new Date().toISOString(),
        });
        tx.delete(db.doc(`public_off_grid_spots/${doc.id}`));
      }
      return true;
    });
  }
  if (!committed && attempt < 3) await syncOffGridBoard(boardId, attempt + 1);
  if (!committed && attempt >= 3)
    throw new Error('Source board changed repeatedly; retry synchronization.');
}
