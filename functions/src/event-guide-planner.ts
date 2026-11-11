import {
  eventDates, eventDisplayDate, eventDisplayTime, eventRecord, eventText, type EventDataset,
  type EventGuideSettings, type EventPlan, type EventPlanItem, type EventPreferences, type EventSession,
} from './event-guide-model';
import type { ContentLanguage } from './content-language';

const ignored = new Set('a an and are at can do does for have i in is it me my of on or show tell the to what when where which with you your find booth hours today tomorrow schedule'.split(' '));

function words(value: string): string[] {
  return [...new Set(value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{2,}/gu) ?? [])]
    .filter((word) => !ignored.has(word));
}

function relevance(query: string, fields: string[]): number {
  const tokens = words(query);
  const searchable = new Set(words(fields.join(' ')));
  return tokens.filter((token) => searchable.has(token) || (token.length > 3 && [...searchable].some((word) =>
    word.startsWith(token) || word.length > 3 && token.startsWith(word),
  ))).length;
}

export function eventPreferences(value: unknown, settings: EventGuideSettings): EventPreferences {
  const input = eventRecord(value);
  const dates = eventDates(settings.startDate, settings.endDate);
  const requested = Array.isArray(input['days']) ? input['days'] : [];
  return {
    days: dates.filter((date) => requested.includes(date)),
    interests: eventText(input['interests'], 240),
    mustSee: eventText(input['mustSee'], 180),
    constraints: eventText(input['constraints'], 160),
    pace: input['pace'] === 'marathon' ? 'marathon' : 'curated',
    firstTimer: input['firstTimer'] === true,
  };
}

interface Block extends EventPlanItem { venue: string }

function canPlace(items: Block[], block: Block, travel: number): boolean {
  return items.every((item) => {
    const buffer = item.venue && block.venue && item.venue !== block.venue ? travel : 0;
    return item.end + buffer <= block.start || block.end + buffer <= item.start;
  });
}

function asSession(session: EventSession, informationUrl: string): Block {
  return { start: session.start, end: session.end, kind: session.kind, title: session.title, venue: session.venue,
    location: session.room, note: [session.note, session.access && !session.note.includes(session.access) ? session.access : ''].filter(Boolean).join(' '),
    url: session.url || informationUrl, ...(session.endEstimated ? { endEstimated: true } : {}) };
}

function rankSession(session: EventSession, preferences: EventPreferences): number {
  const fields = [session.title, session.topics, session.note];
  return relevance(preferences.mustSee, [session.title]) * 25
    + relevance(preferences.interests, fields) * 4 + (session.kind === 'Keynote' ? 2 : 0)
    + (preferences.firstTimer && /trends to watch|state of the industry/i.test(session.title) ? 15 : 0);
}

export function buildEventPlan(
  settings: EventGuideSettings, data: EventDataset, preferences: EventPreferences, language: ContentLanguage,
): Omit<EventPlan, 'id' | 'key'> {
  const warnings: string[] = [];
  const travel = /short.*walk|wheelchair|mobility|accessib/i.test(preferences.constraints)
    ? Math.max(settings.travelMinutes, 45) : settings.travelMinutes;
  const visited = new Set<string>();
  const days = eventDates(settings.startDate, settings.endDate).map((date) => {
    if (!preferences.days.includes(date)) return { date, attending: false, items: [], alternatives: [] };
    const placed: Block[] = [];
    const alternatives: Block[] = [];
    const floor = data.floorHours.find((entry) => entry.date === date);
    const candidates = data.sessions.filter((item) => item.date === date)
      .sort((a, b) => rankSession(b, preferences) - rankSession(a, preferences) || a.start - b.start);
    const lunch = [720, 750, 690, 780].map((start): Block => ({
      start, end: start + 45, title: '', location: '', note: '', url: '', kind: 'Break', venue: '',
    }));
    const bestLunch = lunch.find((block) => candidates.filter((item) => relevance(preferences.mustSee, [item.title]))
      .every((item) => item.end <= block.start || item.start >= block.end)) ?? lunch[0];
    placed.push(bestLunch);
    const limit = preferences.pace === 'marathon' ? 5 : 3;
    const pinned = candidates.filter((session) => relevance(preferences.mustSee, [session.title]) > 0);
    const rest = candidates.filter((session) => !pinned.includes(session));
    let sessionCount = 0;

    function addSessions(sessions: EventSession[]): void {
      for (const session of sessions) {
        const block = asSession(session, settings.informationUrl);
        if (session.access || sessionCount >= limit || !canPlace(placed, block, travel)) {
          if (alternatives.length < 3) alternatives.push(block);
          continue;
        }
        placed.push(block);
        sessionCount++;
      }
    }

    addSessions(pinned);
    if (floor && floor.start < floor.end) {
      const available = data.exhibitors.filter((entry) => entry.location && ['area', 'booth'].includes(entry.status))
        .map((entry) => ({ entry, score: relevance(preferences.mustSee, [entry.name]) * 25
          + relevance(preferences.interests, [entry.name, entry.note]) * 4
          + (preferences.firstTimer && /eureka park/i.test(entry.name) ? 15 : 0) }))
        .sort((a, b) => b.score - a.score);
      const exhibits = [...available.filter((item) => !visited.has(item.entry.name)), ...available.filter((item) => visited.has(item.entry.name))];
      const choices = exhibits.map(({ entry }) => ({
        title: entry.name, location: entry.location, venue: entry.venue, note: entry.note,
        url: entry.url || settings.informationUrl, kind: entry.status === 'booth' ? 'Booth' as const : 'Area' as const,
      }));
      choices.push({ title: '', location: '', venue: '', note: '', url: settings.informationUrl, kind: 'Area' });
      let floorBlock: Block | undefined;
      const starts = Array.from({ length: Math.max(0, Math.floor((floor.end - floor.start - 90) / 15) + 1) }, (_, index) => floor.start + index * 15);
      const top = rest.find((session) => !session.access);
      for (const choice of choices) {
        const times = starts.map((start) => ({ ...choice, start, end: start + 90 }));
        const open = times.filter((item) => canPlace(placed, item, travel));
        floorBlock = top ? open.find((item) => canPlace([asSession(top, settings.informationUrl)], item, travel)) ?? open[0] : open[0];
        if (floorBlock) break;
      }
      if (floorBlock) { placed.push(floorBlock); if (floorBlock.title) visited.add(floorBlock.title); }
      else warnings.push(`No 90-minute exhibit window fits on ${eventDisplayDate(date, language)}. Review your must-sees.`);
    }
    addSessions(rest);
    const present = ({ venue: _venue, ...item }: Block): EventPlanItem => ({
      ...item,
      time: eventDisplayTime(item.start, language),
    });
    return { date, attending: true, items: placed.sort((a, b) => a.start - b.start).map(present), alternatives: alternatives.map(present) };
  });
  return { days, warnings };
}

function eventLocalDate(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
}

export function lookupEvent(
  settings: EventGuideSettings, data: EventDataset, question: string, language: ContentLanguage, now = new Date(),
) {
  const dates = eventDates(settings.startDate, settings.endDate);
  const dateLabel = (value: string) => ` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const query = dateLabel(question);
  let date = dates.find((value) => {
    const dateObject = new Date(`${value}T00:00:00Z`);
    const labels = [value, eventDisplayDate(value, language), ...['short', 'long'].map((month) =>
      new Intl.DateTimeFormat('en-US', { month: month as 'short' | 'long', day: 'numeric', timeZone: 'UTC' }).format(dateObject),
    )];
    return labels.some((label) => query.includes(dateLabel(label)));
  });
  const dayName = question.match(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i)?.[0];
  if (!date && dayName) {
    date = dates.find((value) => new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`)).toLowerCase() === dayName.toLowerCase().slice(0, 3));
  }
  if (!date && /\b(today|tomorrow)\b/i.test(question)) {
    const today = eventLocalDate(settings.timeZone, now);
    date = /tomorrow/i.test(question) ? new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10) : today;
  }
  const scoreQuery = question.replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b/gi, '').replace(/\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi, '');
  const generalSchedule = /\b(schedule|what.s on|what is on|today|tomorrow)\b/i.test(question)
    && words(scoreQuery.replace(/what.s|\b(?:program|events|sessions|happening|going)\b/gi, '')).length === 0;
  const floorQuestion = /\b(hours|open|close|closed)\b/i.test(question) && /\b(floor|exhibit|show|hours)\b/i.test(question);
  const floor = data.floorHours.filter((item) => !date || item.date === date);
  const sessions = data.sessions.filter((item) => !date || item.date === date).map((item) => ({
    item, score: relevance(scoreQuery, [item.title, item.topics, item.room, item.kind]) + (/\bkeynotes?\b/i.test(question) && item.kind === 'Keynote' ? 2 : 0),
  })).filter((row) => generalSchedule || row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.date.localeCompare(b.item.date) || a.item.start - b.item.start)
    .slice(0, 4).map((row) => row.item);
  const exhibitors = data.exhibitors.map((item) => ({ item, score: relevance(scoreQuery, [item.name]) }))
    .filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((row) => row.item);
  return {
    event: settings.name, date: date ?? '', timeZone: settings.timeZone, informationUrl: settings.informationUrl,
    sessions: floorQuestion ? [] : sessions,
    exhibitors: floorQuestion ? [] : exhibitors,
    floorHours: floorQuestion ? floor.filter((entry) => entry.start < entry.end) : [],
    floorClosed: floorQuestion && !!date && floor.some((entry) => entry.start === entry.end),
  };
}

export type EventLookup = ReturnType<typeof lookupEvent>;
