import { normalizeTalkDrop, talkDropFileError, talkDropFileType, TALK_DROP_MAX_BYTES } from './talk-drop';

const clip = { url: 'https://firebasestorage.googleapis.com/v0/b/test/o/users%2Fowner%2Fboards%2Ftalk-drops%2Fclip.mp4?alt=media', mimeType: 'video/mp4', fileName: 'Place.mp4' };

describe('Talk Drop media', () => {
  it('keeps a saved video separate from the photo and survives JSON persistence', () => {
    const card = JSON.parse(JSON.stringify({ imageUrl: 'place.jpg', talkDrop: clip }));
    expect(normalizeTalkDrop(card.talkDrop)).toEqual(clip);
    expect(card.imageUrl).toBe('place.jpg');
    expect(normalizeTalkDrop(undefined)).toBeNull();
    expect(normalizeTalkDrop(null)).toBeNull();
  });

  it('recognizes phone recordings even when a file picker omits the MIME type', () => {
    expect(talkDropFileType({ name: 'IMG_1234.MOV', type: '' })).toBe('video/quicktime');
    expect(talkDropFileError({ name: 'clip.mp4', type: 'video/mp4', size: 500 })).toBe('');
    expect(talkDropFileError({ name: 'clip.mp4', type: 'image/jpeg', size: 500 })).not.toBe('');
    expect(talkDropFileError({ name: 'clip.webm', type: 'video/webm', size: 0 })).not.toBe('');
    expect(talkDropFileError({ name: 'clip.mp4', type: 'video/mp4', size: TALK_DROP_MAX_BYTES })).not.toBe('');
  });

  it('does not persist temporary previews or unsafe video URLs', () => {
    for (const url of ['blob:local-preview', 'data:video/mp4;base64,AA', 'javascript:alert(1)', 'https://firebasestorage.googleapis.com.evil.test/v0/b/test/o/clip.mp4']) {
      expect(normalizeTalkDrop({ ...clip, url })).toBeNull();
    }
    expect(normalizeTalkDrop({ ...clip, mimeType: 'text/html' })).toBeNull();
  });
});
