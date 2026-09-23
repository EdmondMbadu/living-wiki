import { boardAudioPreferencePatch, boardStudioPatch, boardVoicePreferencePatch } from './board-studio-persistence';

describe('board Studio persistence contracts', () => {
  const record: Record<string, unknown> = {
    title: 'Updated board', description: 'Updated description', imageUrl: 'https://example.com/cover.jpg',
    cards: [{ id: 'case-1', notes: 'Updated narration.' }],
    socialVideoRenderVersion: '', socialLandscapeVideoRenderVersion: '',
    trailerVideoRenderVersion: '', trailerLandscapeVideoRenderVersion: '',
    trailerVideoSourceFingerprint: '',
    socialVideoClosingHeadline: 'Keep exploring', socialVideoClosingMessage: 'Open the board',
    socialVideoClosingShowQrCode: true, socialVideoClosingImage: 'cover',
    socialVideoClosingCustomImageUrl: '', socialVideoClosingDurationSeconds: 3,
    updated_at_iso: '2026-09-23T12:00:00.000Z',
    socialVideoUrl: 'https://example.com/existing-video.mp4',
    legacy_board_field: 'must be preserved',
  };

  it('sends only the fields owned by each Studio save', () => {
    const script = boardStudioPatch(record, 'script');
    const cover = boardStudioPatch(record, 'cover');
    const fresh = boardStudioPatch(record, 'fresh-narration');
    const cards = boardStudioPatch(record, 'cards');
    const settings = boardStudioPatch({ ...record, visibility: 'public',
      showCardNumbers: false, insideCardsDisplay: 'alongside' }, 'settings');
    const finalScreen = boardStudioPatch(record, 'final-screen');

    expect(script['cards']).toBe(record['cards']);
    expect(script['title']).toBe(record['title']);
    expect(cover['cards']).toBeUndefined();
    expect(cover['imageUrl']).toBe(record['imageUrl']);
    expect(fresh['cards']).toBe(record['cards']);
    expect(fresh['title']).toBeUndefined();
    expect(cards['cards']).toBe(record['cards']);
    expect(cards['socialVideoUrl']).toBeUndefined();
    expect(settings['showCardNumbers']).toBe(false);
    expect(settings['insideCardsDisplay']).toBe('alongside');
    expect(settings['cards']).toBeUndefined();
    expect(finalScreen['socialVideoClosingHeadline']).toBe(record['socialVideoClosingHeadline']);
    expect(finalScreen['cards']).toBeUndefined();
    for (const patch of [script, cover, fresh, cards, settings, finalScreen]) {
      expect(patch['socialVideoUrl']).toBeUndefined();
      expect(patch['legacy_board_field']).toBeUndefined();
      expect(patch['updated_at_iso']).toBe(record['updated_at_iso']);
      expect(patch['studioSaveNonce']).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(new Set([script, cover, fresh, cards, settings, finalScreen]
      .map((patch) => patch['studioSaveNonce'])).size).toBe(6);
  });

  it('invalidates every video version when music changes without sending video URLs', () => {
    const patch = boardAudioPreferencePatch('none', 0.2, '2026-09-23T12:00:00.000Z');
    expect(patch['socialVideoAudioTrackId']).toBe('none');
    expect(patch['socialVideoAudioVolume']).toBe(0.2);
    expect(patch['socialVideoRenderVersion']).toBe('');
    expect(patch['socialLandscapeVideoRenderVersion']).toBe('');
    expect(patch['trailerVideoRenderVersion']).toBe('');
    expect(patch['trailerLandscapeVideoRenderVersion']).toBe('');
    expect(patch['trailerVideoSourceFingerprint']).toBe('');
    expect(patch['socialVideoUrl']).toBeUndefined();
  });

  it('invalidates every video version when the voice changes', () => {
    const patch = boardVoicePreferencePatch('calm-documentary', '2026-09-23T12:00:00.000Z');
    expect(patch['stackNarratorVoiceId']).toBe('calm-documentary');
    expect(patch['socialVideoRenderVersion']).toBe('');
    expect(patch['trailerVideoRenderVersion']).toBe('');
    expect(patch['socialVideoUrl']).toBeUndefined();
  });
});
