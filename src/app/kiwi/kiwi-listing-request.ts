export type KiwiListingIntent = 'sale' | 'rental' | 'choose';

/** Keep property creation out of Kiwi's generic describe-a-board pipeline. */
export function kiwiListingIntent(request: string): KiwiListingIntent | null {
  const creating = /\b(create|make|build|design|draft|start|set up|turn|convert|want|would like)\b/i.test(request);
  const subject = /\b(board|talk\s*thru|walkthrough|tour|listing)\b/i.test(request);
  if (!creating || !subject) return null;
  const propertyContext = /\b(property|home|house|apartment|condo|real estate|listing|talk\s*thru|walkthrough|tour|airbnb|vrbo)\b/i.test(request)
    || /\brental board\b/i.test(request);
  if (propertyContext && /\b(rent(?:al|als|ing)?|airbnb|vrbo|vacation (?:home|property|rental)|short[ -]term (?:stay|rental)|holiday (?:home|rental))\b/i.test(request)) return 'rental';
  if (/\b(real estate|property listing|home listing|for sale|sell my (?:home|house|property))\b/i.test(request)
    && !/\bboard (?:about|on|of)\b/i.test(request)) return 'sale';
  if (/\b(talk\s*thru|walkthrough)\b/i.test(request) && /\b(property|home|house|apartment|condo)\b/i.test(request)) return 'choose';
  return null;
}

/** Accept a pasted public URL, including www links copied without a scheme. */
export function kiwiListingUrl(value: string): string | null {
  const candidate = value.match(/(?:https?:\/\/|www\.)[^\s<>]+/i)?.[0]
    ?.replace(/[),.;!?]+$/, '');
  if (!candidate) return null;
  try {
    const url = new URL(candidate.startsWith('www.') ? `https://${candidate}` : candidate);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || !host.includes('.')
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || url.username || url.password || url.href.length > 1000) return null;
    return url.href;
  } catch { return null; }
}
