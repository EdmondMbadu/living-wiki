export type BoardVisibility = 'public' | 'unlisted' | 'private';

/** Anonymous access is separate from inclusion in public discovery. */
export function isLinkReadableVisibility(visibility: unknown): boolean {
  return visibility === 'public' || visibility === 'unlisted';
}

export function isBoardVisibility(value: unknown): value is BoardVisibility {
  return value === 'public' || value === 'unlisted' || value === 'private';
}

export function boardVisibilityDescription(visibility: BoardVisibility): string {
  return visibility === 'unlisted'
    ? 'Anyone with the link can view. Hidden from public discovery. The link can be forwarded.'
    : visibility === 'private'
      ? 'Only you can view this board.'
      : 'Anyone can view. Appears in public discovery.';
}
