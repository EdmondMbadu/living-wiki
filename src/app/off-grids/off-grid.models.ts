export type OffGridScope = 'explore' | 'mine' | 'saved';
export interface OffGridLocation {
  lat: number;
  lng: number;
  source: string;
  confirmedAt: string;
  words?: string;
  area?: string;
  accuracy?: number;
}
export interface PinTalk {
  id: string;
  caption: string;
  duration: number | null;
  contributorUid: string;
  contributorName: string;
  approval: 'approved' | 'pending';
  featured: boolean;
  playbackUrl: string;
  posterUrl: string;
}
export interface OffGridSpot {
  id: string;
  title: string;
  tip: string;
  accessNote?: string;
  ownerUid: string;
  creatorUid: string;
  creatorName: string;
  location: OffGridLocation | null;
  visibility: 'private' | 'public';
  status: 'draft' | 'active' | 'needs-location';
  cover: boolean;
  coverUrl?: string;
  coverLargeUrl?: string;
  clipCount?: number;
  clips?: PinTalk[];
  sourceRef?: { boardId: string; cardId: string } | null;
  allowContributions?: boolean;
  canContribute?: boolean;
  shareUrl?: string;
  createdAt: string;
}
export interface SpotPage {
  items: OffGridSpot[];
  cursor: { createdAt: string; id: string } | null;
  truncated?: boolean;
}
export function validPoint(lat: unknown, lng: unknown): boolean {
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
export function directionsUrl(point: OffGridLocation): string {
  return (
    'https://www.google.com/maps/dir/?' +
    new URLSearchParams({ api: '1', destination: `${point.lat},${point.lng}` }).toString()
  );
}
export function parseCoordinates(value: string): { lat: number; lng: number } | null {
  const s = value.trim();
  const numeric = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  let pair = numeric;
  if (!pair) {
    try {
      const u = new URL(s);
      if (
        u.protocol !== 'https:' ||
        (!/(^|\.)google\.(com|[a-z]{2,3}(?:\.[a-z]{2})?)$/.test(u.hostname) &&
          u.hostname !== 'maps.google.com')
      )
        return null;
      const candidate =
        u.searchParams.get('query') ||
        u.searchParams.get('q') ||
        u.searchParams.get('destination') ||
        '';
      pair =
        candidate.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/) ||
        u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    } catch {
      return null;
    }
  }
  if (!pair) return null;
  const lat = Number(pair[1]),
    lng = Number(pair[2]);
  return validPoint(lat, lng) ? { lat, lng } : null;
}
