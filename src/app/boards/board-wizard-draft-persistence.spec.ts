import {
  boardWizardDraftCountMode,
  boardWizardDraftListingIntent,
  boardWizardDraftListingMarketing,
  boardWizardDraftListingPhotoSource,
  boardWizardDraftListingPhotos,
  boardWizardDraftMediaMode,
  boardWizardDraftVisibility,
  boardWizardDraftNarrationSeconds,
  boardWizardDraftCardWithPersistedImages,
  boardWizardDraftPayloadWithPreferences,
} from './board-wizard-draft-persistence';

describe('board wizard draft persistence contract', () => {
  it('preserves the chosen audience when reopening a wizard draft', () => {
    for (const visibility of ['public', 'unlisted', 'private'] as const) {
      const payload = boardWizardDraftPayloadWithPreferences({ id: 'draft', result: { cards: [] } }, 'images', { visibility });
      expect(boardWizardDraftVisibility(payload)).toBe(visibility);
      expect(Object.prototype.hasOwnProperty.call(payload, 'visibility')).toBeFalse();
    }
    expect(boardWizardDraftVisibility({ result: {} })).toBe('public');
  });
  it('restores upload choice, storage references and cover order without persisting image bytes', () => {
    const photos = Array.from({ length: 24 }, (_, index) => ({ id: `p${index}`, name: `Photo ${index}`,
      imageUrl: `team-media:team-media/team-a/draft-a/${index}.jpg`, storagePath: `team-media/team-a/draft-a/${index}.jpg` }));
    const payload = boardWizardDraftPayloadWithPreferences({ id: 'draft-a', result: { cards: [] } }, 'images', {
      listingPhotoSource: 'upload', listingPhotos: photos,
    });
    expect(boardWizardDraftListingPhotoSource(payload)).toBe('upload');
    expect(boardWizardDraftListingPhotos(payload)).toEqual(photos);
    expect(boardWizardDraftListingPhotoSource({ result: {} })).toBe('url');
    expect(boardWizardDraftListingPhotos({ result: {} })).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(payload, 'listing_photo_source')).toBeFalse();
    const pending = boardWizardDraftPayloadWithPreferences({ result: {} }, 'images', {
      listingPhotoSource: 'upload', listingPhotos: [{ ...photos[0], imageUrl: 'data:image/jpeg;base64,large' }],
    });
    expect(boardWizardDraftListingPhotos(pending)).toEqual([]);
  });
  it('persists every unique card image instead of leaving gallery data URLs in Firestore', async () => {
    const uploaded: string[] = [];
    const card = await boardWizardDraftCardWithPersistedImages({
      id: 'card-1',
      imageUrl: 'data:image/jpeg;base64,primary',
      imageUrls: [
        'data:image/jpeg;base64,primary',
        'data:image/jpeg;base64,secondary',
      ],
    }, 12, async (imageUrl, index) => {
      uploaded.push(imageUrl);
      return `https://storage.example/card-1/${index}.jpg`;
    });

    expect(uploaded).toEqual([
      'data:image/jpeg;base64,primary',
      'data:image/jpeg;base64,secondary',
    ]);
    expect(card.imageUrl).toBe('https://storage.example/card-1/0.jpg');
    expect(card.imageUrls).toEqual([
      'https://storage.example/card-1/0.jpg',
      'https://storage.example/card-1/1.jpg',
    ]);
  });

  it('keeps a listing Live View plan attached after local images are persisted', async () => {
    const primary = 'data:image/jpeg;base64,primary';
    const secondary = 'data:image/jpeg;base64,secondary';
    const card = await boardWizardDraftCardWithPersistedImages({
      imageUrl: primary,
      imageUrls: [primary, secondary],
      listingPresentation: {
        kind: 'listing-group',
        groupKey: 'kitchen',
        presentationImageUrls: [primary, secondary],
      },
    }, 12, async (_imageUrl, index) => `https://storage.example/${index}.jpg`);

    expect(card.listingPresentation?.presentationImageUrls).toEqual([
      'https://storage.example/0.jpg',
      'https://storage.example/1.jpg',
    ]);
  });

  it('nests optional preferences inside the established result field', () => {
    const payload = boardWizardDraftPayloadWithPreferences({
      id: 'draft-1',
      owner_user_id: 'owner-1',
      mode: 'describe',
      media_mode: 'videos',
      future_optional_preference: 'must not become a top-level field',
      result: {
        board: { title: 'Draft board' },
        cards: [{ id: 'card-1' }],
        wizard_preferences: { future_preference: 'preserve me' },
      },
    }, 'videos', { countMode: 'fixed', narrationSecondsPerCard: 45 });

    expect(Object.prototype.hasOwnProperty.call(payload, 'media_mode')).toBeFalse();
    expect(Object.prototype.hasOwnProperty.call(payload, 'future_optional_preference')).toBeFalse();
    expect(payload.result.wizard_preferences).toEqual({
      future_preference: 'preserve me',
      media_mode: 'videos',
      count_mode: 'fixed',
      narration_seconds_per_card: 45,
      listing_intent: 'default',
    });
    expect(payload.result.board).toEqual({ title: 'Draft board' });
    expect(payload.result.cards).toEqual([{ id: 'card-1' }]);
  });

  it('persists listing-story choices without adding fragile top-level fields', () => {
    const payload = boardWizardDraftPayloadWithPreferences({
      id: 'listing-draft',
      owner_user_id: 'owner-1',
      mode: 'url',
      result: { board: { title: 'Listing' }, cards: [] },
    }, 'images', {
      listingIntent: 'rental',
      listingMarketing: {
        style: 'luxury',
        direction: '  Lead with the deck.  ',
        propertyType: 'Townhouse',
        introMessage: ' Welcome to this home. ',
        contactName: 'Jenny Morgan',
        contactEmail: 'jenny@example.com',
        contactPhone: '(609) 555-0147',
        agency: 'Harbor Realty',
        showContact: false,
      },
    });
    expect(payload.result.wizard_preferences.listing_marketing).toEqual({
      style: 'luxury',
      direction: 'Lead with the deck.',
      propertyType: 'Townhouse',
      introMessage: 'Welcome to this home.',
      contactName: 'Jenny Morgan',
      contactEmail: 'jenny@example.com',
      contactPhone: '(609) 555-0147',
      agency: 'Harbor Realty',
      showContact: false,
    });
    expect(boardWizardDraftListingMarketing(payload)).toEqual({
      style: 'luxury',
      direction: 'Lead with the deck.',
      propertyType: 'Townhouse',
      introMessage: 'Welcome to this home.',
      contactName: 'Jenny Morgan',
      contactEmail: 'jenny@example.com',
      contactPhone: '(609) 555-0147',
      agency: 'Harbor Realty',
      showContact: false,
    });
    expect(boardWizardDraftListingIntent(payload)).toBe('rental');
    expect(Object.prototype.hasOwnProperty.call(payload, 'listing_marketing')).toBeFalse();
  });

  it('restores listing intent with a safe default for legacy drafts', () => {
    expect(boardWizardDraftListingIntent({
      result: { wizard_preferences: { listing_intent: 'real-estate' } },
    })).toBe('real-estate');
    expect(boardWizardDraftListingIntent({ result: {} })).toBe('default');
    expect(boardWizardDraftListingIntent({
      result: { wizard_preferences: { listing_intent: 'invalid' } },
    })).toBe('default');
  });

  it('restores count and narration preferences with safe legacy defaults', () => {
    const nested = {
      result: {
        wizard_preferences: {
          count_mode: 'fixed',
          narration_seconds_per_card: 92,
        },
      },
    };
    expect(boardWizardDraftCountMode(nested)).toBe('fixed');
    expect(boardWizardDraftNarrationSeconds(nested)).toBe(90);
    expect(boardWizardDraftCountMode({ result: {} })).toBe('auto');
    expect(boardWizardDraftNarrationSeconds({ result: {} })).toBe(30);
  });

  it('restores nested preferences and defaults missing or invalid values to images', () => {
    expect(boardWizardDraftMediaMode({
      result: { wizard_preferences: { media_mode: 'mixed' } },
    })).toBe('mixed');
    expect(boardWizardDraftMediaMode({ result: {} })).toBe('images');
    expect(boardWizardDraftMediaMode({
      result: { wizard_preferences: { media_mode: 'random' } },
    })).toBe('images');
  });

  it('continues reading the temporary top-level format without emitting it', () => {
    expect(boardWizardDraftMediaMode({
      media_mode: 'videos',
      result: { wizard_preferences: { media_mode: 'mixed' } },
    })).toBe('videos');
  });
});
