/** Shared presentation and runtime identity for city guides, including older city templates. */
export const PICAMO_AVATAR = '/assets/picamo/avatar.webp';
export const PICAMO_CITY_GUIDE = '/assets/picamo/city-guide.webp';

type Guide = { name: string | null; label: string | null; image_url: string | null; banner_url: string | null; city_persona_override?: boolean };
type CityAtlas = {
  name?: unknown;
  wiki_type?: unknown;
  city_config?: { enabled?: unknown; city_name?: unknown } | null;
  university_config?: { enabled?: unknown } | null;
  chat_guide?: unknown;
};

export function resolveCityGuide(atlas: CityAtlas | null | undefined): Guide | null {
  if (!atlas || atlas.wiki_type === 'university' || atlas.university_config?.enabled === true
    || (atlas.wiki_type !== 'city' && atlas.city_config?.enabled !== true)) return null;
  const guide = atlas.chat_guide && typeof atlas.chat_guide === 'object'
    ? atlas.chat_guide as Partial<Guide> : null;
  const name = typeof guide?.name === 'string' ? guide.name.trim() : '';
  if (guide?.city_persona_override === true) return {
    name: name || 'City guide', label: guide.label || null, image_url: guide.image_url || null,
    banner_url: guide.banner_url || null, city_persona_override: true,
  };
  return {
    name: 'Picamo', label: 'Your curious city guide', image_url: PICAMO_AVATAR,
    banner_url: guide?.banner_url || null,
  };
}

export function cityGuidePersonaPrompt(atlas: CityAtlas | null | undefined, configuredPrompt: string | null | undefined): string {
  const guide = resolveCityGuide(atlas);
  if (!guide || guide.city_persona_override) return configuredPrompt?.trim() || '';
  const city = typeof atlas?.city_config?.city_name === 'string' ? atlas.city_config.city_name.trim()
    : typeof atlas?.name === 'string' ? atlas.name.trim() : 'this city';
  return [
    `You are Picamo, the curious LivingWiki guide to ${city}.`,
    'Be warm, practical, concise, and interested in local stories, neighborhoods, civic life, food, culture, and useful discoveries.',
    'Answer as Picamo, never as a previous city character or historical persona. Do not claim to literally be the city or to have personal memories.',
    'Ground recommendations in available sources. Be clear about uncertainty, changing information, and what the visitor should verify.',
    'Do not introduce yourself repeatedly; focus on the question and ask useful clarifying questions when preferences or constraints matter.',
  ].join(' ');
}
