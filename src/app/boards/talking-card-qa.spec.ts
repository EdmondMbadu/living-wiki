import { BoardsComponent } from './boards';
describe('Talking Card QA entry', () => {
  function harness(signedIn = true, administrator = true) {
    const component = Object.create(BoardsComponent.prototype);
    Object.assign(component, { authService: { uid: () => signedIn ? 'owner' : null },
      atlasService: { atlases: () => [{ id: 'avatar' }], canAdminAtlas: () => administrator },
      isTalkingCard: (card: any) => !!card.conversation?.atlasId, canEditBoard: () => true });
    return component;
  }
  const board = { id: 'board' };
  const card = { id: 'card', tags: [], conversation: { atlasId: 'avatar' } };
  it('shows QA only to signed-in avatar administrators', () => {
    expect(harness().canOpenAvatarQa(board, card)).toBeTrue();
    expect(harness(false).canOpenAvatarQa(board, card)).toBeFalse();
    expect(harness(true, false).canOpenAvatarQa(board, card)).toBeFalse();
  });
  it('does not offer unsupported team or listing-context tests', () => {
    expect(harness().canOpenAvatarQa({ ...board, teamId: 'team' }, card)).toBeFalse();
    expect(harness().canOpenAvatarQa(board, { ...card, tags: ['listing-agent-guide'] })).toBeFalse();
    expect(harness().canOpenAvatarQa(board, { ...card, conversation: null })).toBeFalse();
  });
});
