import type { ContentLanguage } from './content-language';

export const ADDITIONAL_HANDOFF_LABELS = {
  it: { next: 'Prossima tappa:', title: 'la prossima tappa', onFoot: 'a piedi', driving: 'in auto', ending: 'Ci vediamo lì.', minutes: 'minuti' },
  ko: { next: '다음 정류장:', title: '다음 정류장', onFoot: '도보', driving: '자동차', ending: '그곳에서 만나요.', minutes: '분' },
  ar: { next: 'المحطة التالية:', title: 'المحطة التالية', onFoot: 'سيرًا على الأقدام', driving: 'بالسيارة', ending: 'سألقاك هناك.', minutes: 'دقائق' },
  hi: { next: 'अगला पड़ाव:', title: 'अगला पड़ाव', onFoot: 'पैदल', driving: 'कार से', ending: 'वहाँ मिलते हैं।', minutes: 'मिनट' },
  ru: { next: 'Следующая остановка:', title: 'следующая остановка', onFoot: 'пешком', driving: 'на машине', ending: 'До встречи там.', minutes: 'минут' },
} as const;

/** Deterministic fallback narration: no extra translation request on a handoff. */
export function additionalHandoffTravel(
  language: ContentLanguage, travelMode: string, duration: string, distance: string,
): string | null {
  const km = { it: 'chilometri', ko: '킬로미터', ar: 'كيلومتر', hi: 'किलोमीटर', ru: 'километров' };
  const meters = { it: 'metri', ko: '미터', ar: 'متر', hi: 'मीटर', ru: 'метров' };
  if (!(language in ADDITIONAL_HANDOFF_LABELS)) return null;
  const id = language as keyof typeof ADDITIONAL_HANDOFF_LABELS;
  duration = duration.replace(/\b(?:minutes?|mins?)\b/giu, ADDITIONAL_HANDOFF_LABELS[id].minutes);
  distance = distance.replace(/\b(?:km|kilometers?|kilometres?)\b/giu, km[id])
    .replace(/\b(?:m|meters?|metres?)\b/giu, meters[id]);
  if (!duration && !distance) return '';
  switch (id) {
    case 'it': return duration ? `Ci vogliono circa ${duration} ${travelMode}${distance ? `, per circa ${distance}` : ''}.` : `La distanza è di circa ${distance}.`;
    case 'ko': return duration ? `${travelMode}로 약 ${duration}${distance ? `, 거리는 약 ${distance}` : ''}입니다.` : `거리는 약 ${distance}입니다.`;
    case 'ar': return duration ? `تستغرق الرحلة حوالي ${duration} ${travelMode}${distance ? `، لمسافة تقارب ${distance}` : ''}.` : `تبلغ المسافة حوالي ${distance}.`;
    case 'hi': return duration ? `${travelMode} पहुँचने में लगभग ${duration} लगेंगे${distance ? ` और दूरी लगभग ${distance} है` : ''}।` : `दूरी लगभग ${distance} है।`;
    case 'ru': return duration ? `Дорога ${travelMode} займёт около ${duration}${distance ? `, расстояние — примерно ${distance}` : ''}.` : `Расстояние — примерно ${distance}.`;
  }
}
