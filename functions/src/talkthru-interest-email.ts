export interface TalkThruEmailInterest {
  role: 'agent' | 'agency';
  name: string;
  email: string;
  agency: string;
  listing: string;
}

export interface TalkThruEmailContent {
  subject: string;
  text: string;
  html: string;
}

const adminUrl = 'https://www.livingwiki.com/admin/users';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function emailShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#f4f8f4;color:#183227;font-family:Arial,sans-serif"><main style="max-width:580px;margin:auto;padding:32px;background:white;border:1px solid #dce9df;border-radius:16px"><p style="margin:0 0 20px;color:#1ea64a;font-size:22px;font-weight:800">LivingWiki</p><h1 style="margin:0 0 20px;font-size:25px;line-height:1.25">${escapeHtml(title)}</h1>${body}<p style="margin:28px 0 0;color:#63756a;font-size:12px">LivingWiki TalkThrus</p></main></body></html>`;
}

export function buildTalkThruApplicantEmail(interest: TalkThruEmailInterest): TalkThruEmailContent {
  const firstName = interest.name.split(/\s+/)[0] || interest.name;
  const subject = 'We received your TalkThru request';
  const text = `Hi ${firstName},\n\nThanks for your interest in LivingWiki TalkThrus. We received your request for ${interest.agency} and will follow up at this email address.\n\nYour listing link: ${interest.listing || 'Not provided'}\n\nThe LivingWiki team`;
  const html = emailShell('We received your TalkThru request',
    `<p>Hi ${escapeHtml(firstName)},</p><p>Thanks for your interest in LivingWiki TalkThrus. We received your request for <strong>${escapeHtml(interest.agency)}</strong> and will follow up at this email address.</p><p><strong>Listing link:</strong> ${interest.listing ? `<a href="${escapeHtml(interest.listing)}">${escapeHtml(interest.listing)}</a>` : 'Not provided'}</p><p>The LivingWiki team</p>`);
  return { subject, text, html };
}

export function buildTalkThruAdminEmail(interest: TalkThruEmailInterest): TalkThruEmailContent {
  const subject = `New TalkThru signup: ${interest.name.replace(/[\r\n]+/g, ' ')}`;
  const role = interest.role === 'agency' ? 'Agency / team' : 'Agent';
  const text = `A new LivingWiki TalkThru request was submitted.\n\nName: ${interest.name}\nEmail: ${interest.email}\nRole: ${role}\nAgency or brokerage: ${interest.agency}\nListing link: ${interest.listing || 'Not provided'}\n\nReview the request: ${adminUrl}`;
  const html = emailShell('New TalkThru signup',
    `<p>A new LivingWiki TalkThru request was submitted.</p><dl><dt><strong>Name</strong></dt><dd>${escapeHtml(interest.name)}</dd><dt><strong>Email</strong></dt><dd>${escapeHtml(interest.email)}</dd><dt><strong>Role</strong></dt><dd>${escapeHtml(role)}</dd><dt><strong>Agency or brokerage</strong></dt><dd>${escapeHtml(interest.agency)}</dd><dt><strong>Listing link</strong></dt><dd>${interest.listing ? `<a href="${escapeHtml(interest.listing)}">${escapeHtml(interest.listing)}</a>` : 'Not provided'}</dd></dl><p><a href="${adminUrl}">Review in the admin queue</a></p>`);
  return { subject, text, html };
}

export function parseTalkThruAdminEmails(value: string): { jim: string; edmond: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error('TALKTHRU_ADMIN_EMAILS must be a JSON object.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TALKTHRU_ADMIN_EMAILS must be a JSON object.');
  }
  const emails = parsed as Record<string, unknown>;
  const jim = typeof emails.jim === 'string' ? emails.jim.trim().toLowerCase() : '';
  const edmond = typeof emails.edmond === 'string' ? emails.edmond.trim().toLowerCase() : '';
  const valid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!valid(jim) || !valid(edmond) || jim === edmond) {
    throw new Error('TALKTHRU_ADMIN_EMAILS must include distinct valid jim and edmond addresses.');
  }
  return { jim, edmond };
}
