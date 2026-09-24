export type CardCreationKind = 'general' | 'talking' | 'intro' | 'contact' | 'qr-code';
export type SpecialCardCreationKind = Exclude<CardCreationKind, 'general' | 'talking'>;

export type SpecialCardDraft = {
  kind: SpecialCardCreationKind;
  message: string;
  name: string;
  organization: string;
  email: string;
  phone: string;
  qrValue: string;
  qrLabel: string;
};

export const CARD_CREATION_OPTIONS: ReadonlyArray<{
  kind: CardCreationKind;
  title: string;
  description: string;
  icon: string;
}> = [
  { kind: 'general', title: $localize`General card`, description: $localize`Describe a place, idea, memory, recommendation, or anything else.`, icon: 'sticky_note_2' },
  { kind: 'intro', title: $localize`Intro card`, description: $localize`Welcome visitors and introduce the story in your own words.`, icon: 'waving_hand' },
  { kind: 'contact', title: $localize`Contact card`, description: $localize`Share a name, phone number, email, and optional organization.`, icon: 'contact_mail' },
  { kind: 'qr-code', title: $localize`QR code card`, description: $localize`Add a QR code people can scan.`, icon: 'qr_code_2' },
];

export function emptySpecialCardDraft(kind: SpecialCardCreationKind, defaults: Partial<SpecialCardDraft> = {}): SpecialCardDraft {
  return {
    kind,
    message: '',
    name: '',
    organization: '',
    email: '',
    phone: '',
    qrValue: '',
    qrLabel: '',
    ...defaults,
  };
}

export function specialCardDraftError(draft: SpecialCardDraft): string {
  if (draft.kind === 'intro') {
    return draft.message.replace(/\s+/g, ' ').trim().length >= 12
      ? ''
      : 'Add a short welcome message of at least 12 characters.';
  }
  if (draft.kind === 'contact') {
    if (!draft.name.replace(/\s+/g, ' ').trim()) return 'Add the contact’s name.';
    if (!draft.email.trim() && !draft.phone.trim()) return 'Add an email address or phone number.';
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return 'Enter a valid email address.';
    return '';
  }
  return draft.qrValue.trim() ? '' : 'Add the link or text for the QR code.';
}

export function isQrCodeCardLike(card: { tags?: readonly string[] | null } | null | undefined): boolean {
  return !!card?.tags?.some((tag) => tag.trim().toLowerCase() === 'qr-code-card');
}
