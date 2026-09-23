export type BoardStudioSaveKind = 'script' | 'cover' | 'fresh-narration' | 'cards' | 'final-screen' | 'settings';

const mediaInvalidationFields = [
  'socialVideoRenderVersion',
  'socialLandscapeVideoRenderVersion',
  'trailerVideoRenderVersion',
  'trailerLandscapeVideoRenderVersion',
  'trailerVideoSourceFingerprint',
] as const;

const finalScreenFields = [
  'socialVideoClosingHeadline',
  'socialVideoClosingMessage',
  'socialVideoClosingShowQrCode',
  'socialVideoClosingImage',
  'socialVideoClosingCustomImageUrl',
  'socialVideoClosingDurationSeconds',
] as const;

/** Only fields owned by this Studio action may be sent to Firestore. */
export function boardStudioPatch(record: Record<string, unknown>, kind: BoardStudioSaveKind): Record<string, unknown> {
  const fields: readonly string[] = kind === 'script'
    ? ['title', 'description', 'imageUrl', 'cards', ...mediaInvalidationFields]
    : kind === 'cover'
      ? ['title', 'description', 'imageUrl', ...mediaInvalidationFields]
      : kind === 'fresh-narration' || kind === 'cards'
        ? ['cards', ...mediaInvalidationFields]
        : kind === 'settings'
          ? ['title', 'description', 'visibility', 'showCardNumbers', 'insideCardsDisplay',
            'photoStudioDraft', ...mediaInvalidationFields]
          : [...finalScreenFields, 'socialVideoRenderVersion', 'socialLandscapeVideoRenderVersion'];
  return {
    ...Object.fromEntries([...fields, 'updated_at_iso'].map((field) => [field, record[field]])),
    // Lets Firestore evaluate this focused write before legacy full-board rules.
    studioSaveNonce: globalThis.crypto.randomUUID(),
  };
}

export function boardAudioPreferencePatch(trackId: string, volume: number, updatedAt: string): Record<string, unknown> {
  return {
    socialVideoAudioTrackId: trackId,
    socialVideoAudioVolume: volume,
    ...Object.fromEntries(mediaInvalidationFields.map((field) => [field, ''])),
    updated_at_iso: updatedAt,
  };
}

export function boardVoicePreferencePatch(voiceId: string, updatedAt: string): Record<string, unknown> {
  return {
    stackNarratorVoiceId: voiceId,
    ...Object.fromEntries(mediaInvalidationFields.map((field) => [field, ''])),
    updated_at_iso: updatedAt,
  };
}
