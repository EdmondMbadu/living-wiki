import { loadBoardRouteRecord } from './board-route-record';

describe('board route record access', () => {
  it('opens an unpublished team board for a platform admin using its ordinary board link', async () => {
    const record = { title: 'Private listing', visibility: 'private' };
    expect(await loadBoardRouteRecord(async () => null, async () => record, true))
      .toEqual({ record, collection: 'team_boards' });
  });

  it('keeps public and private personal records on their original collection', async () => {
    const readTeamBoard = jasmine.createSpy('team lookup');
    for (const visibility of ['public', 'private']) {
      const record = { visibility };
      expect(await loadBoardRouteRecord(async () => record, readTeamBoard, true))
        .toEqual({ record, collection: 'boards' });
    }
    expect(readTeamBoard).not.toHaveBeenCalled();
  });

  it('does not attempt a private team lookup for non-admin visitors', async () => {
    const readTeamBoard = jasmine.createSpy('team lookup');
    expect(await loadBoardRouteRecord(async () => null, readTeamBoard, false)).toBeNull();
    expect(readTeamBoard).not.toHaveBeenCalled();
  });

  it('reports a missing board when neither collection contains it', async () => {
    expect(await loadBoardRouteRecord(async () => null, async () => null, true)).toBeNull();
  });

  it('preserves lookup failures instead of disguising them as a missing board', async () => {
    const denied = new Error('permission-denied');
    await expectAsync(loadBoardRouteRecord(async () => null, async () => { throw denied; }, true))
      .toBeRejectedWith(denied);
    const offline = new Error('unavailable');
    const readTeamBoard = jasmine.createSpy('team lookup');
    await expectAsync(loadBoardRouteRecord(async () => { throw offline; }, readTeamBoard, true))
      .toBeRejectedWith(offline);
    expect(readTeamBoard).not.toHaveBeenCalled();
  });
});
