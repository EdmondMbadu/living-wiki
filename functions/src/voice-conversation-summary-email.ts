import { safeRecapHttpsUrl, type RealEstateTalkingCardRecapContext } from './real-estate-talking-card-recap';
import { sponsorshipEmail, type Sponsorship } from './talking-card-sponsorship';
import { contentLanguageDetails, type ContentLanguage } from './content-language';
import type { RecapEmailCopy } from './recap-email-localization';

export type VoiceConversationSummarySource = 'wiki_voice' | 'talking_card';

export type VoiceConversationSummary = {
  title: string;
  summary: string;
  keyQuestions: string[];
  takeaways: string[];
  contextualAnswer: string;
  transcriptText: string;
};

export type VoiceConversationPlaceLink = {
  name: string;
  reason: string;
  address: string | null;
  websiteUrl: string | null;
  googleMapsUrl: string;
  searchQuery: string;
  rating: number | null;
  ratingCount: number | null;
};

export type TalkingCardSummaryAction = {
  kind: 'schedule' | 'link';
  label: string;
  url: string;
  description: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildVoiceConversationSummaryEmail(params: {
  recipientEmail: string;
  recipientName: string | null;
  atlasName: string;
  cityName: string | null;
  subjectName?: string | null;
  source?: VoiceConversationSummarySource;
  summary: VoiceConversationSummary;
  answerCardUrl: string | null;
  placeLinks: VoiceConversationPlaceLink[];
  continueChatUrl: string;
  talkingCardActions?: TalkingCardSummaryAction[];
  realEstate?: RealEstateTalkingCardRecapContext | null;
  talkingCardAvatar?: { name: string; imageUrl: string | null } | null;
  sponsorship?: Sponsorship | null;
}, language: ContentLanguage = 'en', copy: RecapEmailCopy = source => source) {
  const locale = contentLanguageDetails(language);
  const htmlCopy = (source: string) => escapeHtml(copy(source));
  const isTalkingCard = params.source === 'talking_card';
  const sponsorship = isTalkingCard ? params.sponsorship : null;
  const sponsor = sponsorship ? sponsorshipEmail(
    { ...sponsorship, message: copy(sponsorship.message) }, copy('Sponsorship acknowledgement'),
  ) : { text: '', html: '' };
  const placeName = params.subjectName || params.cityName || params.atlasName || 'this wiki';
  const realEstate = isTalkingCard ? params.realEstate ?? null : null;
  const subject = copy(realEstate ? '{place} — conversation recap & agent contact'
    : isTalkingCard ? 'Your Living Wiki conversation recap for {place}' : 'Your Living Wiki voice recap for {place}')
    .replace('{place}', () => realEstate?.propertyTitle ?? placeName);
  const greetingName = params.recipientName || params.recipientEmail;
  const greeting = copy('Hi {name},');
  const safeTitle = htmlCopy(params.summary.title);
  const safeSummary = htmlCopy(params.summary.summary);
  const safeContinueChatUrl = escapeHtml(params.continueChatUrl);
  const safeAnswerCardUrl = params.answerCardUrl ? escapeHtml(params.answerCardUrl) : null;
  const talkingCardActions = isTalkingCard ? params.talkingCardActions ?? [] : [];
  const scheduleAction = talkingCardActions.find((action) => action.kind === 'schedule') ?? null;
  const additionalActions = talkingCardActions.filter((action) => action.kind === 'link');
  const scheduleActionHtml = scheduleAction && (!realEstate || !realEstate.contact) ? `
    <div style="background:#fffaf0;border:1px solid #e4c86d;border-radius:16px;padding:20px;margin:0 0 20px;text-align:center;">
      <p style="margin:0 0 5px;color:#74540c;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">${htmlCopy('Continue the conversation')}</p>
      <h3 style="margin:0 0 7px;color:#0d1f15;font-size:20px;line-height:1.2;">${htmlCopy(scheduleAction.label)}</h3>
      ${scheduleAction.description ? `<p style="margin:0 0 15px;color:#526057;font-size:14px;line-height:1.55;">${htmlCopy(scheduleAction.description)}</p>` : ''}
      <a href="${escapeHtml(scheduleAction.url)}" style="display:inline-block;border-radius:999px;padding:13px 22px;color:#ffffff;background:#187a50;text-decoration:none;font-size:14px;font-weight:900;">${htmlCopy(scheduleAction.label)}</a>
    </div>
  ` : '';
  const propertyHeroUrl = realEstate?.propertyImageUrls[0] ?? null;
  const propertyFactsHtml = realEstate?.propertyFacts.length
    ? realEstate.propertyFacts.map((fact) => `<span style="display:inline-block;margin:0 7px 7px 0;padding:7px 10px;border-radius:999px;background:#edf4ef;color:#173c29;font-size:12px;font-weight:800;">${htmlCopy(fact)}</span>`).join('')
    : '';
  const propertyHeroHtml = realEstate ? `
    <div style="margin:0 0 20px;border:1px solid #dfe8dc;border-radius:18px;overflow:hidden;background:#f7faf7;">
      ${propertyHeroUrl ? `<a href="${safeContinueChatUrl}" style="display:block;text-decoration:none;"><img src="${escapeHtml(propertyHeroUrl)}" alt="${escapeHtml(realEstate.propertyTitle)}" width="618" style="display:block;width:100%;max-width:618px;height:auto;max-height:360px;object-fit:cover;border:0;"></a>` : ''}
      <div style="padding:20px 21px;">
        <p style="margin:0 0 6px;color:#7a5a13;font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;">${htmlCopy('Property follow-up')}</p>
        <h2 style="margin:0 0 8px;color:#0d1f15;font-size:24px;line-height:1.2;font-weight:900;letter-spacing:-.02em;">${escapeHtml(realEstate.propertyTitle)}</h2>
        ${realEstate.propertySubtitle && !realEstate.propertyFacts.length ? `<p style="margin:0 0 11px;color:#526057;font-size:14px;line-height:1.5;">${htmlCopy(realEstate.propertySubtitle)}</p>` : ''}
        ${propertyFactsHtml ? `<div style="margin:0 0 8px;">${propertyFactsHtml}</div>` : ''}
        ${realEstate.propertyDescription ? `<p style="margin:0 0 15px;color:#3f4d45;font-size:13px;line-height:1.55;">${htmlCopy(realEstate.propertyDescription)}</p>` : ''}
        <a href="${safeContinueChatUrl}" style="display:inline-block;border-radius:999px;padding:12px 18px;color:#ffffff;background:#173c29;text-decoration:none;font-size:13px;font-weight:900;">${htmlCopy('View VirtualTalkThru')}</a>
        ${realEstate.listingUrl ? `<a href="${escapeHtml(realEstate.listingUrl)}" style="display:inline-block;margin-left:12px;color:#1c7c41;text-decoration:none;font-size:13px;font-weight:850;">${htmlCopy('View original listing →')}</a>` : ''}
      </div>
    </div>
  ` : '';
  const contact = realEstate?.contact ?? null;
  const contactName = contact?.name || params.talkingCardAvatar?.name || 'the listing agent';
  const contactHeading = contact ? copy('Contact {name}').replace('{name}', () => contactName) : '';
  const avatarImageUrl = safeRecapHttpsUrl(params.talkingCardAvatar?.imageUrl) ?? null;
  const avatarInitials = contactName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'RE';
  const phoneTarget = contact?.phone.replace(/[^+\d]/g, '') || '';
  const agentContactHtml = contact ? `
    <div style="margin:0 0 22px;padding:20px;border:1px solid #dcc681;border-radius:18px;background:#fffaf0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="78" valign="top" style="padding:0 14px 0 0;">
            ${avatarImageUrl
              ? `<img src="${escapeHtml(avatarImageUrl)}" alt="${escapeHtml(contactName)}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #ffffff;">`
              : `<div style="width:64px;height:64px;line-height:64px;border-radius:50%;background:#173c29;color:#ffffff;text-align:center;font-size:18px;font-weight:900;">${escapeHtml(avatarInitials)}</div>`}
          </td>
          <td valign="top">
            <p style="margin:0 0 4px;color:#7a5a13;font-size:11px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Interested in this property?')}</p>
            <h3 style="margin:0 0 4px;color:#0d1f15;font-size:20px;line-height:1.2;font-weight:900;">${escapeHtml(contactHeading)}</h3>
            ${contact.agency ? `<p style="margin:0 0 10px;color:#66736b;font-size:13px;line-height:1.4;">${escapeHtml(contact.agency)}</p>` : ''}
            ${contact.phone ? `<p style="margin:0 0 5px;color:#24352b;font-size:14px;line-height:1.4;"><strong>${htmlCopy('Phone:')}</strong> ${phoneTarget ? `<a href="tel:${escapeHtml(phoneTarget)}" style="color:#173c29;text-decoration:none;font-weight:800;">${escapeHtml(contact.phone)}</a>` : `<strong>${escapeHtml(contact.phone)}</strong>`}</p>` : ''}
            ${contact.email ? `<p style="margin:0;color:#24352b;font-size:14px;line-height:1.4;"><strong>${htmlCopy('Email:')}</strong> <a href="mailto:${escapeHtml(contact.email)}" style="color:#173c29;text-decoration:none;font-weight:800;">${escapeHtml(contact.email)}</a></p>` : ''}
          </td>
        </tr>
      </table>
      <div style="margin:16px 0 0;">
        ${phoneTarget ? `<a href="tel:${escapeHtml(phoneTarget)}" style="display:inline-block;margin:0 7px 7px 0;border-radius:999px;padding:12px 18px;background:#173c29;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;">${escapeHtml(copy('Call {name}').replace('{name}', () => contactName))}</a>` : ''}
        ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}" style="display:inline-block;margin:0 7px 7px 0;border-radius:999px;padding:11px 18px;border:1px solid #173c29;color:#173c29;text-decoration:none;font-size:13px;font-weight:900;">${htmlCopy('Email')}</a>` : ''}
        ${scheduleAction ? `<a href="${escapeHtml(scheduleAction.url)}" style="display:inline-block;margin:0 0 7px;border-radius:999px;padding:12px 18px;background:#b48624;color:#ffffff;text-decoration:none;font-size:13px;font-weight:900;">${htmlCopy(scheduleAction.label)}</a>` : ''}
      </div>
    </div>
  ` : '';
  const galleryImages = realEstate?.propertyImageUrls.slice(1, 4) ?? [];
  const propertyGalleryHtml = galleryImages.length ? `
    <div style="margin:0 0 22px;">
      <p style="margin:0 0 11px;color:#0d1f15;font-size:13px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('More property photos')}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
        ${galleryImages.map((url) => `<td width="33.33%" valign="top" style="padding:0 5px;"><a href="${safeContinueChatUrl}"><img src="${escapeHtml(url)}" alt="${htmlCopy('Property photo')}" width="190" style="display:block;width:100%;height:120px;object-fit:cover;border-radius:10px;border:0;"></a></td>`).join('')}
      </tr></table>
    </div>
  ` : '';
  const additionalActionsHtml = additionalActions.length ? `
    <div style="margin:0 0 20px;padding:16px 18px;border:1px solid #e2e8df;border-radius:15px;background:#f8faf7;">
      <p style="margin:0 0 10px;color:#0d1f15;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">${htmlCopy('More from this guide')}</p>
      ${additionalActions.map((action) => `<p style="margin:0 0 8px;"><a href="${escapeHtml(action.url)}" style="color:#1c7c41;text-decoration:none;font-size:14px;font-weight:850;">${htmlCopy(action.label)} →</a>${action.description ? `<br><span style="color:#6f7d74;font-size:12px;">${htmlCopy(action.description)}</span>` : ''}</p>`).join('')}
    </div>
  ` : '';
  const placeLinksHtml = params.placeLinks.length
    ? params.placeLinks.map((place) => {
        const safeName = escapeHtml(place.name);
        const safeReason = htmlCopy(place.reason);
        const safeAddress = place.address ? escapeHtml(place.address) : '';
        const safeWebsite = place.websiteUrl ? escapeHtml(place.websiteUrl) : null;
        const safeMaps = escapeHtml(place.googleMapsUrl);
        const rating = typeof place.rating === 'number'
          ? `<span style="color:#6f7d74;font-size:12px;">${place.rating.toFixed(1)}${place.ratingCount ? ` · ${escapeHtml(copy('{count} reviews').replace('{count}', () => String(place.ratingCount)))}` : ''}</span>`
          : '';
        return `
          <div style="border:1px solid #e2e8df;border-radius:14px;padding:14px 15px;margin:0 0 10px;background:#ffffff;">
            <p style="margin:0 0 5px;color:#0d1f15;font-size:15px;font-weight:900;">${safeName}</p>
            ${safeAddress ? `<p style="margin:0 0 6px;color:#526057;font-size:13px;line-height:1.45;">${safeAddress}</p>` : ''}
            <p style="margin:0 0 10px;color:#3f4d45;font-size:13px;line-height:1.5;">${safeReason}</p>
            <p style="margin:0;display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:13px;font-weight:800;">
              ${safeWebsite ? `<a href="${safeWebsite}" style="color:#1c7c41;text-decoration:none;">${htmlCopy('Website')}</a>` : ''}
              <a href="${safeMaps}" style="color:#1c7c41;text-decoration:none;">${htmlCopy('Open in Maps')}</a>
              ${rating}
            </p>
          </div>
        `;
      }).join('')
    : '';
  const keyQuestionsHtml = params.summary.keyQuestions.length
    ? params.summary.keyQuestions.map((text) => `<li style="margin:0 0 8px;">${htmlCopy(text)}</li>`).join('')
    : `<li style="margin:0 0 8px;">${htmlCopy(isTalkingCard ? 'Your questions are included in the transcript below.' : 'Your voice questions are included in the transcript below.')}</li>`;
  const takeawaysHtml = params.summary.takeaways.length
    ? params.summary.takeaways.map((text) => `<li style="margin:0 0 8px;">${htmlCopy(text)}</li>`).join('')
    : `<li style="margin:0 0 8px;">${htmlCopy(isTalkingCard ? 'Return to the board to continue exploring this wiki.' : 'Open the chat page to continue exploring this wiki.')}</li>`;
  const transcript = params.summary.transcriptText.split('\n').map(line => {
    if (line.startsWith('You: ')) return `${copy('You')}: ${copy(line.slice('You: '.length))}`;
    if (line.startsWith('Living Wiki: ')) return `Living Wiki: ${copy(line.slice('Living Wiki: '.length))}`;
    return copy(line);
  });
  const transcriptHtml = transcript
    .slice(0, 16)
    .map((line) => `<p style="margin:0 0 10px;color:#3f4d45;font-size:13px;line-height:1.55;">${escapeHtml(line)}</p>`)
    .join('');
  const propertyText = realEstate ? [
    `${copy('Property')}:\n${realEstate.propertyTitle}`,
    realEstate.propertyFacts.length ? realEstate.propertyFacts.map(copy).join(' · ') : copy(realEstate.propertySubtitle),
    copy(realEstate.propertyDescription),
    `${copy('View the VirtualTalkThru')}: ${params.continueChatUrl}`,
    realEstate.listingUrl ? `${copy('Original listing')}: ${realEstate.listingUrl}` : '',
  ].filter(Boolean).join('\n') + '\n\n' : '';
  const contactText = contact ? [
    `${contactHeading}:`,
    contact.agency,
    contact.phone ? `${copy('Phone:')} ${contact.phone}` : '',
    contact.email ? `${copy('Email:')} ${contact.email}` : '',
    scheduleAction ? `${copy(scheduleAction.label)}: ${scheduleAction.url}` : '',
  ].filter(Boolean).join('\n') + '\n\n' : '';
  const scheduleText = scheduleAction && !realEstate
    ? `${copy(scheduleAction.label)}:\n${scheduleAction.description ? `${copy(scheduleAction.description)}\n` : ''}${scheduleAction.url}\n\n`
    : '';
  const additionalActionsText = additionalActions.length
    ? `${copy('More links')}:\n${additionalActions.map(action => `- ${copy(action.label)}: ${action.url}${action.description ? ` — ${copy(action.description)}` : ''}`).join('\n')}\n\n`
    : '';
  const placesText = params.placeLinks.length ? `${copy('Places and links')}:\n${params.placeLinks.map(place => [
    `- ${place.name}${place.address ? `, ${place.address}` : ''}`,
    place.websiteUrl ? `  ${copy('Website')}: ${place.websiteUrl}` : '',
    `  ${copy('Maps')}: ${place.googleMapsUrl}`,
  ].filter(Boolean).join('\n')).join('\n')}\n\n` : '';

  const text = `${greeting.replace('{name}', () => greetingName)}

${copy(realEstate ? 'Here is your property conversation recap.' : isTalkingCard ? 'Here is your Living Wiki conversation recap for {place}.' : 'Here is your Living Wiki voice recap for {place}.').replace('{place}', () => placeName)}

${propertyText}${contactText}${copy(params.summary.summary)}

${copy('Questions and prompts')}:
${params.summary.keyQuestions.map(item => `- ${copy(item)}`).join('\n') || `- ${copy('See transcript below.')}`}

${copy('Useful takeaways')}:
${params.summary.takeaways.map(item => `- ${copy(item)}`).join('\n') || `- ${copy(isTalkingCard ? 'Return to the board to continue the conversation.' : 'Continue in the wiki chat.')}`}

${scheduleText}${additionalActionsText}${placesText}${params.answerCardUrl ? `${copy('Open the full recap card')}:\n${params.answerCardUrl}\n\n` : ''}${copy(isTalkingCard ? 'Return to the board' : 'Continue the chat')}:
${params.continueChatUrl}

${contact ? `${copy('Questions or want to arrange a showing?')}\n${contactText}` : ''}

${copy('Transcript')}:
${transcript.join('\n')}
${sponsor.text}

${copy('The Living Wiki Team')}`;

  const html = `
    <div${language === 'en' ? '' : ` lang="${locale.id}" dir="${locale.direction}"`} style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:680px;margin:0 auto;padding:0;background:#f6f8f5;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(realEstate ? copy('Property details, photos, conversation highlights, and contact information for {name}.').replace('{name}', () => contactName) : copy(isTalkingCard ? 'Your conversation recap for {place}.' : 'Your voice recap for {place}.').replace('{place}', () => placeName))}</div>
      <div style="background:linear-gradient(135deg,#07160f 0%,#1c7c41 68%,#d6a94a 100%);padding:34px 30px;border-radius:20px 20px 0 0;">
        <h1 style="color:#ffffff;margin:0;font-size:27px;font-weight:900;letter-spacing:-0.02em;">Living Wiki</h1>
        <p style="color:rgba(255,255,255,0.78);margin:10px 0 0;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;">${htmlCopy(realEstate ? 'Property conversation recap' : isTalkingCard ? 'Conversation recap' : 'Voice recap')}</p>
      </div>
      <div style="background:#ffffff;padding:30px;border:1px solid #e3e8df;border-top:none;border-radius:0 0 20px 20px;">
        <p style="color:#111827;font-size:15px;line-height:1.65;margin:0 0 18px;">${escapeHtml(greeting).replace('{name}', () => `<strong>${escapeHtml(greetingName)}</strong>`)}</p>
        ${propertyHeroHtml}
        ${agentContactHtml}
        <h2 style="color:#0d1f15;font-size:24px;line-height:1.15;margin:0 0 12px;font-weight:900;letter-spacing:-0.03em;">${safeTitle}</h2>
        <p style="color:#3f4d45;font-size:15px;line-height:1.65;margin:0 0 18px;">${safeSummary}</p>
        <div style="background:#f8faf7;border:1px solid #dfe8dc;border-radius:16px;padding:18px 20px;margin:0 0 20px;">
          <p style="margin:0;color:#2f3d35;font-size:14px;line-height:1.65;">${htmlCopy(params.summary.contextualAnswer).replace(/\n/g, '<br>')}</p>
        </div>
        ${scheduleActionHtml}
        ${additionalActionsHtml}
        <div style="background:#f8faf7;border:1px solid #dfe8dc;border-radius:16px;padding:18px 20px;margin:0 0 20px;">
          <p style="margin:0 0 10px;color:#0d1f15;font-size:13px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Questions and prompts')}</p>
          <ul style="margin:0;padding-left:20px;color:#2f3d35;font-size:14px;line-height:1.55;">${keyQuestionsHtml}</ul>
        </div>
        <div style="background:#fffaf0;border:1px solid #eedfaf;border-radius:16px;padding:18px 20px;margin:0 0 22px;">
          <p style="margin:0 0 10px;color:#0d1f15;font-size:13px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Useful takeaways')}</p>
          <ul style="margin:0;padding-left:20px;color:#2f3d35;font-size:14px;line-height:1.55;">${takeawaysHtml}</ul>
        </div>
        ${placeLinksHtml ? `
        <div style="background:#f7fbfa;border:1px solid #d8ece7;border-radius:16px;padding:18px 20px;margin:0 0 22px;">
          <p style="margin:0 0 12px;color:#0d1f15;font-size:13px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Places from your conversation')}</p>
          ${placeLinksHtml}
        </div>
        ` : ''}
        ${propertyGalleryHtml}
        <div style="text-align:center;margin:26px 0;">
          ${safeAnswerCardUrl ? `<a href="${safeAnswerCardUrl}" style="background:#0f2417;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:900;display:inline-block;font-size:14px;margin:0 6px 10px;">${htmlCopy('Open Full Recap Card')}</a>` : ''}
          <a href="${safeContinueChatUrl}" style="background:#1c7c41;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:900;display:inline-block;font-size:14px;margin:0 6px 10px;">${isTalkingCard ? htmlCopy('Return to board') : escapeHtml(copy('Continue in {place}').replace('{place}', () => placeName))}</a>
        </div>
        ${contact ? `
        <div style="margin:24px 0 0;padding:20px;border-radius:16px;background:#0f2417;text-align:center;">
          <p style="margin:0 0 6px;color:#d9c37b;font-size:11px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Questions or ready to see the property?')}</p>
          <p style="margin:0 0 10px;color:#ffffff;font-size:18px;line-height:1.35;font-weight:900;">${escapeHtml(contactHeading)}</p>
          ${contact.phone ? phoneTarget ? `<a href="tel:${escapeHtml(phoneTarget)}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">${escapeHtml(contact.phone)}</a>` : `<span style="color:#ffffff;font-size:14px;font-weight:800;">${escapeHtml(contact.phone)}</span>` : ''}
          ${contact.phone && contact.email ? `<span style="color:#809286;margin:0 8px;">·</span>` : ''}
          ${contact.email ? `<a href="mailto:${escapeHtml(contact.email)}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">${escapeHtml(contact.email)}</a>` : ''}
        </div>
        ` : ''}
        <div style="border-top:1px solid #e5e7eb;margin:24px 0 0;padding-top:20px;">
          <p style="margin:0 0 12px;color:#0d1f15;font-size:13px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;">${htmlCopy('Transcript excerpt')}</p>
          ${transcriptHtml}
        </div>
        ${sponsor.html}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:13px;margin:0;">${htmlCopy('The Living Wiki Team')}</p>
      </div>
    </div>
  `;

  return { subject, text, html };
}
