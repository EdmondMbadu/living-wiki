import { HttpsError } from 'firebase-functions/v2/https';

/** Accept only videos uploaded by the contributor to this project's board media. */
export function offGridTalkDrop(value: unknown, userId: string, bucket: string): {
  url: string; mimeType: string; fileName: string;
} | null {
  if (value === undefined || value === null) return null;
  const invalid = () => new HttpsError('invalid-argument', 'Upload your Talk Drop video before adding this card.');
  if (typeof value !== 'object') throw invalid();
  const data = value as Record<string, unknown>;
  if (typeof data.url !== 'string' || data.url.length > 2500
    || typeof data.mimeType !== 'string' || !/^video\/(mp4|quicktime|webm)$/.test(data.mimeType)) throw invalid();
  try {
    const url = new URL(data.url);
    const prefix = `/v0/b/${encodeURIComponent(bucket)}/o/`;
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'
      || url.port || url.username || url.password || !url.pathname.startsWith(prefix)
      || url.searchParams.get('alt') !== 'media') throw invalid();
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    const ownerPrefix = `users/${userId}/boards/talk-drops/`;
    if (!objectPath.startsWith(ownerPrefix)
      || !/^[a-zA-Z0-9_-]+\.(mp4|mov|webm)$/.test(objectPath.slice(ownerPrefix.length))) throw invalid();
    return {
      url: url.href,
      mimeType: data.mimeType,
      fileName: typeof data.fileName === 'string' ? data.fileName.slice(0, 180) : 'Talk Drop',
    };
  } catch {
    throw invalid();
  }
}
