import { randomUUID } from 'node:crypto';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, storage } from '../firebase';
import {
  bucketObject,
  isOffGridCard,
  pointFrom,
  publicPreview,
  rangeFrom,
  sourceSpotId,
  text,
  validCoordinates,
} from './model';
import { resolveWords, wordsForPoint } from './location';
import { processUpload } from './media';
const region = 'us-central1';
const identifier = (v: unknown): string => {
  const id = text(v, 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new HttpsError('invalid-argument', 'Invalid gem identifier.');
  return id;
};
export async function effectivePublic(
  spot: Record<string, any>,
  providedSource?: FirebaseFirestore.DocumentData | null,
): Promise<boolean> {
  if (spot.visibility !== 'public' || spot.status !== 'active') return false;
  if (!spot.sourceRef) return true;
  const source =
    providedSource === undefined
      ? (await db.doc(`boards/${spot.sourceRef.boardId}`).get()).data()
      : providedSource;
  return (
    source?.visibility === 'public' &&
    Array.isArray(source.cards) &&
    source.cards.some(
      (c: any) => c.id === spot.sourceRef.cardId && !c.authorOnly && isOffGridCard(source, c),
    )
  );
}
async function canContribute(spot: Record<string, any>, uid: string): Promise<boolean> {
  if (spot.ownerUid === uid) return true;
  if (!spot.allowContributions || !(await effectivePublic(spot))) return false;
  const ids = [spot.ownerUid, uid].sort();
  // Match the existing accepted-friend relation without assuming its document key.
  const friends = await db
    .collection('board_friendships')
    .where('user_ids', 'array-contains', uid)
    .limit(100)
    .get();
  return friends.docs.some(
    (d) => Array.isArray(d.data().user_ids) && ids.every((x) => d.data().user_ids.includes(x)),
  );
}
async function getSpot(id: string): Promise<Record<string, any>> {
  const s = (await db.doc(`off_grid_spots/${id}`).get()).data();
  if (!s || s.status === 'deleted') throw new HttpsError('not-found', 'This gem is unavailable.');
  return s;
}
export const offGridCommand = onCall(
  { region, cors: true, timeoutSeconds: 300, memory: '1GiB' },
  async (request) => {
    const data = request.data || {},
      action = text(data.action, 40),
      uid = request.auth?.uid || '';
    if (action === 'resolveLocation') {
      if (!uid) throw new HttpsError('unauthenticated', 'Sign in to resolve a location.');
      return data.words ? resolveWords(data.words) : wordsForPoint(data.lat, data.lng);
    }
    if (action === 'list') return listSpots(data, uid);
    if (action === 'map') return mapSpots(data, uid);
    const id = identifier(data.spotId);
    if (action === 'detail') {
      const spot = await getSpot(id),
        owner = uid === spot.ownerUid,
        visible = await effectivePublic(spot);
      if (!owner && !visible)
        throw new HttpsError('not-found', 'This gem is private or unavailable.');
      const clips = await db
        .collection(`off_grid_spots/${id}/pin_talks`)
        .orderBy('createdAt', 'asc')
        .limit(50)
        .get();
      let grant = '';
      if (uid) {
        grant = randomUUID();
        await db
          .doc(`off_grid_media_grants/${grant}`)
          .set({ uid, spotId: id, expiresAt: Date.now() + 300000 });
      }
      const allowed = clips.docs.filter(
        (d) => owner || d.data().contributorUid === uid || d.data().approval === 'approved',
      );
      const base = mediaBase(),
        query = grant ? '&grant=' + grant : '';
      return {
        id,
        title: spot.title,
        tip: spot.tip,
        accessNote: spot.accessNote || '',
        ownerUid: spot.ownerUid,
        creatorUid: spot.creatorUid,
        creatorName: spot.creatorName,
        visibility: spot.visibility,
        status: spot.status,
        location: spot.location,
        createdAt: spot.createdAt,
        sourceRef: spot.sourceRef || null,
        allowContributions: Boolean(spot.allowContributions),
        canContribute: uid ? await canContribute(spot, uid) : false,
        coverUrl:
          spot.coverPath || spot.legacyCoverPath
            ? `${base}?spot=${id}&asset=cover-large${query}`
            : '',
        cover: Boolean(spot.coverPath || spot.legacyCoverPath),
        clips: allowed.map((d) => ({
          id: d.id,
          caption: d.data().caption || '',
          duration: d.data().duration || null,
          contributorUid: d.data().contributorUid,
          contributorName: d.data().contributorName || spot.creatorName,
          approval: d.data().approval,
          playbackUrl: `${base}?spot=${id}&asset=video&clip=${d.id}${query}`,
          posterUrl: d.data().posterPath
            ? `${base}?spot=${id}&asset=poster&clip=${d.id}${query}`
            : '',
          featured: d.data().featured === true,
        })),
        shareUrl: `https://${process.env.GCLOUD_PROJECT}.web.app/share/off-grid/${id}`,
      };
    }
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to mark or save a gem.');
    const ref = db.doc(`off_grid_spots/${id}`);
    if (action === 'draft') {
      await db.runTransaction(async (tx) => {
        const old = await tx.get(ref);
        if (old.exists) {
          if (old.data()?.ownerUid !== uid)
            throw new HttpsError('permission-denied', 'This gem belongs to someone else.');
          return;
        }
        const now = new Date().toISOString();
        tx.set(ref, {
          ownerUid: uid,
          creatorUid: uid,
          creatorName: text(request.auth?.token.name, 80) || 'A LivingWiki explorer',
          title: 'Untitled gem',
          tip: '',
          location: null,
          visibility: 'private',
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          clipCount: 0,
          allowContributions: true,
        });
      });
      return { id };
    }
    const spot = await getSpot(id),
      owner = spot.ownerUid === uid;
    if (action === 'stagedCover') {
      if (!owner) throw new HttpsError('permission-denied', 'Only the owner can view the staged photo.');
      const ticketId = identifier(data.ticketId);
      const job = (await db.doc(`off_grid_uploads/${ticketId}`).get()).data();
      if (job?.uid !== uid || job.spotId !== id || job.kind !== 'cover' || job.status !== 'ready')
        throw new HttpsError('not-found', 'This staged photo is unavailable.');
      const grant = randomUUID();
      await db.doc(`off_grid_media_grants/${grant}`).set({ uid, spotId: id, expiresAt: Date.now() + 300000 });
      return { coverUrl: `${mediaBase()}?spot=${id}&asset=staged-cover&ticket=${ticketId}&grant=${grant}` };
    }
    if (action === 'beginUpload') {
      if (!owner && (data.kind !== 'video' || !(await canContribute(spot, uid))))
        throw new HttpsError(
          'permission-denied',
          'Only the owner or accepted friends can add a PinTalk.',
        );
      if (data.kind !== 'cover' && (await ref.collection('pin_talks').limit(50).get()).size >= 50)
        throw new HttpsError('resource-exhausted', 'This gem has reached its 50-PinTalk limit.');
      const kind = data.kind === 'cover' ? 'cover' : 'video',
        ticketId = randomUUID();
      const path = `off-grid-originals/${uid}/${id}/${ticketId}`;
      const bytes = Number(data.bytes);
      if (
        !Number.isSafeInteger(bytes) ||
        bytes <= 0 ||
        bytes > (kind === 'cover' ? 10 : 100) * 1024 * 1024
      )
        throw new HttpsError('invalid-argument', 'The file exceeds the upload limit.');
      const contentType =
        text(data.contentType, 100) || (kind === 'cover' ? 'image/jpeg' : 'video/mp4');
      if (!(kind === 'cover' ? /^image\// : /^video\//).test(contentType))
        throw new HttpsError('invalid-argument', 'Choose a photo or video file.');
      const trimStart = Number(data.trimStart) || 0,
        trimEnd = data.trimEnd == null ? null : Number(data.trimEnd);
      if (
        trimStart < 0 ||
        !Number.isFinite(trimStart) ||
        (trimEnd !== null && (!Number.isFinite(trimEnd) || trimEnd <= trimStart))
      )
        throw new HttpsError('invalid-argument', 'Invalid trim.');
      await db.doc(`off_grid_uploads/${ticketId}`).set({
        uid,
        spotId: id,
        path,
        kind,
        status: 'uploading',
        recorded: data.recorded === true,
        trimStart,
        trimEnd,
        caption: text(data.caption, 600),
        createdAt: Date.now(),
      });
      const [uploadUrl] = await storage
        .bucket()
        .file(path)
        .createResumableUpload({
          origin: request.rawRequest.headers.origin,
          metadata: { contentType, cacheControl: 'private, no-store', contentLength: bytes },
        });
      return { ticketId, uploadUrl };
    }
    if (action === 'cancelUpload') {
      const ticketId = identifier(data.ticketId);
      const jobRef = db.doc('off_grid_uploads/' + ticketId);
      await db.runTransaction(async tx => {
        const [job, clip, current] = await Promise.all([
          tx.get(jobRef), tx.get(ref.collection('pin_talks').doc(ticketId)), tx.get(ref),
        ]);
        const j = job.data();
        if (j?.uid !== uid || j.spotId !== id)
          throw new HttpsError('permission-denied', 'Not your upload.');
        tx.update(jobRef, { status: 'cancelled' });
        // Cancellation can arrive just after finalization. Retract that upload
        // atomically so a cancelled video never remains publicly attached.
        if (j.kind === 'video' && clip.exists && clip.data()?.contributorUid === uid) {
          tx.delete(clip.ref);
          if (current.exists && clip.data()?.approval === 'approved') {
            const updated = { ...current.data(), clipCount: Math.max(0, (current.data()?.clipCount || 0) - 1) };
            tx.update(ref, { clipCount: updated.clipCount });
            const previewRef = db.doc('public_off_grid_spots/' + id);
            const preview = publicPreview(updated, id);
            if (preview) tx.set(previewRef, preview); else tx.delete(previewRef);
          }
        }
      });
      return { ok: true };
    }
    if (action === 'finishUpload') {
      if (!owner && !(await canContribute(spot, uid)))
        throw new HttpsError('permission-denied', 'You can no longer contribute to this gem.');
      const ticketId = identifier(data.ticketId),
        result = await processUpload(uid, id, ticketId),
        job = (await db.doc(`off_grid_uploads/${ticketId}`).get()).data()!;
      await db.runTransaction(async (tx) => {
        const [currentSnap, currentJob] = await Promise.all([
          tx.get(ref), tx.get(db.doc('off_grid_uploads/' + ticketId)),
        ]);
        const current = currentSnap.data();
        if (currentJob.data()?.status !== 'ready') throw new HttpsError('cancelled', 'Upload cancelled.');
        if (!current || current.status === 'deleted')
          throw new HttpsError('not-found', 'This gem was removed.');
        const preview = db.doc(`public_off_grid_spots/${id}`);
        if (job.kind === 'cover') {
          if (current.ownerUid !== uid)
            throw new HttpsError(
              'permission-denied',
              'Only the owner can change the photo.',
            ); /* Attach the staged cover only when the owner saves/reviews the gem. */
        } else {
          const clipRef = ref.collection('pin_talks').doc(ticketId),
            old = await tx.get(clipRef);
          if (!old.exists) {
            const approved = current.ownerUid === uid;
            tx.set(clipRef, {
              ...result,
              contributorUid: uid,
              contributorName: text(request.auth?.token.name, 80) || 'A LivingWiki friend',
              approval: approved ? 'approved' : 'pending',
              featured: approved && !current.clipCount,
              createdAt: new Date().toISOString(),
            });
            if (approved) {
              const updated = { ...current, clipCount: (current.clipCount || 0) + 1 };
              tx.update(ref, { clipCount: updated.clipCount });
              const p = publicPreview(updated, id);
              if (p) tx.set(preview, p);
            }
          }
        }
      });
      return { ok: true, ticketId, kind: job.kind };
    }
    if (!owner) throw new HttpsError('permission-denied', 'Only the owner can change this gem.');
    if (action === 'approveClip' || action === 'removeClip' || action === 'featureClip') {
      const clipId = identifier(data.clipId);
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data()!,
          clips = await tx.get(ref.collection('pin_talks'));
        const selected = clips.docs.find((d) => d.id === clipId);
        if (!selected) throw new HttpsError('not-found', 'PinTalk not found.');
        let sourceRef: FirebaseFirestore.DocumentReference | null = null,
          source: FirebaseFirestore.DocumentData | undefined;
        if (action === 'removeClip' && clipId === 'legacy' && current.sourceRef) {
          sourceRef = db.doc(`boards/${current.sourceRef.boardId}`);
          source = (await tx.get(sourceRef)).data();
        }
        let count = 0;
        for (const clip of clips.docs) {
          const c = clip.data();
          if (action === 'removeClip' && clip.id === clipId) {
            tx.delete(clip.ref);
            continue;
          }
          const approval = action === 'approveClip' && clip.id === clipId ? 'approved' : c.approval;
          if (approval === 'approved') count++;
          tx.update(clip.ref, {
            approval,
            featured:
              action === 'featureClip'
                ? clip.id === clipId && approval === 'approved'
                : c.featured === true,
          });
        }
        if (source && sourceRef)
          tx.update(sourceRef, {
            cards: source.cards.map((c: any) =>
              c.id === current.sourceRef.cardId ? { ...c, talkDrop: null } : c,
            ),
            updated_at_iso: new Date().toISOString(),
          });
        tx.update(ref, { clipCount: count });
        const p = publicPreview({ ...current, clipCount: count }, id);
        if (p) tx.set(db.doc(`public_off_grid_spots/${id}`), p);
      });
      return { ok: true };
    }
    if (action === 'save' || action === 'delete') {
      let cover: Record<string, any> = {};
      if (data.coverTicketId) {
        const ticket = (
          await db.doc(`off_grid_uploads/${identifier(data.coverTicketId)}`).get()
        ).data();
        if (
          !ticket ||
          ticket.uid !== uid ||
          ticket.spotId !== id ||
          ticket.status !== 'ready' ||
          ticket.kind !== 'cover'
        )
          throw new HttpsError('invalid-argument', 'The photo is not ready.');
        cover = {
          coverPath: ticket.result.coverPath,
          coverLargePath: ticket.result.coverLargePath,
          customCover: true,
        };
      }
      const title = text(data.title, 80),
        location = pointFrom(data.location),
        visibility = data.visibility === 'public' ? 'public' : 'private',
        status = data.status === 'draft' ? 'draft' : 'active';
      if (action === 'save' && (title.length < 2 || (status === 'active' && !location)))
        throw new HttpsError('invalid-argument', 'Give this gem a name and confirm its map point.');
      if (
        action === 'save' &&
        visibility === 'public' &&
        (status !== 'active' ||
          !location ||
          (!spot.coverPath && !spot.legacyCoverPath && !cover.coverPath))
      )
        throw new HttpsError(
          'failed-precondition',
          'Add a photo and confirm the location before publishing.',
        );
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data()!;
        let board: any, boardRef: FirebaseFirestore.DocumentReference | undefined;
        if (current.sourceRef) {
          boardRef = db.doc(`boards/${current.sourceRef.boardId}`);
          board = (await tx.get(boardRef)).data();
          if (!board || board.owner_user_id !== uid)
            throw new HttpsError(
              'permission-denied',
              'Only the source board owner can edit this gem.',
            );
          if (visibility === 'public' && board.visibility !== 'public')
            throw new HttpsError(
              'failed-precondition',
              'Make the source board public before publishing this gem.',
            );
        }
        const now = new Date().toISOString(),
          updated: Record<string, any> =
            action === 'delete'
              ? { ...current, status: 'deleted', visibility: 'private', updatedAt: now }
              : {
                  ...current,
                  ...cover,
                  title,
                  tip: text(data.tip, 1600),
                  accessNote: text(data.accessNote, 1000),
                  location,
                  visibility,
                  status,
                  updatedAt: now,
                  allowContributions: data.allowContributions !== false,
                };
        if (board) {
          const cards = board.cards
            .map((c: any) =>
              c.id === current.sourceRef.cardId
                ? {
                    ...c,
                    title: updated.title,
                    notes: updated.tip,
                    locationLat: location?.lat ?? null,
                    locationLng: location?.lng ?? null,
                    what3wordsAddress: location?.words || '',
                    authorOnly: visibility !== 'public',
                    updatedAt: now,
                  }
                : c,
            )
            .filter((c: any) => !(action === 'delete' && c.id === current.sourceRef.cardId));
          tx.update(boardRef!, {
            cards,
            updated_at_iso: now,
            server_updated_at: FieldValue.serverTimestamp(),
          });
          updated.sourceVersion = now;
        }
        tx.set(ref, updated);
        const p = publicPreview(updated, id);
        const preview = db.doc(`public_off_grid_spots/${id}`);
        p ? tx.set(preview, p) : tx.delete(preview);
      });
      return { id };
    }
    throw new HttpsError('invalid-argument', 'Unknown Off Grid action.');
  },
);
export function mediaBase(): string {
  return `https://us-central1-${process.env.GCLOUD_PROJECT || 'living-atlas-7622a'}.cloudfunctions.net/offGridMedia`;
}
export const offGridMedia = onRequest(
  { region, cors: true, timeoutSeconds: 120 },
  async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    try {
      const id = identifier(req.query.spot),
        spot = await getSpot(id);
      let uid = '';
      const grant = text(req.query.grant, 120);
      if (grant) {
        const g = (await db.doc(`off_grid_media_grants/${identifier(grant)}`).get()).data();
        if ((g?.spotId === id || g?.spotId === '*') && g.expiresAt > Date.now()) uid = g.uid;
      }
      const owner = uid === spot.ownerUid,
        visible = await effectivePublic(spot);
      let path = '';
      if (req.query.asset === 'staged-cover') {
        const job = (await db.doc(`off_grid_uploads/${identifier(req.query.ticket)}`).get()).data();
        if (!owner || job?.uid !== uid || job.spotId !== id || job.kind !== 'cover' || job.status !== 'ready') {
          res.sendStatus(404); return;
        }
        path = job.result?.coverLargePath || job.result?.coverPath;
      } else if (req.query.asset === 'cover' || req.query.asset === 'cover-large') {
        if (!owner && !visible) {
          res.sendStatus(404);
          return;
        }
        path =
          (req.query.asset === 'cover-large' ? spot.coverLargePath : spot.coverPath) ||
          spot.coverPath ||
          spot.legacyCoverPath;
      } else {
        const clip = (
          await db.doc(`off_grid_spots/${id}/pin_talks/${identifier(req.query.clip)}`).get()
        ).data();
        if (
          !clip ||
          (!owner && uid !== clip.contributorUid && !(visible && clip.approval === 'approved'))
        ) {
          res.sendStatus(404);
          return;
        }
        path =
          req.query.asset === 'poster' ? clip.posterPath : clip.playbackPath || clip.legacyPath;
      }
      if (!path) {
        res.sendStatus(404);
        return;
      }
      const file = storage.bucket().file(path);
      const [meta] = await file.getMetadata(),
        size = Number(meta.size);
      let range;
      try {
        range = rangeFrom(req.headers.range, size);
      } catch {
        res.set('Content-Range', `bytes */${size}`).sendStatus(416);
        return;
      }
      res.set('Content-Type', meta.contentType || 'application/octet-stream');
      res.set('Accept-Ranges', 'bytes');
      res.set('Content-Length', String(range ? range.end - range.start + 1 : size));
      if (range) res.status(206).set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = file.createReadStream(range || {});
      res.on('close', () => stream.destroy());
      stream.on('error', () => {
        if (!res.headersSent) res.sendStatus(404);
        else res.end();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.sendStatus(404);
    }
  },
);
function escape(v: unknown): string {
  return String(v || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export const offGridShare = onRequest({ region }, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const id = identifier(req.path.split('/').filter(Boolean).pop()),
      s = await getSpot(id);
    if (!(await effectivePublic(s))) {
      res.sendStatus(404);
      return;
    }
    const url = `https://${process.env.GCLOUD_PROJECT}.web.app/off-grids/${id}`,
      image = `${mediaBase()}?spot=${id}&asset=cover-large`,
      point = pointFrom(s.location)!;
    res
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(s.title)} · Off Grids | LivingWiki</title><meta name="description" content="${escape(s.tip)}"><meta property="og:title" content="${escape(s.title)}"><meta property="og:description" content="${escape(s.tip)}"><meta property="og:image" content="${escape(image)}"><meta property="og:url" content="${escape(url)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><style>body{font:18px system-ui;background:#fafaf6;color:#193c32;max-width:640px;margin:40px auto;padding:20px}img{width:100%;border-radius:18px}a{display:inline-block;padding:14px 22px;background:#f4d94e;color:#193c32;border-radius:12px;text-decoration:none;margin:6px 0}</style></head><body><p>LivingWiki · Off Grids</p><img src="${escape(image)}" alt="${escape(s.title)}"><h1>${escape(s.title)}</h1><p>${escape(s.tip)}</p><p>${point.lat}, ${point.lng}</p><a href="${url}">Explore this gem &amp; watch PinTalks →</a><br><a href="https://www.google.com/maps/dir/?api=1&amp;destination=${point.lat},${point.lng}">Let’s go →</a><script>if(!/bot|crawler|spider|facebookexternalhit|whatsapp|twitter|slack/i.test(navigator.userAgent))location.replace(${JSON.stringify(url)})</script></body></html>`,
      );
  } catch {
    res.sendStatus(404);
  }
});
export { syncOffGridBoard } from './source';
import { syncOffGridBoard } from './source';
export const syncOffGridSpots = onDocumentWritten(
  { region, document: 'boards/{boardId}', timeoutSeconds: 300, memory: '1GiB', retry: true },
  async (event) => {
    const before = event.data?.before.data(),
      after = event.data?.after.data();
    const eligible = (b: any) =>
      b &&
      (b.kind === 'off-grid' ||
        (Array.isArray(b.cards) && b.cards.some((c: any) => isOffGridCard(b, c))));
    if (eligible(before) || eligible(after)) await syncOffGridBoard(event.params.boardId);
  },
);
async function listSpots(data: Record<string, any>, uid: string): Promise<Record<string, any>> {
  const scope = data.scope === 'mine' ? 'mine' : data.scope === 'saved' ? 'saved' : 'explore';
  if (scope !== 'explore' && !uid)
    throw new HttpsError('unauthenticated', 'Sign in to see your pins.');
  let q: FirebaseFirestore.Query;
  const search = text(data.search, 100)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (scope === 'saved') {
    let savedQuery: FirebaseFirestore.Query = db.collection(`users/${uid}/saved_off_grid_spots`)
      .orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
    if (data.cursor?.createdAt && data.cursor?.id)
      savedQuery = savedQuery.startAfter(text(data.cursor.createdAt, 40), identifier(data.cursor.id));
    const saves = await savedQuery.limit(13).get();
    const page = saves.docs.slice(0, 12);
    const records = page.length ? await db.getAll(...page.map(d => db.doc(`off_grid_spots/${d.id}`))) : [];
    const visible = await visibleIds(records);
    const items = records.filter(d => d.exists && d.data()?.status !== 'deleted' &&
      (d.data()?.ownerUid === uid || visible.has(d.id))).map(d => {
        const spot = d.data()!;
        return { id: d.id, title: spot.title, tip: text(spot.tip, 400),
          cover: Boolean(spot.coverPath || spot.legacyCoverPath), creatorName: spot.creatorName,
          location: spot.location, visibility: spot.visibility, status: spot.status, clipCount: spot.clipCount || 0 };
      }).filter(spot => search.every(term => docSearch(spot).includes(term.slice(0, 20))));
    const last = page.at(-1);
    return decoratePage({ items, cursor: saves.size > 12 && last
      ? { createdAt: last.data().createdAt, id: last.id } : null }, uid);
  }
  if (scope === 'mine')
    q = db
      .collection('off_grid_spots')
      .where('ownerUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .orderBy('__name__', 'desc');
  else {
    q = db.collection('public_off_grid_spots');
    if (search[0]) q = q.where('searchTerms', 'array-contains', search[0]);
    q = q.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
  }
  if (data.cursor?.createdAt && data.cursor?.id)
    q = q.startAfter(text(data.cursor.createdAt, 40), identifier(data.cursor.id));
  const snapshot = await q.limit(13).get(),
    page = snapshot.docs.slice(0, 12);
  const records =
    scope === 'mine'
      ? page
      : page.length
        ? await db.getAll(...page.map((d) => db.doc(`off_grid_spots/${d.id}`)))
        : [];
  const visible =
    scope === 'mine'
      ? new Set(records.filter((d) => d.exists && d.data()?.status !== 'deleted').map((d) => d.id))
      : await visibleIds(records);
  const items = page
    .filter((d) => visible.has(d.id))
    .map((doc): Record<string, any> => {
      const s = doc.data();
      return scope === 'mine'
        ? {
            ...publicPreview({ ...s, visibility: 'public', status: 'active' }, doc.id),
            id: doc.id,
            title: s.title,
            tip: text(s.tip, 400),
            cover: Boolean(s.coverPath || s.legacyCoverPath),
            creatorName: s.creatorName,
            location: s.location,
            visibility: s.visibility,
            status: s.status,
            clipCount: s.clipCount || 0,
          }
        : { ...s, id: doc.id, visibility: 'public', status: 'active' };
    })
    .filter(
      (s) =>
        !search.length ||
        search.every((term) =>
          (scope === 'mine'
            ? `${s.title} ${s.location?.area || ''}`
                .toLowerCase()
                .normalize('NFKD')
                .replace(/\p{M}/gu, '')
            : docSearch(s)
          ).includes(term.slice(0, 20)),
        ),
    );
  const last = page.at(-1);
  return decoratePage(
    {
      items,
      cursor: snapshot.size > 12 && last ? { createdAt: last.data().createdAt, id: last.id } : null,
    },
    uid,
  );
}
async function decoratePage(page: Record<string, any>, uid: string): Promise<Record<string, any>> {
  let grant = '';
  if (uid && page.items.some((s: any) => s.visibility === 'private')) {
    grant = randomUUID();
    await db
      .doc(`off_grid_media_grants/${grant}`)
      .set({ uid, spotId: '*', expiresAt: Date.now() + 300000 });
  }
  return {
    ...page,
    items: page.items.map((s: any) => ({
      ...s,
      coverUrl: s.cover
        ? `${mediaBase()}?spot=${s.id}&asset=cover${s.visibility === 'private' ? '&grant=' + grant : ''}`
        : '',
      coverLargeUrl: s.cover
        ? `${mediaBase()}?spot=${s.id}&asset=cover-large${s.visibility === 'private' ? '&grant=' + grant : ''}`
        : '',
    })),
  };
}
async function mapSpots(data: Record<string, any>, uid: string): Promise<Record<string, any>> {
  const b = data.bounds;
  if (
    !b ||
    !validCoordinates(b.north, b.east) ||
    !validCoordinates(b.south, b.west) ||
    b.north < b.south
  )
    throw new HttpsError('invalid-argument', 'Choose a valid map area.');
  const wrapped = b.east < b.west,
    center: [number, number] = [
      (b.north + b.south) / 2,
      wrapped ? (((b.east + b.west + 360) / 2 + 180) % 360) - 180 : (b.east + b.west) / 2,
    ];
  // For a viewport spanning more than a hemisphere, its farthest point can
  // lie between the corners. Query the globe, then apply the exact bounds.
  const longitudeSpan = wrapped ? b.east + 360 - b.west : b.east - b.west;
  const radius = longitudeSpan >= 180 ? 20015000 : Math.min(
    20015000,
    Math.max(
      1000,
      distanceBetween(center, [b.north, b.east]) * 1000,
      distanceBetween(center, [b.south, b.west]) * 1000,
    ),
  );
  const bounds = longitudeSpan >= 180 ? [['0', '~']] : geohashQueryBounds(center, radius);
  const snapshots = await Promise.all(
    bounds.map(([start, end]) =>
      db
        .collection('public_off_grid_spots')
        .orderBy('geohash')
        .startAt(start)
        .endAt(end)
        .limit(101)
        .get(),
    ),
  );
  const docs = new Map(snapshots.flatMap((s) => s.docs.map((d) => [d.id, d] as const)));
  const candidates = [...docs.values()].filter(doc => {
    const p = doc.data().location;
    return p && p.lat <= b.north && p.lat >= b.south &&
      (wrapped ? p.lng >= b.west || p.lng <= b.east : p.lng >= b.west && p.lng <= b.east) &&
      distanceBetween(center, [p.lat, p.lng]) * 1000 <= radius;
  }).slice(0, 101);
  const records = candidates.length ? await db.getAll(...candidates.map(d => db.doc(`off_grid_spots/${d.id}`))) : [];
  const visible = await visibleIds(records);
  const items = candidates.filter(d => visible.has(d.id)).slice(0, 100)
    .map(doc => ({ ...doc.data(), id: doc.id, visibility: 'public', status: 'active' }));
  return decoratePage(
    { items, cursor: null, truncated: items.length >= 100 || snapshots.some((s) => s.size > 100) },
    uid,
  );
}
function docSearch(s: Record<string, any>): string {
  return Array.isArray(s.searchTerms)
    ? s.searchTerms.join(' ')
    : `${s.title} ${s.location?.area || ''}`.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}
async function visibleIds(records: FirebaseFirestore.DocumentSnapshot[]): Promise<Set<string>> {
  const sourceIds = [
    ...new Set(
      records
        .filter((d) => d.exists)
        .map((d) => d.data()?.sourceRef?.boardId)
        .filter(Boolean),
    ),
  ] as string[];
  const sources = sourceIds.length
    ? await db.getAll(...sourceIds.map((id) => db.doc(`boards/${id}`)))
    : [];
  const byId = new Map(sources.map((d) => [d.id, d.data() || null]));
  const results = await Promise.all(
    records
      .filter((d) => d.exists)
      .map(
        async (d) =>
          [
            d.id,
            await effectivePublic(
              d.data()!,
              d.data()?.sourceRef ? byId.get(d.data()!.sourceRef.boardId) || null : null,
            ),
          ] as const,
      ),
  );
  return new Set(results.filter(([, visible]) => visible).map(([id]) => id));
}
