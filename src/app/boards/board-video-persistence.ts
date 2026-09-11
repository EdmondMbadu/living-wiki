const FULL_VIDEO_FIELDS = [
  'socialVideoUrl', 'socialVideoMimeType', 'socialVideoUpdatedAt', 'socialVideoRenderVersion',
  'socialVideoRatio', 'socialVideoAudioTrackId', 'socialVideoAudioVolume', 'socialVideoNarrationEnabled',
  'socialLandscapeVideoUrl', 'socialLandscapeVideoMimeType', 'socialLandscapeVideoUpdatedAt',
  'socialLandscapeVideoRenderVersion', 'socialLandscapeVideoDurationSeconds',
] as const;

const TRAILER_VIDEO_FIELDS = [
  'trailerVideoUrl', 'trailerVideoMimeType', 'trailerVideoUpdatedAt', 'trailerVideoRenderVersion',
  'trailerVideoRatio', 'trailerVideoAudioTrackId', 'trailerVideoAudioVolume', 'trailerVideoNarrationEnabled',
  'trailerVideoScript', 'trailerVideoSourceFingerprint', 'trailerVideoCardIds', 'trailerVideoDurationSeconds',
  'trailerLandscapeVideoUrl', 'trailerLandscapeVideoMimeType', 'trailerLandscapeVideoUpdatedAt',
  'trailerLandscapeVideoRenderVersion', 'trailerLandscapeVideoDurationSeconds',
] as const;

type VideoField = typeof FULL_VIDEO_FIELDS[number] | typeof TRAILER_VIDEO_FIELDS[number] | 'stackNarratorVoiceId';

/** Preserve cards, privacy and server-written fields when attaching a completed render. */
export function boardVideoMetadataPatch(
  board: Partial<Record<VideoField, unknown>>,
  kind: 'full' | 'trailer',
): Record<string, unknown> {
  const fields: readonly VideoField[] = [
    ...(kind === 'trailer' ? TRAILER_VIDEO_FIELDS : FULL_VIDEO_FIELDS),
    'stackNarratorVoiceId',
  ];
  return Object.fromEntries(fields.filter((key) => board[key] !== undefined).map((key) => [key, board[key]]));
}
