import { shouldCanonicalizeBoardsRootRoute } from './board-root-route';

describe('boards root route', () => {
  const context = {
    isBrowser: true,
    isFriendsPage: false,
    isSongsPage: false,
    isTripsPage: false,
    boardId: null,
    ownerKey: null,
    userId: 'user-1',
    createQuery: null,
    wizardOpen: false,
  };

  it('canonicalizes a signed-in board gallery route', () => {
    expect(shouldCanonicalizeBoardsRootRoute(context)).toBeTrue();
  });

  it('keeps the nearby-gems launch route stable while its modal is open', () => {
    expect(shouldCanonicalizeBoardsRootRoute({
      ...context,
      createQuery: 'gems',
    })).toBeFalse();
  });

  it('keeps Kiwi property handoffs on the launch route until the wizard opens', () => {
    expect(shouldCanonicalizeBoardsRootRoute({ ...context, createQuery: 'real-estate' })).toBeFalse();
    expect(shouldCanonicalizeBoardsRootRoute({ ...context, createQuery: 'rental' })).toBeFalse();
  });

  it('does not redirect while a board wizard remains open after URL cleanup', () => {
    expect(shouldCanonicalizeBoardsRootRoute({ ...context, wizardOpen: true })).toBeFalse();
  });
});
