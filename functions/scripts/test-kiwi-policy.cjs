const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  normalizeKiwiAction, kiwiApplyBoardAction, kiwiCanReadPersonalBoard,
  kiwiCanEditPersonalBoard, kiwiCanCopyBoard, kiwiCanEditTeamBoard, kiwiCardImageUrl,
  kiwiActionSummary, kiwiActionDetails,
} = require('../lib/kiwi-policy');

test('personal reads, edits, and copies follow separate permission boundaries', () => {
  const otherPublic = { owner_user_id: 'owner', visibility: 'public' };
  const otherUnlisted = { owner_user_id: 'owner', visibility: 'unlisted' };
  const otherPrivate = { owner_user_id: 'owner', visibility: 'private' };
  assert.equal(kiwiCanReadPersonalBoard('reader', otherPublic), true);
  assert.equal(kiwiCanReadPersonalBoard('reader', otherUnlisted), true);
  assert.equal(kiwiCanReadPersonalBoard('reader', otherPrivate), false);
  assert.equal(kiwiCanEditPersonalBoard('reader', otherPublic), false);
  assert.equal(kiwiCanEditPersonalBoard('owner', otherPrivate), true);
  assert.equal(kiwiCanCopyBoard('reader', otherPublic), true);
  assert.equal(kiwiCanCopyBoard('reader', otherUnlisted), false);
  assert.equal(kiwiCanCopyBoard('reader', { ...otherPublic, team_id: 'team' }), false);
});

test('team board edits require matching team and active draft status', () => {
  const board = { team_id: 'team-a', team_status: 'draft' };
  assert.equal(kiwiCanEditTeamBoard('team-a', board), true);
  assert.equal(kiwiCanEditTeamBoard('team-b', board), false);
  assert.equal(kiwiCanEditTeamBoard('team-a', { ...board, team_status: 'archived' }), false);
});

test('Kiwi proposals use Brazilian Portuguese when requested', () => {
  const action = normalizeKiwiAction({ kind: 'create_board', title: 'Meu bairro', visibility: 'public',
    cards: [{ title: 'Praça central', notes: 'Um lugar para passear' }] });
  assert.ok(action && action.kind === 'create_board');
  assert.equal(kiwiActionSummary(action, action.title, 'pt-BR'),
    'Criar o quadro público “Meu bairro” com 1 cartão');
  assert.deepEqual(kiwiActionDetails(action, null, 'pt-BR').slice(0, 4),
    ['Título: Meu bairro', 'Descrição: (nenhuma)', 'Cor: verde-azulado', 'Visibilidade: público']);
});

test('model output is restricted to named board and card fields', () => {
  const action = normalizeKiwiAction({
    kind: 'update_card', boardId: 'board-1', cardId: 'card-1', title: 'New title',
    owner_user_id: 'attacker', visibility: 'public', team_id: 'other-team',
  });
  assert.deepEqual(action, { kind: 'update_card', boardId: 'board-1', cardId: 'card-1', title: 'New title' });
  assert.equal(normalizeKiwiAction({ kind: 'update_board', boardId: '../../other', title: 'Oops' }), null);
  assert.equal(normalizeKiwiAction({ kind: 'create_board', title: 'Untitled', visibility: 'surprise' }), null);
  assert.deepEqual(normalizeKiwiAction({ kind: 'email_board', boardId: 'board-1', email: 'FRIEND@example.com', visibility: 'private' }),
    { kind: 'email_board', boardId: 'board-1', email: 'friend@example.com' });
  assert.equal(normalizeKiwiAction({ kind: 'email_board', boardId: 'board-1', email: 'invalid email' }), null);
});

test('Kiwi accepts remote card photos and rejects local or unsafe URLs', () => {
  const photo = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tea.jpg/1400px-Tea.jpg';
  assert.equal(kiwiCardImageUrl(photo), photo);
  assert.equal(kiwiCardImageUrl('https://example.com/tea.jpg'), 'https://example.com/tea.jpg');
  assert.equal(kiwiCardImageUrl('https://localhost/tea.jpg'), '');
  assert.equal(kiwiCardImageUrl('https://192.168.1.2/tea.jpg'), '');
  assert.equal(kiwiCardImageUrl('http://upload.wikimedia.org/wikipedia/commons/Tea.jpg'), '');
  const action = normalizeKiwiAction({ kind: 'create_board', title: 'Tea', visibility: 'public',
    cards: [{ title: 'Green tea', imageUrl: photo, imageSource: 'generated' }, { title: 'Black tea', imageUrl: 'http://example.com/image.jpg' }] });
  assert.ok(action && action.kind === 'create_board');
  assert.equal(action.cards[0].imageUrl, photo);
  assert.equal(action.cards[0].imageSource, 'generated');
  assert.equal(action.cards[1].imageUrl, undefined);
});

test('card edits preserve unrelated content and invalidate derived board video', () => {
  const board = {
    title: 'Board', owner_user_id: 'owner', visibility: 'private',
    cards: [{ id: 'card-1', title: 'Old', notes: 'Original', imageUrl: 'https://example.com/photo.jpg' }],
    socialVideoRenderVersion: 'old-render',
  };
  const action = normalizeKiwiAction({ kind: 'update_card', boardId: 'board-1', cardId: 'card-1', title: 'New' });
  assert.ok(action && action.kind === 'update_card');
  const next = kiwiApplyBoardAction(board, action, 'unused-id', '2026-09-23T00:00:00.000Z');
  assert.equal(next.owner_user_id, 'owner');
  assert.equal(next.visibility, 'private');
  assert.equal(next.cards[0].title, 'New');
  assert.equal(next.cards[0].notes, 'Original');
  assert.equal(next.cards[0].imageUrl, 'https://example.com/photo.jpg');
  assert.equal(next.socialVideoRenderVersion, '');
  assert.equal(board.cards[0].title, 'Old');
});

test('board design adds distinct cards while preserving existing cards and ownership', () => {
  const board = { title: 'Original', owner_user_id: 'owner', visibility: 'private',
    cards: [{ id: 'existing', title: 'Existing' }] };
  const action = normalizeKiwiAction({ kind: 'design_board', boardId: 'board-1', title: 'Reimagined',
    cards: [{ title: 'First', notes: 'First note' }, { title: 'Second', notes: 'Second note' }],
    owner_user_id: 'attacker' });
  assert.ok(action && action.kind === 'design_board');
  const next = kiwiApplyBoardAction(board, action, 'new-id', '2026-09-23T00:00:00.000Z');
  assert.equal(next.title, 'Reimagined');
  assert.equal(next.owner_user_id, 'owner');
  assert.equal(next.visibility, 'private');
  assert.deepEqual(next.cards.map((card) => card.id), ['existing', 'new-id-1', 'new-id-2']);
  assert.equal(board.cards.length, 1);
});
