/** Client/server copies of this parser are kept identical by the itinerary tests. */
export const TOUR_SOURCE_MAX_LENGTH = 30_000;

export type TourSourceStop = {
  rank: number;
  heading: string;
  title: string;
  subtitle: string;
  body: string;
  guideScript: string;
  arrivalInstruction: string;
  nextInstruction: string;
  durationText: string;
  returnToIndex: number | null;
};
export type TourItinerarySource = {
  title: string;
  description: string;
  items: TourSourceStop[];
};

const clean = (text: string): string => text.replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/__([^_]+)__/g, '$1').replace(/\s+/g, ' ').trim();
const placeKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Parse authored stops without asking a model to rewrite or deduplicate them. */
export function parseTourItinerary(value: string): TourItinerarySource | null {
  const preamble: string[] = [];
  const blocks: Array<{ rank: number; heading: string; lines: string[] }> = [];
  for (const raw of value.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = line.replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1');
    const marker = heading.match(/^(?:Stop\s+)?(\d{1,3})[.):\-–—]\s+(.+)$/i);
    if (marker) blocks.push({ rank: Number(marker[1]), heading: clean(marker[2]), lines: [] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
    else if (line) preamble.push(clean(line));
  }
  // A bare list of places remains a request to write a tour, not an authored script.
  if (blocks.length < 2 || !blocks.some(block => block.lines.some(line => line.trim()))) return null;
  const items = blocks.map((block): TourSourceStop => {
    const parts = block.heading.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    const narration: string[] = [];
    const arrival: string[] = [];
    const next: string[] = [];
    let inNext = false;
    for (const raw of block.lines) {
      const line = clean(raw);
      if (!line) continue;
      const transition = line.match(/^Next\s*:\s*(.*)$/i);
      if (transition) { inNext = true; next.push(transition[1]); }
      else if (inNext) next.push(line);
      else if (!narration.length && /^(?:Stop\s+(?:at|near|outside|beside|by|in)|Gather\s+(?:at|in|near|outside)|Face\s+|Stand\s+(?:at|near|beside))\b/i.test(line)) arrival.push(line);
      else narration.push(line);
    }
    const nextInstruction = clean(next.join(' '));
    const guideScript = clean(narration.join(' '));
    return {
      rank: block.rank, heading: block.heading, title: parts?.[1] ?? block.heading,
      subtitle: parts?.[2] ?? '', body: clean([...arrival, guideScript].join(' ')), guideScript,
      arrivalInstruction: clean(arrival.join(' ')), nextInstruction,
      durationText: nextInstruction.match(/\b\d+(?:\s*[–—-]\s*\d+)?\s*(?:minutes?|mins?|hours?|hrs?)\b/i)?.[0] ?? '',
      returnToIndex: null,
    };
  });
  for (const [index, item] of items.entries()) {
    const destination = item.title.match(/^(?:Back\s+at|Back\s+to|Return\s+to)\s+(?:the\s+)?(.+)$/i)?.[1];
    const key = placeKey((destination || item.title).replace(/^the\s+/i, ''));
    const match = items.slice(0, index).findIndex(stop => {
      const candidate = placeKey(stop.title.replace(/^the\s+/i, ''));
      return key.length >= 5 && (candidate === key || (!!destination && candidate.startsWith(`${key} `)));
    });
    if (match >= 0) item.returnToIndex = match;
  }
  const firstLine = preamble[0] ?? '';
  const emailPreamble = /^(?:hi|hello|dear)\b/i.test(firstLine) || preamble.some(line => /^Thanks[!,]/i.test(line));
  return {
    title: emailPreamble ? '' : firstLine,
    description: emailPreamble ? '' : preamble.slice(1).join(' '),
    items,
  };
}

/** Reject unsupported input explicitly; never silently drop a stop or cut its narration. */
export function tourItineraryInputError(value: string, source = parseTourItinerary(value)): string {
  if (value.length > TOUR_SOURCE_MAX_LENGTH) return `Tours support up to ${TOUR_SOURCE_MAX_LENGTH.toLocaleString('en-US')} characters. Shorten the text before continuing; your pasted text is still here.`;
  if (!source) return '';
  if (source.items.length > 100) return 'A tour can contain up to 100 stops. Split this itinerary into separate tours.';
  for (const [index, stop] of source.items.entries()) {
    if (stop.rank !== index + 1) return 'Number your tour stops consecutively from 1, without gaps or repeated numbers.';
    if (!stop.guideScript) return `Add the narration for stop ${stop.rank}, or describe the tour without numbered script headings to have it written for you.`;
    if (stop.title.length > 80 || stop.subtitle.length > 120) return `Shorten the heading for stop ${stop.rank} to 80 characters and its subtitle to 120 characters.`;
    if (stop.body.length > 3600) return `Stop ${stop.rank} is longer than 3,600 characters. Split it into another stop or shorten its narration.`;
    if (stop.nextInstruction.length > 260) return `Shorten the Next directions after stop ${stop.rank} to 260 characters.`;
    if (index === source.items.length - 1 && stop.nextInstruction) return `The final stop has Next directions. Add the destination as another numbered stop or remove those directions.`;
  }
  return '';
}
