import { createHash } from 'node:crypto';
import { geohashForLocation } from 'geofire-common';
export type Point = {
  lat: number;
  lng: number;
  source: string;
  confirmedAt: string;
  words?: string;
  area?: string;
  accuracy?: number;
};
export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}
export const text = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
export function pointFrom(value: unknown): Point | null {
  const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (!validCoordinates(p.lat, p.lng) || !text(p.confirmedAt, 40)) return null;
  return {
    lat: p.lat as number,
    lng: p.lng as number,
    source: ['gps', 'map', 'coordinates', 'what3words', 'legacy'].includes(String(p.source))
      ? String(p.source)
      : 'coordinates',
    confirmedAt: text(p.confirmedAt, 40),
    words: text(p.words, 240),
    area: text(p.area, 120),
    ...(typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) && p.accuracy >= 0
      ? { accuracy: p.accuracy }
      : {}),
  };
}
export function sourceSpotId(boardId: string, cardId: string): string {
  return (
    'board_' +
    createHash('sha256')
      .update(boardId + ':' + cardId)
      .digest('hex')
      .slice(0, 32)
  );
}
export function isOffGridCard(
  board: Record<string, unknown>,
  card: Record<string, unknown>,
): boolean {
  return (
    !card.offGridSpotId &&
    (board.kind === 'off-grid' ||
      (Array.isArray(card.tags) && card.tags.some((t) => /^off[ -]?grids?$/i.test(String(t)))))
  );
}
export function searchTerms(title: string, area: string): string[] {
  return [
    ...new Set(
      (title + ' ' + area)
        .toLocaleLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .flatMap((w) =>
          Array.from({ length: Math.min(w.length, 20) }, (_, i) => w.slice(0, i + 1)),
        ),
    ),
  ].slice(0, 120);
}
export function publicPreview(
  spot: Record<string, any>,
  id: string,
): Record<string, unknown> | null {
  const location = pointFrom(spot.location);
  if (spot.visibility !== 'public' || spot.status !== 'active' || !location) return null;
  return {
    id,
    title: text(spot.title, 80),
    tip: text(spot.tip, 400),
    creatorName: text(spot.creatorName, 80),
    creatorUid: spot.creatorUid,
    ownerUid: spot.ownerUid,
    location,
    geohash: geohashForLocation([location.lat, location.lng]),
    createdAt: spot.createdAt,
    updatedAt: spot.updatedAt,
    cover: Boolean(spot.coverPath || spot.legacyCoverPath),
    clipCount: spot.clipCount || 0,
    searchTerms: searchTerms(text(spot.title, 80), location.area || ''),
    sourceBoardId: spot.sourceRef?.boardId || null,
  };
}
export function bucketObject(url: unknown, bucket: string): string | null {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return null;
    const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    return m && decodeURIComponent(m[1]) === bucket ? decodeURIComponent(m[2]) : null;
  } catch {
    return null;
  }
}
export function rangeFrom(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) throw new Error('Invalid range');
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start >= size || start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end))
    throw new Error('Invalid range');
  return { start, end };
}
