import {
  CARD_CREATION_OPTIONS,
  emptySpecialCardDraft,
  isQrCodeCardLike,
  specialCardDraftError,
} from './card-creation';

describe('card creation chooser', () => {
  it('offers the four intentional top-level card types', () => {
    expect(CARD_CREATION_OPTIONS.map((option) => option.kind)).toEqual([
      'general', 'intro', 'contact', 'qr-code',
    ]);
  });

  it('validates only the information each focused card requires', () => {
    expect(specialCardDraftError(emptySpecialCardDraft('intro'))).toContain('welcome');
    expect(specialCardDraftError(emptySpecialCardDraft('intro', { message: 'Welcome to this story.' }))).toBe('');
    expect(specialCardDraftError(emptySpecialCardDraft('contact', { name: 'Jenny' }))).toContain('email address or phone');
    expect(specialCardDraftError(emptySpecialCardDraft('contact', { name: 'Jenny', email: 'jenny@example.com' }))).toBe('');
    expect(specialCardDraftError(emptySpecialCardDraft('qr-code', { qrValue: 'https://livingwiki.com' }))).toBe('');
  });

  it('recognizes QR cards without changing the legacy card type model', () => {
    expect(isQrCodeCardLike({ tags: ['note', 'qr-code-card'] })).toBeTrue();
    expect(isQrCodeCardLike({ tags: ['qr-code'] })).toBeFalse();
  });
});
