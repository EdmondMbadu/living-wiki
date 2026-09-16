import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../firebase';
import { text } from './model';
const ffmpeg = require('ffmpeg-static') as string;
const ffprobe = (require('ffprobe-static') as { path: string }).path;
export async function run(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-8000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(new Error('Media could not be decoded or processed. ' + err.slice(-300)));
    });
  });
}
export async function processUpload(
  uid: string,
  spotId: string,
  ticketId: string,
): Promise<Record<string, any>> {
  const ref = db.doc(`off_grid_uploads/${ticketId}`);
  const snap = await ref.get();
  const job = snap.data();
  if (!job || job.uid !== uid || job.spotId !== spotId)
    throw new HttpsError('permission-denied', 'This upload belongs to another user.');
  if (job.status === 'ready') return job.result;
  const acquired = await db.runTransaction(async (tx) => {
    const j = (await tx.get(ref)).data();
    if (j?.status === 'processing' && Date.now() - j.startedAt < 300000) return false;
    if (j?.status === 'cancelled') throw new HttpsError('failed-precondition', 'Upload cancelled.');
    tx.update(ref, { status: 'processing', startedAt: Date.now() });
    return true;
  });
  if (!acquired) throw new HttpsError('aborted', 'This file is already processing. Please wait.');
  const dir = await mkdtemp(join(tmpdir(), 'off-grid-'));
  const original = storage.bucket().file(job.path);
  try {
    const [meta] = await original.getMetadata();
    const bytes = Number(meta.size);
    const limit = job.kind === 'cover' ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > limit)
      throw new Error('File exceeds the upload limit.');
    const input = join(dir, 'original');
    await original.download({ destination: input });
    let result: Record<string, any>;
    const base = `off-grid-media/${uid}/${spotId}/${ticketId}`;
    if (job.kind === 'cover') {
      const image = sharp(input, { limitInputPixels: 40000000 }).rotate();
      const info = await image.metadata();
      if (!['jpeg', 'png', 'webp', 'heif'].includes(info.format || ''))
        throw new Error('Upload a JPG, PNG, WebP or HEIC photo.');
      const small = await image
        .clone()
        .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const large = await image
        .clone()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      await Promise.all([
        storage
          .bucket()
          .file(base + '/cover.webp')
          .save(small, {
            metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
          }),
        storage
          .bucket()
          .file(base + '/cover-large.webp')
          .save(large, {
            metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
          }),
      ]);
      result = {
        coverPath: base + '/cover.webp',
        coverLargePath: base + '/cover-large.webp',
        ticketId,
      };
    } else {
      const probe = JSON.parse(
        await run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', input]),
      );
      let duration = Number(probe.format?.duration);
      // MediaRecorder WebM commonly has no container duration. Read timestamped
      // packets rather than rejecting a valid browser recording.
      if (!Number.isFinite(duration)) {
        const packets = await run(ffprobe, [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_packets',
          '-show_entries',
          'packet=pts_time,duration_time',
          '-of',
          'csv=p=0',
          input,
        ]);
        const times = packets
          .trim()
          .split('\n')
          .map((line) => line.split(',').map(Number))
          .filter(([pts]) => Number.isFinite(pts));
        if (times.length)
          duration =
            times.reduce(
              (max, [pts, d]) => Math.max(max, pts + (Number.isFinite(d) ? d : 0)),
              -Infinity,
            ) - times.reduce((min, [pts]) => Math.min(min, pts), Infinity);
      }
      const stream = probe.streams?.find((s: any) => s.codec_type === 'video');
      if (
        !stream ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > (job.recorded ? 92 : 180.5)
      )
        throw new Error(
          'Use a playable video: recordings up to 90 seconds, uploads up to 3 minutes.',
        );
      const start = typeof job.trimStart === 'number' ? job.trimStart : 0;
      const end = typeof job.trimEnd === 'number' ? Math.min(duration, job.trimEnd) : duration;
      if (start < 0 || end <= start || end - start > 180.5 || start >= duration)
        throw new Error('Choose a valid video trim.');
      const output = join(dir, 'playback.mp4'),
        poster = join(dir, 'poster.webp');
      await run(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(start),
        '-i',
        input,
        '-t',
        String(end - start),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        "scale='trunc(min(1280,iw)/2)*2':-2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '25',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        '-threads',
        '2',
        '-y',
        output,
      ]);
      await run(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'scale=600:-2',
        '-y',
        poster,
      ]);
      await Promise.all([
        storage.bucket().upload(output, {
          destination: base + '/playback.mp4',
          metadata: { contentType: 'video/mp4', cacheControl: 'private, no-store' },
        }),
        storage.bucket().upload(poster, {
          destination: base + '/poster.webp',
          metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
        }),
      ]);
      result = {
        playbackPath: base + '/playback.mp4',
        posterPath: base + '/poster.webp',
        duration: end - start,
        caption: text(job.caption, 600),
        originalPath: job.path,
        ticketId,
      };
    }
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current || current.status === 'cancelled')
        throw new HttpsError('cancelled', 'Upload cancelled.');
      tx.update(ref, { status: 'ready', result });
    });
    return result;
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current && current.status !== 'cancelled') tx.update(ref, {
        status: 'failed', error: 'Could not process this file. Please choose another or retry.',
      });
    });
    if (error instanceof HttpsError && error.code === 'cancelled') throw error;
    throw new HttpsError(
      'invalid-argument',
      error instanceof Error ? error.message : 'Could not process file.',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
