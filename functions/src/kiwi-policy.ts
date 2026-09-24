/** Pure, deliberately small edit surface for Kiwi. Never apply model JSON to a board directly. */
export type KiwiCardDraft = {
  title: string;
  subtitle: string;
  notes: string;
  type: 'place' | 'food' | 'memory' | 'idea' | 'shop' | 'note';
  imageUrl?: string;
  imageSource?: 'search' | 'generated';
};

export type KiwiAction =
  | { kind: 'create_board'; title: string; description: string; tone: KiwiTone; visibility: 'public' | 'unlisted' | 'private'; cards: KiwiCardDraft[] }
  | { kind: 'copy_board'; boardId: string }
  | { kind: 'email_board'; boardId: string; email: string }
  | { kind: 'update_board'; boardId: string; title?: string; description?: string; tone?: KiwiTone }
  | { kind: 'design_board'; boardId: string; title?: string; description?: string; tone?: KiwiTone; cards: KiwiCardDraft[] }
  | { kind: 'add_card'; boardId: string; card: KiwiCardDraft }
  | { kind: 'update_card'; boardId: string; cardId: string; title?: string; subtitle?: string; notes?: string; type?: KiwiCardDraft['type'] }
  | { kind: 'remove_card'; boardId: string; cardId: string }
  | { kind: 'reorder_card'; boardId: string; cardId: string; position: number };

export type KiwiTone = 'teal' | 'coral' | 'yellow' | 'green' | 'blue' | 'sky' | 'purple';
type RecordValue = Record<string, unknown>;

export function kiwiCanReadPersonalBoard(uid: string, board: RecordValue): boolean {
  return board['owner_user_id'] === uid || ['public', 'unlisted'].includes(String(board['visibility']));
}

export function kiwiCanEditPersonalBoard(uid: string, board: RecordValue): boolean {
  return board['owner_user_id'] === uid && !board['team_id'];
}

export function kiwiCanCopyBoard(uid: string, board: RecordValue): boolean {
  return !board['team_id'] && board['visibility'] === 'public'
    && !!board['owner_user_id'] && board['owner_user_id'] !== uid;
}

export function kiwiCanEditTeamBoard(teamId: string, board: RecordValue): boolean {
  return board['team_id'] === teamId && board['team_status'] !== 'archived';
}

const cardTypes = ['place', 'food', 'memory', 'idea', 'shop', 'note'] as const;
const tones = ['teal', 'coral', 'yellow', 'green', 'blue', 'sky', 'purple'] as const;

function object(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
}

function optionalText(source: RecordValue, key: string, max: number): string | undefined {
  return Object.hasOwn(source, key) ? text(source[key], max) : undefined;
}

function id(value: unknown): string {
  const result = text(value, 180);
  return /^[A-Za-z0-9_-]{1,180}$/.test(result) ? result : '';
}

function cardDraft(value: unknown): KiwiCardDraft | null {
  const card = object(value);
  if (!card) return null;
  const title = text(card['title'], 120);
  if (!title) return null;
  const requestedType = text(card['type'], 20);
  const imageUrl = kiwiCardImageUrl(card['imageUrl']);
  return {
    title,
    subtitle: text(card['subtitle'], 240),
    notes: text(card['notes'], 3000),
    type: cardTypes.includes(requestedType as KiwiCardDraft['type'])
      ? requestedType as KiwiCardDraft['type'] : 'note',
    ...(imageUrl ? { imageUrl, imageSource: card['imageSource'] === 'generated' ? 'generated' as const : 'search' as const } : {}),
  };
}

/** Accept only remote images that the signed-in user could use in the board editor. */
export function kiwiCardImageUrl(input: unknown): string {
  const raw = text(input, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (url.protocol !== 'https:' || url.username || url.password
      || ['localhost', '0.0.0.0', '::1', 'metadata.google.internal'].includes(host)
      || host.endsWith('.internal') || host.endsWith('.local')
      || /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || /\.(?:svg|tiff?|gif)(?:$|\?)/i.test(url.pathname)) return '';
    return url.toString();
  } catch { return ''; }
}

export function normalizeKiwiAction(value: unknown): KiwiAction | null {
  const source = object(value);
  if (!source) return null;
  const kind = text(source['kind'], 30);
  if (kind === 'create_board') {
    const title = text(source['title'], 90);
    const visibility = text(source['visibility'], 20);
    if (!title || !['public', 'unlisted', 'private'].includes(visibility)) return null;
    const requestedTone = text(source['tone'], 20);
    const cards = Array.isArray(source['cards'])
      ? source['cards'].slice(0, 20).map(cardDraft).filter((card): card is KiwiCardDraft => !!card)
      : [];
    return {
      kind, title, description: text(source['description'], 240),
      tone: tones.includes(requestedTone as KiwiTone) ? requestedTone as KiwiTone : 'teal',
      visibility: visibility as 'public' | 'unlisted' | 'private', cards,
    };
  }
  const boardId = id(source['boardId']);
  if (!boardId) return null;
  if (kind === 'copy_board') return { kind, boardId };
  if (kind === 'email_board') {
    const email = text(source['email'], 254).toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind, boardId, email } : null;
  }
  if (kind === 'update_board' || kind === 'design_board') {
    const requestedTone = text(source['tone'], 20);
    const tone = tones.includes(requestedTone as KiwiTone) ? requestedTone as KiwiTone : undefined;
    const title = optionalText(source, 'title', 90);
    const description = optionalText(source, 'description', 240);
    const cards = kind === 'design_board' && Array.isArray(source['cards'])
      ? source['cards'].slice(0, 12).map(cardDraft).filter((card): card is KiwiCardDraft => !!card) : [];
    if (title === '' || (title === undefined && description === undefined && !tone && cards.length === 0)) return null;
    const changes = { boardId, ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}), ...(tone ? { tone } : {}) };
    return kind === 'design_board' ? { kind, ...changes, cards } : { kind, ...changes };
  }
  if (kind === 'add_card') {
    const card = cardDraft(source['card']);
    return card ? { kind, boardId, card } : null;
  }
  const cardId = id(source['cardId']);
  if (!cardId) return null;
  if (kind === 'remove_card') return { kind, boardId, cardId };
  if (kind === 'reorder_card') {
    const position = Number(source['position']);
    return Number.isInteger(position) && position >= 1 && position <= 200
      ? { kind, boardId, cardId, position } : null;
  }
  if (kind === 'update_card') {
    const title = optionalText(source, 'title', 120);
    const subtitle = optionalText(source, 'subtitle', 240);
    const notes = optionalText(source, 'notes', 3000);
    const requestedType = text(source['type'], 20);
    const type = cardTypes.includes(requestedType as KiwiCardDraft['type'])
      ? requestedType as KiwiCardDraft['type'] : undefined;
    if (title === '' || (title === undefined && subtitle === undefined && notes === undefined && !type)) return null;
    return { kind, boardId, cardId, ...(title !== undefined ? { title } : {}),
      ...(subtitle !== undefined ? { subtitle } : {}), ...(notes !== undefined ? { notes } : {}),
      ...(type ? { type } : {}) };
  }
  return null;
}

export function kiwiActionSummary(action: KiwiAction, boardTitle?: string): string {
  const board = boardTitle || 'the board';
  switch (action.kind) {
    case 'create_board': return `Create ${action.visibility} board “${action.title}” with ${action.cards.length} cards`;
    case 'copy_board': return `Make your own public copy of “${board}”`;
    case 'email_board': return `Email “${board}” to ${action.email}`;
    case 'update_board': return `Update “${board}”${action.title ? ` to “${action.title}”` : ''}`;
    case 'design_board': return `Design “${board}” and add ${action.cards.length} cards`;
    case 'add_card': return `Add “${action.card.title}” to “${board}”`;
    case 'update_card': return `Edit a card on “${board}”`;
    case 'remove_card': return `Remove a card from “${board}”`;
    case 'reorder_card': return `Move a card to position ${action.position} on “${board}”`;
  }
}

export function kiwiActionDetails(action: KiwiAction, board?: RecordValue | null): string[] {
  const existingCard = 'cardId' in action && Array.isArray(board?.['cards'])
    ? board['cards'].find((item: unknown) => object(item)?.['id'] === action.cardId) as RecordValue | undefined
    : undefined;
  const fields = (source: RecordValue, keys: readonly string[]) => keys
    .filter((key) => Object.hasOwn(source, key))
    .map((key) => `${key === 'notes' ? 'Text' : key[0].toUpperCase() + key.slice(1)}: ${String(source[key])}`);
  switch (action.kind) {
    case 'create_board': return [
      `Title: ${action.title}`, `Description: ${action.description || '(none)'}`,
      `Style: ${action.tone}`, `Visibility: ${action.visibility}`,
      ...action.cards.map((card, index) => `${index + 1}. ${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}${card.notes ? `\n${card.notes}` : ''}`),
    ];
    case 'copy_board': return ['Copy public text and images into a new board in your account.'];
    case 'email_board': return [`Recipient: ${action.email}`, `Board: ${String(board?.['title'] || action.boardId)}`];
    case 'update_board': return fields(action, ['title', 'description', 'tone']);
    case 'design_board': return [
      ...fields(action, ['title', 'description', 'tone']),
      ...action.cards.map((card, index) => `${index + 1}. ${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}${card.notes ? `\n${card.notes}` : ''}`),
    ];
    case 'add_card': return fields(action.card, ['title', 'subtitle', 'notes', 'type']);
    case 'update_card': return [
      `Card: ${String(existingCard?.['title'] || action.cardId)}`,
      ...fields(action, ['title', 'subtitle', 'notes', 'type']),
    ];
    case 'remove_card': return [`Remove: ${String(existingCard?.['title'] || action.cardId)}`];
    case 'reorder_card': return [`Move: ${String(existingCard?.['title'] || action.cardId)}`, `Position: ${action.position}`];
  }
}

export function kiwiApplyBoardAction(
  board: RecordValue,
  action: Exclude<KiwiAction, { kind: 'create_board' | 'copy_board' | 'email_board' }>,
  newCardId: string,
  now: string,
): RecordValue {
  const cards = Array.isArray(board['cards']) ? board['cards'].map((card) => ({ ...object(card) })) : [];
  const next: RecordValue = { ...board };
  if (action.kind === 'update_board' || action.kind === 'design_board') {
    if (action.title !== undefined) next['title'] = action.title;
    if (action.description !== undefined) next['description'] = action.description;
    if (action.tone !== undefined) next['tone'] = action.tone;
    if (action.kind === 'design_board') {
      if (cards.length + action.cards.length > 200) throw new Error('This board cannot hold more than 200 cards.');
      for (const card of action.cards) cards.push({ id: newCardId + '-' + cards.length, ...card,
        scope: 'place', status: 'saved', imageUrl: '', imageUrls: [], tags: [], stickers: [], relatedCards: [],
        createdAt: now, updatedAt: now });
      next['cards'] = cards;
    }
  } else if (action.kind === 'add_card') {
    if (cards.length >= 200) throw new Error('This board already has 200 cards.');
    cards.push({ id: newCardId, ...action.card, scope: 'place', status: 'saved',
      imageUrl: '', imageUrls: [], tags: [], stickers: [], relatedCards: [],
      createdAt: now, updatedAt: now });
    next['cards'] = cards;
  } else {
    const index = cards.findIndex((card) => card['id'] === action.cardId);
    if (index < 0) throw new Error('That card is no longer on this board.');
    if (action.kind === 'update_card') {
      const card: RecordValue = { ...cards[index], updatedAt: now };
      for (const key of ['title', 'subtitle', 'notes', 'type'] as const) {
        if (action[key] !== undefined) card[key] = action[key];
      }
      cards[index] = card;
    } else if (action.kind === 'remove_card') {
      cards.splice(index, 1);
    } else {
      const [card] = cards.splice(index, 1);
      cards.splice(Math.min(action.position - 1, cards.length), 0, card);
    }
    next['cards'] = cards;
  }
  if (action.kind !== 'update_board' && (action.kind !== 'design_board' || action.cards.length)) {
    for (const field of [
      'socialVideoRenderVersion', 'socialLandscapeVideoRenderVersion',
      'trailerVideoRenderVersion', 'trailerLandscapeVideoRenderVersion',
      'trailerVideoSourceFingerprint',
    ]) next[field] = '';
  }
  next['updated_at_iso'] = now;
  return next;
}
