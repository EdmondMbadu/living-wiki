import { boardCoverPhotoUrl, PLACE_PHOTO_ENDPOINT, stablePlacePhotoUrl } from './place-photo';
describe('durable Places photo URLs', () => {
  const id = 'ChIJd8kca4PIxokRqW59OWceihQ';
  const old = PLACE_PHOTO_ENDPOINT + '?ref=expired';
  it('recovers cards and public city projections without persisting temporary references', () => {
    expect(stablePlacePhotoUrl(old, id)).toBe(PLACE_PHOTO_ENDPOINT + '?placeId=' + id);
    expect(stablePlacePhotoUrl(old, undefined, 'board_1')).toBe(PLACE_PHOTO_ENDPOINT + '?boardId=board_1');
  });
  it('does not replace uploaded or other custom images', () => {
    expect(stablePlacePhotoUrl('https://example.com/upload.jpg', id)).toBe('https://example.com/upload.jpg');
    expect(stablePlacePhotoUrl('https://evil.example/boardPlacePhoto?ref=old', id)).toBe('https://evil.example/boardPlacePhoto?ref=old');
  });
  it('recovers only the card matching the cover and excludes author-only cards', () => {
    const board = { visibility: 'public', imageUrl: old, cards: [{ imageUrl: old, placeId: id }] };
    expect(boardCoverPhotoUrl('board_1', board)).toBe(PLACE_PHOTO_ENDPOINT + '?placeId=' + id);
    expect(boardCoverPhotoUrl('board_1', { ...board, cards: [{ ...board.cards[0], authorOnly: true }] })).toBe(PLACE_PHOTO_ENDPOINT + '?boardId=board_1');
  });
  it('keeps private covers from using a public board lookup', () => {
    expect(boardCoverPhotoUrl('private', { visibility: 'private', imageUrl: old, cards: [] })).toBe(old);
  });
});
