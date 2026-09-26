import type { GeneratedBoardWizardBatch, GeneratedBoardWizardCard, GeneratedBoardTourVoiceStyle } from './gemini';
import type { TourItinerarySource } from './board-wizard-tour-source';

export type TourItineraryOptions = {
  voiceStyle: GeneratedBoardTourVoiceStyle;
  paceOrRouteStyle: string;
  extras: string[];
};

/** Source content stays authoritative before and after place/photo enrichment. */
export function buildTourItineraryBatch(
  source: TourItinerarySource,
  mode: 'walking-tour' | 'driving-tour',
  options: TourItineraryOptions,
  enriched?: GeneratedBoardWizardBatch,
): GeneratedBoardWizardBatch {
  const tourMode = mode === 'driving-tour' ? 'driving' : 'walking';
  const start = source.items[0];
  const title = (source.title || `${start.title} — ${tourMode === 'walking' ? 'Walking' : 'Driving'} tour`).slice(0, 90);
  const cards = source.items.map((item, index): GeneratedBoardWizardCard => {
    const existing = enriched?.cards[index];
    const place = source.items[item.returnToIndex ?? index];
    const next = source.items[index + 1];
    const instruction = next ? item.nextInstruction || `${tourMode === 'walking' ? 'Walk' : 'Drive'} to ${next.title}.` : '';
    return {
      ...existing,
      title: item.title, subtitle: item.subtitle || `Stop ${item.rank}`, notes: item.body,
      type: 'place', scope: 'place', status: 'planned', rating: 4,
      tags: ['tour-stop', 'source-item', `stop-${item.rank}`],
      rank: item.rank, entity_name: place.title, entity_type: 'place', image_intent: 'place', media_kind: 'none',
      image_context: start.title,
      image_query: `${place.title} ${start.title} exterior`.slice(0, 180),
      place_query: `${place.title} ${start.title}`.slice(0, 240),
      short_summary: (item.arrivalInstruction || item.subtitle || item.guideScript).slice(0, 160),
      tour: {
        sequence: item.rank, lat: existing?.tour?.lat ?? null, lng: existing?.tour?.lng ?? null,
        address: existing?.tour?.address ?? '', guideScript: item.guideScript,
        legToNext: next ? {
          distanceText: existing?.tour?.legToNext?.distanceText ?? '',
          durationText: item.durationText || existing?.tour?.legToNext?.durationText || '',
          instruction,
          navScript: `Next stop: ${next.title}.${item.durationText ? ` Allow ${item.durationText} ${tourMode === 'walking' ? 'on foot' : 'by car'}.` : ''} I'll meet you there.`,
          encodedPolyline: existing?.tour?.legToNext?.encodedPolyline ?? '',
        } : null,
      },
    };
  });
  // A closing hotel stop is its own card, with its own narration, at the SAME
  // resolved place. A second search must not accidentally select another branch.
  for (const [index, item] of source.items.entries()) {
    if (item.returnToIndex === null) continue;
    const origin = cards[item.returnToIndex];
    const card = cards[index];
    cards[index] = { ...card, placeId: origin.placeId, googleMapsUrl: origin.googleMapsUrl,
      imageUrl: origin.imageUrl || card.imageUrl,
      tour: { ...card.tour!, lat: origin.tour!.lat, lng: origin.tour!.lng, address: origin.tour!.address } };
  }
  return {
    board: { ...enriched?.board, title,
      description: source.description.slice(0, 240) || `${cards.length} stops, following your itinerary from ${start.title}.`.slice(0, 240),
      kind: mode, icon: tourMode === 'walking' ? 'directions_walk' : 'directions_car', tone: 'sky',
      tourMeta: { mode: tourMode, totalDistanceText: '', totalDurationText: '', routePolyline: '',
        ...options, showWayfindersDefault: false } },
    cards,
  };
}
