/** Resolve normal board links without exposing private team lookups to visitors. */
export async function loadBoardRouteRecord<T>(
  readBoard: () => Promise<T | null>,
  readTeamBoard: () => Promise<T | null>,
  canAccessAllBoards: boolean,
): Promise<{ record: T; collection: 'boards' | 'team_boards' } | null> {
  const board = await readBoard();
  if (board) return { record: board, collection: 'boards' };
  if (!canAccessAllBoards) return null;
  const teamBoard = await readTeamBoard();
  return teamBoard ? { record: teamBoard, collection: 'team_boards' } : null;
}
