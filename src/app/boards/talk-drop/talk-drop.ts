export interface TalkDropVideo {
  url: string;
  mimeType: string;
  fileName: string;
}

export const TALK_DROP_MAX_BYTES = 100 * 1024 * 1024;

export function talkDropFileType(file: Pick<File, 'name' | 'type'>): string {
  if (file.type && !file.type.startsWith('video/') && file.type !== 'application/octet-stream') return '';
  const types: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  };
  return types[file.name.split('.').pop()?.toLowerCase() ?? '']
    || (/^video\/(mp4|quicktime|webm)$/.test(file.type) ? file.type : '');
}

export function talkDropFileError(file: Pick<File, 'name' | 'type' | 'size'>): string {
  if (!talkDropFileType(file)) return 'Choose an MP4, MOV, or WebM video.';
  if (file.size <= 0) return 'This video is empty. Choose another recording.';
  if (file.size >= TALK_DROP_MAX_BYTES) return 'Choose a video smaller than 100 MB.';
  return '';
}

export function normalizeTalkDrop(value: unknown): TalkDropVideo | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<TalkDropVideo>;
  if (typeof data.url !== 'string' || data.url.length > 2500
    || !/^video\/(mp4|quicktime|webm)$/.test(data.mimeType ?? '')) return null;
  try {
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'
      || url.username || url.password || !/^\/v0\/b\/[^/]+\/o\/.+/.test(url.pathname)) return null;
    return { url: url.href, mimeType: data.mimeType!, fileName: String(data.fileName ?? '').slice(0, 180) };
  } catch {
    return null;
  }
}
