/** Keep discovery checks strictly public; use this only for direct visitor access. */
export function isLinkReadableVisibility(visibility: unknown): boolean {
  return visibility === 'public' || visibility === 'unlisted';
}

export type PublishedBoardVisibility = 'public' | 'unlisted';
