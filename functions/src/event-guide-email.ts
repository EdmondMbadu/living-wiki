import { contentLanguageDetails, type ContentLanguage } from './content-language';
import { eventDisplayDate, eventDisplayTime, eventEmailDesign, eventHttpsUrl, type EventGuideSettings, type EventPlan } from './event-guide-model';
import { renderEventEmailTemplate } from './event-email-template';
import { eventEmailNote, type EventEmailIdentity } from './event-email-note';

const messages = {
  en: ['Your itinerary', 'Day off', 'Lunch and recharge', 'Explore the show floor', 'Times and locations may change. Check the event’s latest information.', 'Event information', 'Privacy', 'Presented by'],
  fr: ['Votre itinéraire', 'Journée libre', 'Déjeuner et pause', 'Explorer le salon', 'Les horaires et lieux peuvent changer. Consultez les dernières informations de l’événement.', 'Informations', 'Confidentialité', 'Présenté par'],
  ja: ['あなたのイベントプラン', '参加しない日', '昼食と休憩', '展示会場を見学', '時間と会場は変更になる場合があります。最新情報をご確認ください。', 'イベント情報', 'プライバシー', '提供'],
  pt: ['Seu roteiro', 'Dia livre', 'Almoço e descanso', 'Explore a área de exposições', 'Os horários e locais podem mudar. Consulte as informações mais recentes do evento.', 'Informações do evento', 'Privacidade', 'Apresentado por'],
  es: ['Tu itinerario', 'Día libre', 'Almuerzo y descanso', 'Explora la zona de exposición', 'Los horarios y lugares pueden cambiar. Consulta la información más reciente del evento.', 'Información del evento', 'Privacidad', 'Presentado por'],
  de: ['Ihr Zeitplan', 'Freier Tag', 'Mittagessen und Pause', 'Messe erkunden', 'Zeiten und Orte können sich ändern. Prüfen Sie die aktuellen Veranstaltungsinformationen.', 'Veranstaltungsinformationen', 'Datenschutz', 'Präsentiert von'],
  zh: ['你的活动行程', '不参加', '午餐和休息', '参观展区', '时间和地点可能变更，请查看活动的最新信息。', '活动信息', '隐私', '赞助商'],
  it: ['Il tuo itinerario', 'Giorno libero', 'Pranzo e pausa', 'Esplora l’area espositiva', 'Orari e luoghi possono cambiare. Consulta le informazioni aggiornate dell’evento.', 'Informazioni sull’evento', 'Privacy', 'Presentato da'],
  ko: ['나의 행사 일정', '참석하지 않는 날', '점심 및 휴식', '전시장 둘러보기', '시간과 장소는 변경될 수 있습니다. 최신 행사 정보를 확인하세요.', '행사 정보', '개인정보 보호', '후원'],
  ar: ['برنامجك الشخصي', 'يوم بدون حضور', 'الغداء والاستراحة', 'استكشف قاعة المعرض', 'قد تتغير الأوقات والأماكن. راجع أحدث معلومات الفعالية.', 'معلومات الفعالية', 'الخصوصية', 'برعاية'],
  hi: ['आपकी कार्यक्रम योजना', 'उपस्थित नहीं', 'दोपहर का भोजन और आराम', 'प्रदर्शनी देखें', 'समय और स्थान बदल सकते हैं। कार्यक्रम की नवीनतम जानकारी देखें।', 'कार्यक्रम की जानकारी', 'गोपनीयता', 'प्रस्तुतकर्ता'],
  ru: ['Ваш план посещения', 'Свободный день', 'Обед и отдых', 'Осмотр выставки', 'Время и место могут измениться. Проверьте актуальную информацию о мероприятии.', 'Информация о мероприятии', 'Конфиденциальность', 'При поддержке'],
} satisfies Record<ContentLanguage, string[]>;

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

export type EventRecapTurn = { role: 'user' | 'assistant'; text: string };

const recapLabels = {
  en: ['Your event recap', 'From your conversation', 'You', 'Guide'],
  fr: ['Votre récapitulatif', 'Votre conversation', 'Vous', 'Guide'],
  ja: ['イベントの振り返り', '会話の内容', 'あなた', 'ガイド'],
  pt: ['Seu resumo do evento', 'Da sua conversa', 'Você', 'Guia'],
  es: ['Tu resumen del evento', 'De tu conversación', 'Tú', 'Guía'],
  de: ['Dein Veranstaltungsrückblick', 'Aus deinem Gespräch', 'Du', 'Guide'],
  zh: ['你的活动回顾', '对话内容', '你', '活动助手'],
  it: ['Il riepilogo del tuo evento', 'Dalla tua conversazione', 'Tu', 'Guida'],
  ko: ['행사 대화 요약', '대화 내용', '나', '가이드'],
  ar: ['ملخص الفعالية', 'من محادثتك', 'أنت', 'الدليل'],
  hi: ['आपके इवेंट का सारांश', 'आपकी बातचीत से', 'आप', 'गाइड'],
  ru: ['Итоги разговора о мероприятии', 'Из вашего разговора', 'Вы', 'Гид'],
} satisfies Record<ContentLanguage, string[]>;

const editLabels = {
  en: 'Edit your itinerary', fr: 'Modifier votre itinéraire', ja: 'プランを編集する',
  pt: 'Editar seu roteiro', es: 'Editar tu itinerario', de: 'Deinen Zeitplan bearbeiten',
  zh: '编辑行程', it: 'Modifica il tuo itinerario', ko: '일정 수정',
  ar: 'تعديل برنامجك', hi: 'अपनी यात्रा योजना बदलें', ru: 'Изменить маршрут',
} satisfies Record<ContentLanguage, string>;

export function renderEventEmail(
  settings: EventGuideSettings, plan: Pick<EventPlan, 'days'> | null, language: ContentLanguage,
  sponsor: { name: string; message: string } | null, transcript: readonly EventRecapTurn[] = [],
  itineraryEditUrl = '', copy: (source: string) => string = source => source, identity: EventEmailIdentity = {},
) {
  const locale = contentLanguageDetails(language);
  const design = eventEmailDesign(settings.emailDesign);
  const [itinerary, dayOff, lunch, exhibits, changes, info, privacy, presentedBy] = messages[language];
  const [recap] = recapLabels[language];
  const sponsorMessage = sponsor ? copy(sponsor.message) : '';
  const editUrl = plan ? eventHttpsUrl(itineraryEditUrl) : '';
  const edit = editLabels[language];
  const isRecap = !!(transcript.length || editUrl);
  const title = isRecap ? recap : itinerary;
  const subject = `${title} · ${settings.name}`;
  const note = eventEmailNote(settings.name, !!plan, identity, copy);
  const returnUrl = eventHttpsUrl(identity.returnUrl);
  const text = [subject, settings.timeZone, '', note.greeting, '', note.introduction, '', note.plan, note.invitation];
  if (sponsor) text.push('', `${presentedBy} ${sponsor.name}`, sponsorMessage);
  text.push('', note.enjoy, note.cheers, note.signature);
  const link = (label: string, value: string) => {
    const url = eventHttpsUrl(value);
    return url ? `<a style="color:#3659ce" href="${escape(url)}">${escape(label)}</a>` : escape(label);
  };
  // Event emails deliver the itinerary and event details, without raw dialogue.
  // Keep transcript metadata only to distinguish a recap from a standalone plan.
  if (plan && isRecap) text.push('', itinerary);
  if (editUrl) text.push(edit, editUrl);
  const days = (plan?.days ?? []).map((day) => {
    const date = eventDisplayDate(day.date, language);
    text.push('', date);
    if (!day.attending) text.push(dayOff);
    return `<h3 style="font-size:20px;line-height:1.4;margin:28px 0 12px;color:#111a35">${escape(date)}</h3>` + (day.attending
      ? day.items.map((item) => {
          const time = eventDisplayTime(item.start, language) + (item.endEstimated ? '' : ` – ${eventDisplayTime(item.end, language)}`);
          const title = item.title || (item.kind === 'Break' ? lunch : exhibits);
          const note = copy(item.note);
          text.push([time, title, item.location, note, item.url].filter(Boolean).join(' · '));
          return `<div style="padding:16px 0;border-top:1px solid #dfe4f1;line-height:1.7;overflow-wrap:anywhere"><small>${escape(time)}</small><br><strong>${link(title, item.url)}</strong>${item.location ? `<br>${escape(item.location)}` : ''}${note ? `<br><small>${escape(note)}</small>` : ''}</div>`;
        }).join('') : `<p>${escape(dayOff)}</p>`);
  }).join('');
  if (returnUrl) text.push('', note.talkAgain, returnUrl);
  text.push('', changes, settings.informationUrl, settings.privacyUrl, '', 'LivingWiki', 'https://livingwiki.com');
  const noteHtml = `<div style="padding:30px 26px;background:#f3effc;border-top:3px solid #8a65db;color:#151c37;overflow-wrap:anywhere">
    <p style="margin:0 0 16px;font:700 12px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#6743ab">${escape(note.eyebrow)}</p>
    <h1 style="margin:0 0 22px;font:700 25px/1.35 Arial,Helvetica,sans-serif;color:#111731">${escape(note.greeting)}</h1>
    <p style="margin:0 0 22px">${escape(note.introduction)}</p>
    <p style="margin:0 0 5px">${escape(note.plan)}</p><p style="margin:0 0 22px">${escape(note.invitation)}</p>
    ${sponsor ? `<div style="margin:0 0 22px;padding:14px 16px;border-${locale.direction === 'rtl' ? 'right' : 'left'}:3px solid #8a65db;background:#ffffff;color:#39425b;font-size:14px"><strong>${escape(presentedBy)} <span dir="auto">${escape(sponsor.name)}</span></strong><p style="margin:6px 0 0">${escape(sponsorMessage).replace(/\n/g, '<br>')}</p></div>` : ''}
    <p style="margin:0 0 6px">${escape(note.enjoy)}</p><p style="margin:0">${escape(note.cheers)} <strong style="font:italic 27px/1.4 Georgia,serif;color:#182044"><span dir="auto">${escape(note.signature)}</span></strong></p>
  </div>`;
  const headingHtml = `<div style="padding:26px 26px 8px;color:#111a35">
    <p style="margin:0 0 8px;color:#65708c;font-size:12px;letter-spacing:1px"><span dir="auto">${escape(settings.name)}</span> · ${escape(settings.timeZone)}</p>
    <h2 style="margin:0 0 14px;font:700 28px/1.3 Arial,Helvetica,sans-serif;color:#111731">${escape(plan ? itinerary : title)}</h2>
    ${editUrl ? `<a href="${escape(editUrl)}" style="display:inline-block;border:1px solid #3659ce;border-radius:8px;padding:10px 16px;color:#2746b2;text-decoration:none;font-weight:bold">${escape(edit)}</a>` : ''}
  </div>`;
  const detailsHtml = `<div style="padding:0 26px 26px;color:#172039;overflow-wrap:anywhere">${days}
    <p style="margin:24px 0 0;padding:14px;border-radius:10px;background:#f1f4fa;color:#46516c;font-size:13px">${escape(changes)}</p>
    ${settings.informationUrl ? `<p style="margin:16px 0 0">${link(info, settings.informationUrl)}</p>` : ''}
    ${settings.privacyUrl ? `<p style="margin:10px 0 0;font-size:13px">${link(privacy, settings.privacyUrl)}</p>` : ''}</div>`;
  const footerHtml = `<div style="padding:26px;text-align:center;border-top:1px solid #dfe4ef;color:#58627b;background:#fafbfe;border-radius:0 0 16px 16px;overflow-wrap:anywhere">
    ${returnUrl ? `<p style="margin:0 0 12px;font-size:14px">${escape(note.anotherQuestion)}</p><p style="margin:0 0 28px"><a href="${escape(returnUrl)}" style="display:inline-block;border-radius:10px;padding:13px 22px;background:#263f91;color:#ffffff;text-decoration:none;font-weight:bold">${escape(note.talkAgain)}</a></p>` : ''}
    <a href="https://livingwiki.com" style="display:inline-block;text-decoration:none"><img src="https://www.livingwiki.com/assets/image/livingwiki-email-logo.png" alt="LivingWiki" width="170" height="48" style="display:block;width:170px;max-width:100%;height:auto;border:0"></a>
  </div>`;
  if (design?.theme === 'custom') {
    const content = `<div lang="${locale.id}" dir="${locale.direction}" style="font:16px/1.65 Arial,Helvetica,sans-serif;background:#ffffff;color:#101830">${noteHtml}${headingHtml}${detailsHtml}${footerHtml}</div>`;
    const html = renderEventEmailTemplate(design.template, content, locale.id, locale.direction, escape(subject), {
      eventName: escape(settings.name), heading: escape(title),
    });
    if (html) return { subject, html, text: text.join('\n') };
  }
  const banner = design?.theme === 'spotlight' && design.bannerUrl
    ? `<tr><td><img src="${escape(design.bannerUrl)}" alt="" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;border-radius:16px 16px 0 0"></td></tr>` : '';
  const align = locale.direction === 'rtl' ? 'right' : 'left';
  const html = `<!doctype html><html lang="${locale.id}" dir="${locale.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(subject)}</title></head>
  <body style="margin:0;background:#e9edf5;font:16px/1.65 Arial,Helvetica,sans-serif;color:#172039">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(subject)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#e9edf5"><tr><td align="center" style="padding:${banner ? '0 12px 20px' : '24px 12px'}">
  <!--[if mso]><table role="presentation" width="640" align="center"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" dir="${locale.direction}" style="max-width:640px;background:#ffffff;border-radius:16px;border:1px solid #e0e5ef">
    ${banner}<tr><td align="${align}">${noteHtml}</td></tr>
    <tr><td align="${align}" bgcolor="#ffffff">${headingHtml}${detailsHtml}</td></tr>
    <tr><td>${footerHtml}</td></tr>
  </table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject, html, text: text.join('\n') };
}
