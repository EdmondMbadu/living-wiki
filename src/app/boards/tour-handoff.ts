export type TourHandoffMode = 'walking' | 'driving';
export type TourHandoffLanguage = 'en' | 'fr' | 'ja' | 'pt' | 'es' | 'de' | 'zh';

export type TourHandoffLegLike = {
  durationText?: string | null;
  distanceText?: string | null;
  instruction?: string | null;
  navScript?: string | null;
  toCardId?: string | null;
};

export type TourHandoffCardLike = {
  id: string;
  title: string;
  subtitle?: string | null;
  notes?: string | null;
  shortSummary?: string | null;
  tour?: {
    sequence?: number | null;
    legToNext?: TourHandoffLegLike | null;
  } | null;
};

const genericHandoffPattern = /\b(?:a short distance|roughly nearby|continue to (?:the )?next stop|head to (?:the )?next stop)\b/i;

function cleanHandoffText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_#>~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

function withTerminalPunctuation(value: string, language: TourHandoffLanguage = 'en'): string {
  return value && !/[.!?。！？]$/u.test(value) ? `${value}${language === 'ja' || language === 'zh' ? '。' : '.'}` : value;
}

function normalizedRouteText(value: unknown): string {
  return cleanHandoffText(value, 1_000)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tourHandoffLegTargetsCard(
  leg: TourHandoffLegLike | null | undefined,
  nextCard: TourHandoffCardLike,
): boolean {
  if (!leg) return false;
  const toCardId = cleanHandoffText(leg.toCardId, 160);
  if (toCardId) return toCardId === nextCard.id;
  const nextTitle = normalizedRouteText(nextCard.title);
  const legText = normalizedRouteText(`${leg.instruction ?? ''} ${leg.navScript ?? ''}`);
  return nextTitle.length >= 4 && legText.includes(nextTitle);
}

export function tourHandoffDestinationTeaser(
  card: TourHandoffCardLike,
  language: TourHandoffLanguage = 'en',
): string {
  const candidates = [card.shortSummary, card.notes, card.subtitle];
  for (const candidate of candidates) {
    const cleaned = cleanHandoffText(candidate, 420);
    if (!cleaned || normalizedRouteText(cleaned) === normalizedRouteText(card.title)) continue;
    const completeSentence = cleaned.match(/^(.{1,190}?[.!?。！？])(?:\s|$)/u)?.[1];
    const teaser = cleanHandoffText(completeSentence || cleaned, 190);
    if (teaser) return withTerminalPunctuation(teaser, language);
  }
  return '';
}

export function isGenericTourHandoffScript(value: unknown): boolean {
  const script = cleanHandoffText(value, 700);
  return !script || genericHandoffPattern.test(script);
}

export function buildTourHandoffFallback(
  fromCard: TourHandoffCardLike,
  nextCard: TourHandoffCardLike,
  mode: TourHandoffMode,
  language: TourHandoffLanguage = 'en',
): string {
  const leg = fromCard.tour?.legToNext;
  const title = cleanHandoffText(nextCard.title, 180)
    || ({ en: 'the next stop', fr: 'la prochaine étape', ja: '次の立ち寄り先', pt: 'a próxima parada', es: 'la próxima parada', de: 'der nächste Halt', zh: '下一站' } as const)[language];
  const teaser = tourHandoffDestinationTeaser(nextCard, language);
  const rawDuration = cleanHandoffText(leg?.durationText, 32);
  const duration = language === 'ja'
    ? rawDuration.replace(/\b(?:minutes?|mins?)\b/giu, '分')
    : language === 'zh' ? rawDuration.replace(/\b(?:minutes?|mins?)\b/giu, '分钟')
      : language === 'de' ? rawDuration.replace(/\b(?:minutes?|mins?)\b/giu, 'Minuten') : rawDuration;
  const distance = cleanHandoffText(leg?.distanceText, 32);
  const labels = {
    en: { next: 'Next stop:', onFoot: 'on foot', driving: 'by car', ending: "I'll meet you there." },
    de: { next: 'Nächster Halt:', title: 'der nächste Halt', onFoot: 'zu Fuß', driving: 'mit dem Auto', ending: 'Wir sehen uns dort.' },
    zh: { next: '下一站：', title: '下一站', onFoot: '步行', driving: '驾车', ending: '我们在那里见。' },
    fr: { next: 'Prochaine étape :', onFoot: 'à pied', driving: 'en voiture', ending: 'Je vous y retrouve.' },
    ja: { next: '次の立ち寄り先：', onFoot: '徒歩', driving: '車', ending: 'そこでお会いしましょう。' },
    pt: { next: 'Próxima parada:', onFoot: 'a pé', driving: 'de carro', ending: 'Encontro você lá.' },
    es: { next: 'Próxima parada:', onFoot: 'a pie', driving: 'en auto', ending: 'Nos vemos allí.' },
  } as const;
  const label = labels[language];
  const sentences = [`${label.next}${language === 'ja' || language === 'zh' ? '' : ' '}${withTerminalPunctuation(title, language)}`];
  if (teaser) sentences.push(teaser);
  if (duration) {
    const travelMode = mode === 'driving' ? label.driving : label.onFoot;
    sentences.push(language === 'ja'
      ? `${travelMode}で約${duration}${distance ? `、距離は約${distance}` : ''}です。`
      : language === 'de'
        ? `Sie erreichen den nächsten Halt in etwa ${duration} ${travelMode}${distance ? `, nach ungefähr ${distance}` : ''}.`
        : language === 'zh'
          ? `${travelMode}约需${duration}${distance ? `，距离约${distance}` : ''}。`
      : language === 'fr'
        ? `Vous devriez y arriver en environ ${duration} ${travelMode}${distance ? `, sur environ ${distance}` : ''}.`
        : language === 'pt'
          ? `Você deve chegar em cerca de ${duration} ${travelMode}${distance ? `, a aproximadamente ${distance}` : ''}.`
          : language === 'es'
            ? `Deberías llegar en unos ${duration} ${travelMode}${distance ? `, a aproximadamente ${distance}` : ''}.`
          : `You should reach it in about ${duration} ${travelMode}${distance ? `, around ${distance}` : ''}.`);
  } else if (distance) {
    sentences.push(language === 'ja' ? `距離は約${distance}です。`
      : language === 'de' ? `Der nächste Halt ist etwa ${distance} entfernt.`
        : language === 'zh' ? `距离约为${distance}。`
      : language === 'fr' ? `C'est à environ ${distance}.`
        : language === 'pt' ? `Fica a aproximadamente ${distance} daqui.`
          : language === 'es' ? `Queda a aproximadamente ${distance}.`
          : `It is about ${distance} away.`);
  }
  sentences.push(label.ending);
  return sentences.join(' ').replace(/\s+/g, ' ').trim().slice(0, 700);
}

export function effectiveTourHandoffText(
  fromCard: TourHandoffCardLike,
  nextCard: TourHandoffCardLike,
  mode: TourHandoffMode,
  language: TourHandoffLanguage = 'en',
): string {
  const leg = fromCard.tour?.legToNext;
  const curated = cleanHandoffText(leg?.navScript, 700);
  if (
    curated
    && tourHandoffLegTargetsCard(leg, nextCard)
    && !isGenericTourHandoffScript(curated)
  ) {
    return curated;
  }
  return buildTourHandoffFallback(fromCard, nextCard, mode, language);
}
