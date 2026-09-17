export type ListingContactCardLike = {
  title?: string | null;
  subtitle?: string | null;
  notes?: string | null;
  stackNarration?: string | null;
  tags?: readonly string[] | null;
  listingPresentation?: { groupKey?: string | null } | null;
  contactDetails?: ListingContactData | null;
};

export type ListingContactData = {
  name?: string | null;
  organization?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ListingContactCardDetails = {
  name: string;
  agency: string;
  phone: string;
  email: string;
  phoneHref: string;
  emailHref: string;
};

export type ListingContactCardEditInput = {
  name: string;
  organization: string;
  phone: string;
  email: string;
  script: string;
  tags?: readonly string[] | null;
};

export type ListingContactCardEditRecord = {
  title: string;
  subtitle: string;
  notes: string;
  stackNarration: string;
  contactDetails: ListingContactData;
};

const INVITATION_LANGUAGE = /\b(?:interested|questions?|happy to help|private showing|show you|arrange|contact|get in touch)\b/i;

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function contactFragments(card: ListingContactCardLike): string[] {
  const notes = typeof card.notes === 'string' ? card.notes.split(/\r?\n/) : [];
  const subtitle = typeof card.subtitle === 'string' ? card.subtitle.split(/\s*·\s*/) : [];
  // Subtitle was historically the stable display field for contact data, while
  // notes can now contain arbitrary narration. Prefer subtitle during migration.
  return [...subtitle, ...notes].map(clean).filter(Boolean);
}

function cleanAgency(value: string, name: string): string {
  let agency = clean(value);
  if (name && agency.toLocaleLowerCase().startsWith(name.toLocaleLowerCase())) {
    agency = clean(agency.slice(name.length));
  }
  return clean(agency.replace(/\b(?:phone|email)\s*:.*$/i, ''));
}

export function isListingContactCard(card: ListingContactCardLike | null | undefined): boolean {
  if (!card) return false;
  const tags = new Set((card.tags ?? []).map((tag) => clean(tag).toLowerCase()));
  if (tags.has('listing-contact') || tags.has('contact-card')) return true;
  const isLegacyClosingCard = tags.has('group-next-step')
    && tags.has('real-estate')
    && /^contact\b/i.test(clean(card.title));
  return isLegacyClosingCard || card.listingPresentation?.groupKey === 'contact';
}

export function listingContactCardDetails(card: ListingContactCardLike): ListingContactCardDetails {
  const structured = card.contactDetails;
  const title = clean(card.title);
  const nameFromTitle = title.match(/^contact\s+(.+)$/i)?.[1]?.trim() || '';
  const fragments = contactFragments(card);
  const parsedEmail = fragments
    .map((fragment) => fragment.match(/(?:^|\b)email\s*:\s*([^\s·]+@[^\s·]+)$/i)?.[1] || fragment.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)?.[0] || '')
    .find(Boolean) || '';
  const parsedPhone = fragments
    .map((fragment) => fragment.match(/(?:^|\b)phone\s*:\s*(.+)$/i)?.[1]?.trim() || '')
    .find(Boolean) || '';
  const parsedName = nameFromTitle || fragments.find((fragment) => {
    return !/^(?:phone|email)\s*:/i.test(fragment)
      && !INVITATION_LANGUAGE.test(fragment)
      && fragment !== parsedEmail
      && fragment !== parsedPhone;
  }) || '';
  const agencyFragment = fragments.find((fragment) => {
    return fragment !== parsedName
      && fragment !== parsedEmail
      && fragment !== parsedPhone
      && !/^(?:phone|email)\s*:/i.test(fragment)
      && !INVITATION_LANGUAGE.test(fragment)
      && fragment.length <= 120;
  }) || '';
  const name = clean(structured?.name) || parsedName;
  const agency = clean(structured?.organization) || cleanAgency(agencyFragment, name);
  const phone = clean(structured?.phone) || parsedPhone;
  const email = (clean(structured?.email) || parsedEmail).toLowerCase();
  const phoneTarget = phone.replace(/[^+\d]/g, '');
  return {
    name,
    agency,
    phone,
    email,
    phoneHref: phoneTarget ? `tel:${phoneTarget}` : '',
    emailHref: email ? `mailto:${email}` : '',
  };
}

export function listingContactNarration(card: ListingContactCardLike): string {
  const contact = listingContactCardDetails(card);
  const tags = new Set((card.tags ?? []).map((tag) => clean(tag).toLowerCase()));
  const isRealEstate = tags.has('real-estate') || tags.has('listing-contact');
  const opening = isRealEstate ? 'Interested in this home?' : 'Want to get in touch?';
  const person = contact.name
    ? ` Contact ${contact.name}`
    : isRealEstate
      ? ' Get in touch with the listing agent'
      : ' Use the contact details on this card';
  const methods = [
    contact.phone ? `call ${contact.phone}` : '',
    contact.email ? `email ${contact.email}` : '',
  ].filter(Boolean);
  const connection = methods.length ? ` You can ${methods.join(' or ')}.` : '';
  const purpose = isRealEstate ? ' to ask a question or arrange a private showing.' : ' to continue the conversation.';
  return `${opening}${person}${purpose}${connection}`.replace(/\s+/g, ' ').trim();
}

/**
 * Build the canonical fields saved by the Contact Card editor. Contact data is
 * stored separately from narration so changing the script cannot remove the
 * Call or Email actions.
 */
export function listingContactCardEditRecord(input: ListingContactCardEditInput): ListingContactCardEditRecord {
  const name = clean(input.name).slice(0, 120);
  const organization = clean(input.organization).slice(0, 140);
  const phone = clean(input.phone).slice(0, 60);
  const email = clean(input.email).toLowerCase().slice(0, 180);
  const contactDetails: ListingContactData = { name, organization, phone, email };
  const contactCard = {
    title: `Contact ${name}`,
    subtitle: [organization, phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : '']
      .filter(Boolean)
      .join(' · '),
    tags: input.tags,
    contactDetails,
  };
  const script = input.script.trim() || listingContactNarration(contactCard);
  return {
    ...contactCard,
    notes: script,
    stackNarration: script,
  };
}

/**
 * Contact cards created before structured contact details stored name, phone, and
 * email as labeled note lines. Those notes are data, not an authored script.
 * Every other note value is treated as the author's narration verbatim.
 */
export function listingContactScript(card: ListingContactCardLike): string {
  const explicitScript = typeof card.stackNarration === 'string' ? card.stackNarration.trim() : '';
  if (explicitScript) return explicitScript;
  const notes = typeof card.notes === 'string' ? card.notes.trim() : '';
  const containsLegacyContactFields = /(?:^|\n)\s*(?:phone|email)\s*:/im.test(notes);
  return notes && !containsLegacyContactFields
    ? notes
    : listingContactNarration(card);
}
