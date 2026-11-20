import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { isIP } from 'node:net';
import sharp from 'sharp';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function boardVideoImageSources(board: Record<string, unknown>): Set<string> {
  const sources = [board['imageUrl'], board['logoUrl'], board['socialVideoClosingCustomImageUrl']];
  for (const card of Array.isArray(board['cards']) ? board['cards'] : []) {
    if (!card || typeof card !== 'object') continue;
    sources.push(card.imageUrl, ...(Array.isArray(card.imageUrls) ? card.imageUrls : []));
  }
  return new Set(sources.filter((url): url is string => typeof url === 'string').map((url) => url.trim()).filter(Boolean));
}

export function publicVideoImageAddress(address: string): boolean {
  // Resolve IPv4 explicitly and pin the selected address on the HTTPS request.
  // This also excludes IPv4-mapped IPv6 and DNS rebinding to internal services.
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)));
}

export function videoImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Video photos must use a public HTTPS URL.');
  }
  return url;
}

type ImageResponse = { status: number; location?: string; contentType: string; buffer: Buffer };

async function downloadImage(url: URL, address: string): Promise<ImageResponse> {
  return new Promise((resolve, reject) => {
    const request = get(url, {
      family: 4,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'LivingWiki/1.0 board-video (https://www.livingwiki.com)',
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location: response.headers.location, contentType, buffer: Buffer.alloc(0) });
        return;
      }
      if (status !== 200 || !contentType.startsWith('image/')) {
        response.destroy();
        reject(new Error('The photo server did not return an image.'));
        return;
      }
      if (Number(response.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) {
        response.destroy();
        reject(new Error('The photo is larger than 20 MB.'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_IMAGE_BYTES) response.destroy(new Error('The photo is larger than 20 MB.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, contentType, buffer: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    const timeout = setTimeout(() => request.destroy(new Error('The photo server timed out.')), 20_000);
    request.on('close', () => clearTimeout(timeout));
    request.on('error', reject);
  });
}

export async function fetchVideoImage(
  value: string,
  resolveAddresses = async (host: string): Promise<string[]> =>
    (await lookup(host, { all: true, family: 4 })).map(({ address }) => address),
  download = downloadImage,
): Promise<Buffer> {
  let url = videoImageUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const addresses = await resolveAddresses(url.hostname);
    if (!addresses.length || addresses.some((address) => !publicVideoImageAddress(address))) {
      throw new Error('Private photo hosts are not allowed.');
    }
    const response = await download(url, addresses[0]);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new Error('The photo redirect was incomplete.');
      url = videoImageUrl(new URL(response.location, url).toString());
      continue;
    }
    if (response.status !== 200 || !response.contentType.startsWith('image/') || !response.buffer.length
      || response.buffer.length > MAX_IMAGE_BYTES) throw new Error('The photo could not be downloaded.');
    return response.buffer;
  }
  throw new Error('The photo redirected too many times.');
}

export async function prepareVideoImageDataUrl(imageUrl: string): Promise<string> {
  const buffer = await fetchVideoImage(imageUrl);
  const prepared = await sharp(buffer, { limitInputPixels: 64_000_000 })
    .rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 }).toBuffer();
  return `data:image/webp;base64,${prepared.toString('base64')}`;
}
