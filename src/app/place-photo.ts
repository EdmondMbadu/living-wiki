import { isLinkReadableVisibility } from './board-visibility';
// Keep this pure URL contract in sync with functions/src/place-photo.ts.
export const PLACE_PHOTO_ENDPOINT = 'https://us-central1-living-atlas-7622a.cloudfunctions.net/boardPlacePhoto';

export function placePhotoUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.origin === new URL(PLACE_PHOTO_ENDPOINT).origin
      && url.pathname === '/boardPlacePhoto' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function safePlaceId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(value) ? value : '';
}

export function stablePlacePhotoUrl(value: unknown, placeId?: unknown, boardId?: string): string {
  const source = typeof value === 'string' ? value : '';
  const url = placePhotoUrl(source);
  if (!url) return source;
  const id = safePlaceId(placeId) || safePlaceId(url.searchParams.get('placeId'))
    || safePlaceId(url.searchParams.get('name')?.match(/^places\/([^/]+)\/photos\//)?.[1]);
  if (id) return PLACE_PHOTO_ENDPOINT + '?placeId=' + encodeURIComponent(id);
  const board = boardId || url.searchParams.get('boardId');
  if (board && /^[A-Za-z0-9_-]{1,180}$/.test(board)) {
    return PLACE_PHOTO_ENDPOINT + '?boardId=' + encodeURIComponent(board);
  }
  return source;
}

export function boardCoverPhotoUrl(boardId: string, board: Record<string, unknown>): string {
  const source = typeof board['imageUrl'] === 'string' ? board['imageUrl'] : '';
  if (!placePhotoUrl(source)) return source;
  const cards = Array.isArray(board['cards']) ? board['cards'] : [];
  const match = cards.find((card) => card && typeof card === 'object'
    && card.authorOnly !== true
    && (card.imageUrl === source || (Array.isArray(card.imageUrls) && card.imageUrls.includes(source))));
  return stablePlacePhotoUrl(source, match?.placeId, isLinkReadableVisibility(board['visibility']) ? boardId : undefined);
}

