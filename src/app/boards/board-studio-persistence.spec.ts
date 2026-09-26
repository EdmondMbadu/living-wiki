import { boardAudioPreferencePatch, boardDetailsPatch, boardStudioPatch, boardVoicePreferencePatch } from './board-studio-persistence';

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

  it('changes only edited details and preserves legacy content and independently saved scripts', () => {
    const previous = { ...record, description: 'Legacy description. '.repeat(40), stickers: [{ icon: 'star' }],
      visibility: 'unlisted', custom_slug: 'william-penn', trailerVideoScriptUpdatedAt: 'server timestamp' };
    const next = { ...previous, imageUrl: 'data:image/jpeg;base64,new-image',
      cards: [{ notes: 'Stale script in editor' }], stickers: [{ icon: 'star' }] };
    const patch = boardDetailsPatch(previous, next);
    expect(patch['imageUrl']).toBe(next.imageUrl);
    for (const key of ['cards', 'description', 'stickers', 'visibility', 'custom_slug',
      'trailerVideoScriptUpdatedAt', 'socialVideoUrl', 'legacy_board_field']) {
      expect(Object.hasOwn(patch, key)).withContext(key).toBeFalse();
    }
    expect(patch['socialVideoRenderVersion']).toBe('');
    expect(patch['trailerVideoRenderVersion']).toBe('');
    expect(patch['studioSaveNonce']).toMatch(/^details:[0-9a-f-]{36}$/);
    expect(boardDetailsPatch(previous, next)['studioSaveNonce']).not.toBe(patch['studioSaveNonce']);
    expect(boardDetailsPatch(previous, { ...next, imageUrl: '' })['imageUrl']).toBe('');
    expect(previous.description.length).toBeGreaterThan(240);
  });

  it('includes explicit visibility changes and clears the private photo draft flag when sharing', () => {
    const previous = { ...record, visibility: 'private', photoStudioDraft: true };
    for (const visibility of ['public', 'unlisted']) {
      const patch = boardDetailsPatch(previous, { ...previous, visibility });
      expect(patch['visibility']).toBe(visibility);
      expect(patch['photoStudioDraft']).toBeFalse();
    }
    expect(boardDetailsPatch(previous, previous)['photoStudioDraft']).toBeUndefined();
  });
});
