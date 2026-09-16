import type { File, FileMetadata } from '@google-cloud/storage';

interface Image { metadata: FileMetadata; bytes: Buffer | null }
const maximumBytes = 16 * 1024 * 1024;
const maximumImageBytes = 2 * 1024 * 1024;
const cache = new Map<string, { image: Image; expiresAt: number }>();
const pending = new Map<string, Promise<Image>>();
let bytesHeld = 0;

// Upload tickets and source versions give photos immutable object paths. This
// cache contains no permissions: callers must authorize each response first.
export async function cachedImage(file: File): Promise<Image> {
  const key = file.bucket.name + '/' + file.name;
  const old = cache.get(key);
  if (old) {
    cache.delete(key);
    if (old.expiresAt > Date.now()) {
      cache.set(key, old);
      return old.image;
    }
    bytesHeld -= old.image.bytes?.length || 0;
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const load = (async () => {
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > maximumImageBytes) return { metadata, bytes: null };
    const [bytes] = await file.download();
    const image = { metadata, bytes };
    if (bytes.length <= maximumImageBytes) {
      while (bytesHeld + bytes.length > maximumBytes || cache.size >= 100) {
        const first = cache.entries().next().value;
        if (!first) break;
        bytesHeld -= first[1].image.bytes?.length || 0;
        cache.delete(first[0]);
      }
      cache.set(key, { image, expiresAt: Date.now() + 300000 });
      bytesHeld += bytes.length;
    }
    return image;
  })();
  pending.set(key, load);
  try { return await load; }
  finally { pending.delete(key); }
}
