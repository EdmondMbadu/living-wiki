import { realEstateLiveContactCard } from './listing-live-ending';
import { buildStackStoryFrames, stackStoryFrameKey } from './stack-story-frames';

describe('real estate Live ending', () => {
  const room = { id: 'room', title: 'Kitchen', tags: ['listing-story', 'real-estate'] };
  const contact = { id: 'contact', title: 'Contact Alex', tags: ['listing-contact'],
    contactDetails: { name: 'Alex', phone: '2125550100', email: 'alex@example.com' },
    stackNarration: 'Call Alex.' };
  const board = { title: 'Home', cards: [room, contact] };

  it('preserves every original card and adds contact buttons to the separate silent ending', () => {
    const cards = [contact, room];
    const frames = buildStackStoryFrames(cards, false, realEstateLiveContactCard(board, cards, true));
    expect(frames.map(stackStoryFrameKey)).toEqual(['cover', 'card:contact', 'card:room', 'closing']);
    expect(frames[1]).toEqual({ kind: 'card', card: contact });
    expect(frames[3]).toEqual({ kind: 'closing', contactCard: contact });
    expect(cards).toEqual([contact, room]);
  });

  it('keeps standard boards, rental boards, and Studio/export sequences unchanged', () => {
    expect(realEstateLiveContactCard({ title: 'Recipes', cards: [contact] }, [contact], true)).toBeNull();
    expect(realEstateLiveContactCard({ title: 'Rental Property TalkThru', cards: [{ ...room, tags: ['rental'] }, contact] }, [contact], true)).toBeNull();
    expect(realEstateLiveContactCard(board, board.cards, false)).toBeNull();
    expect(buildStackStoryFrames(board.cards, false).map(frame => frame.kind))
      .toEqual(['cover', 'card', 'card', 'closing']);
  });

  it('ignores private setup cards and falls back when contact details are unavailable', () => {
    expect(realEstateLiveContactCard(board, [{ ...contact, authorOnly: true }], true)).toBeNull();
    expect(realEstateLiveContactCard(board, [{ ...contact, contactDetails: {}, title: 'Contact Alex' }], true)).toBeNull();
    expect(realEstateLiveContactCard(board, [room], true)).toBeNull();
    expect(buildStackStoryFrames([room], false, contact).map(frame => frame.kind)).toEqual(['cover', 'card', 'closing']);
  });

  it('supports legacy metadata, single contact methods, and shortened or blank narration', () => {
    const legacy = { id: 'legacy', title: 'Contact Alex', tags: ['real-estate', 'group-next-step'],
      subtitle: 'Example Realty · Phone: 2125550100', notes: '' };
    expect(realEstateLiveContactCard(board, [legacy], true)).toBe(legacy);
    const emailOnly = { ...contact, contactDetails: { email: 'alex@example.com' }, stackNarration: '' };
    expect(realEstateLiveContactCard(board, [emailOnly], true)).toBe(emailOnly);
    expect(realEstateLiveContactCard(board, [contact, emailOnly], true)).toBe(emailOnly);
  });
});
