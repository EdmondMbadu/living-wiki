import type { ContentLanguage } from './content-language';

/** Reopens the same talking card, without putting email addresses or itinerary keys in the URL. */
export function eventGuideConversationUrl(boardRouteKey: string, cardId: string, language: ContentLanguage): string {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(boardRouteKey) || !/^[A-Za-z0-9_-]{1,180}$/.test(cardId)) return '';
  const prefix = language === 'en' ? '' : `/${language}`;
  const url = new URL(`https://livingwiki.com${prefix}/boards/${encodeURIComponent(boardRouteKey)}`);
  url.searchParams.set('voiceCard', cardId);
  url.searchParams.set('lang', language);
  url.searchParams.set('contentLang', language);
  return url.href;
}
