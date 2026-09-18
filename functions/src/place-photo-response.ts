import { isLinkReadableVisibility } from './board-visibility';
import { boardCoverPhotoUrl, placePhotoUrl, safePlaceId } from './place-photo';

type Dependencies = {
  apiKey: string;
  fetch: typeof fetch;
  getBoard: (id: string) => Promise<Record<string, unknown> | undefined>;
};
export type PlacePhotoResponse = { status: number; bytes?: Buffer; contentType?: string; attributions?: string[] };

// Only place identity is durable. Photo references are resolved afresh, never stored.
export async function resolvePlacePhoto(
  query: Record<string, unknown>, deps: Dependencies,
): Promise<PlacePhotoResponse> {
  let placeId = safePlaceId(query['placeId']);
  const boardId = query['boardId'];
  if (query['placeId'] !== undefined && !placeId) return { status: 400 };
  if (boardId !== undefined) {
    if (typeof boardId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(boardId)) return { status: 400 };
    const board = await deps.getBoard(boardId);
    // A public image endpoint must not reveal private boards or author-only cards.
    if (!board || !isLinkReadableVisibility(board['visibility']) || board['deleted_at'] || board['team_draft'] === true) return { status: 404 };
    placeId = safePlaceId(placePhotoUrl(boardCoverPhotoUrl(boardId, board))?.searchParams.get('placeId'));
    if (!placeId) return { status: 404 };
  }
  const ref = typeof query['ref'] === 'string' && /^[A-Za-z0-9_-]{1,1200}$/.test(query['ref']) ? query['ref'] : '';
  const name = typeof query['name'] === 'string' && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(query['name'])
    && query['name'].length <= 1200 ? query['name'] : '';
  if (!placeId && !ref && !name) return { status: 400 };
  if (!deps.apiKey) return { status: 503 };
  const signal = AbortSignal.timeout(24_000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let reference = ref;
      let attributions: string[] = [];
      if (placeId) {
        const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
        detailsUrl.searchParams.set('place_id', placeId);
        detailsUrl.searchParams.set('fields', 'photos');
        detailsUrl.searchParams.set('key', deps.apiKey);
        const detailsResponse = await deps.fetch(detailsUrl, { signal, cache: 'no-store' });
        if (!detailsResponse.ok) return { status: 502 };
        const details = await detailsResponse.json() as {
          status?: string;
          result?: { photos?: { photo_reference?: string; width?: number; height?: number; html_attributions?: string[] }[] };
        };
        if (details.status === 'NOT_FOUND' || details.status === 'ZERO_RESULTS') return { status: 404 };
        if (details.status !== 'OK') return { status: 503 };
        const photo = details.result?.photos?.filter((photo) => photo.photo_reference)
          .sort((a, b) => Math.min(b.width || 0, 1000) * Math.min(b.height || 0, 1000)
            - Math.min(a.width || 0, 1000) * Math.min(a.height || 0, 1000))[0];
        if (!photo?.photo_reference) return { status: 404 };
        reference = photo.photo_reference;
        attributions = (photo.html_attributions || []).filter((value): value is string => typeof value === 'string').slice(0, 10);
      }
      const useName = !placeId && !!name;
      const url = new URL(useName ? 'https://places.googleapis.com/v1/' + name + '/media'
        : 'https://maps.googleapis.com/maps/api/place/photo');
      url.searchParams.set(useName ? 'maxWidthPx' : 'maxwidth', '1000');
      if (!useName) url.searchParams.set('photo_reference', reference);
      url.searchParams.set('key', deps.apiKey);
      const upstream = await deps.fetch(url, { redirect: 'follow', signal, cache: 'no-store' });
      if (placeId && attempt === 0 && [400, 404].includes(upstream.status)) {
        await upstream.body?.cancel();
        continue;
      }
      if (!upstream.ok) return { status: upstream.status === 404 || upstream.status === 400 ? 404 : 502 };
      const contentType = upstream.headers.get('content-type')?.split(';')[0] || '';
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType)) return { status: 502 };
      const reader = upstream.body?.getReader();
      if (!reader) return { status: 502 };
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); return { status: 502 }; }
        chunks.push(chunk.value);
      }
      if (!size) return { status: 502 };
      return { status: 200, bytes: Buffer.concat(chunks), contentType, attributions };
    }
  } catch {
    // Do not log upstream URLs or exception messages: they can contain the API key.
    return { status: 502 };
  }
  return { status: 502 };
}
