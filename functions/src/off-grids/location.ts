import { defineString } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { validCoordinates, text } from './model';
// Configure the provider key in the server environment, never in browser assets.
const key = defineString('OFF_GRID_WHAT3WORDS_KEY');
export async function resolveWords(value: unknown): Promise<Record<string, any>> {
  const words = text(value, 240).toLowerCase().replace(/^\/+/, '');
  if (
    !/^[\p{L}\p{M}]+(?:[ '\-’][\p{L}\p{M}]+)*\.[\p{L}\p{M}]+(?:[ '\-’][\p{L}\p{M}]+)*\.[\p{L}\p{M}]+(?:[ '\-’][\p{L}\p{M}]+)*$/u.test(
      words,
    )
  )
    throw new HttpsError('invalid-argument', 'Use three words separated by periods.');
  return lookup('convert-to-coordinates', { words });
}
export async function wordsForPoint(lat: unknown, lng: unknown): Promise<Record<string, any>> {
  if (!validCoordinates(lat, lng))
    throw new HttpsError('invalid-argument', 'Use valid latitude and longitude.');
  return lookup('convert-to-3wa', { coordinates: `${lat},${lng}` });
}
async function lookup(
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, any>> {
  const u = new URL('https://api.what3words.com/v3/' + endpoint);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('key', key.value());
  const response = await fetch(u, { signal: AbortSignal.timeout(12000) });
  const p = (await response.json()) as Record<string, any>;
  if (!response.ok || p.error || !validCoordinates(p.coordinates?.lat, p.coordinates?.lng))
    throw new HttpsError(
      'unavailable',
      'what3words is unavailable. You can still place a pin or enter coordinates.',
    );
  return {
    words: p.words,
    url: `https://what3words.com/${encodeURIComponent(p.words)}`,
    lat: p.coordinates.lat,
    lng: p.coordinates.lng,
    nearestPlace: text(p.nearestPlace, 120),
    country: text(p.country, 12),
  };
}
