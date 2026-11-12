/** Shared, provider-independent sponsorship data. Treat configured wording as literal copy. */
export type Sponsorship = { name: string; message: string };
export type SponsorshipChoice = { mode: 'inherit' | 'off' } | ({ mode: 'custom' } & Sponsorship);
export function normalizeSponsorship(value: unknown): Sponsorship | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data['name'] !== 'string' || typeof data['message'] !== 'string') return null;
  const name = data['name'].trim(), message = data['message'].trim();
  if (!name || name.length > 120 || !message || message.length > 500) return null;
  return { name, message };
}
export function normalizeSponsorshipChoice(value: unknown): SponsorshipChoice {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data['mode'] === 'off') return { mode: 'off' };
  if (data['mode'] === 'custom') {
    const sponsor = normalizeSponsorship(data);
    return sponsor ? { mode: 'custom', ...sponsor } : { mode: 'off' };
  }
  return { mode: 'inherit' };
}
export function resolveSponsorship(board: unknown, choice: unknown): Sponsorship | null {
  const normalized = normalizeSponsorshipChoice(choice);
  return normalized.mode === 'off' ? null : normalized.mode === 'custom'
    ? { name: normalized.name, message: normalized.message } : normalizeSponsorship(board);
}
export function sponsorshipEmail(sponsor: Sponsorship | null, heading = 'Sponsorship acknowledgement'): { text: string; html: string } {
  if (!sponsor) return { text: '', html: '' };
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return { text: `\n${heading}\n${sponsor.message}\n`, html: `<div style="border-top:1px solid #dde5df;margin-top:24px;padding-top:18px;color:#526057;font-size:14px;line-height:1.6;"><strong>${escape(heading)}</strong><p>${escape(sponsor.message)}</p></div>` };
}
