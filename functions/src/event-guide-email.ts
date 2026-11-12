import { contentLanguageDetails, type ContentLanguage } from './content-language';
import { eventDisplayDate, eventDisplayTime, eventHttpsUrl, type EventGuideSettings, type EventPlan } from './event-guide-model';
import type { RecapEmailCopy } from './recap-email-localization';

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
  itineraryEditUrl = '', copy: RecapEmailCopy = source => source,
) {
  const locale = contentLanguageDetails(language);
  const [itinerary, dayOff, lunch, exhibits, changes, info, privacy, presentedBy] = messages[language];
  const [recap, conversation, visitor, guide] = recapLabels[language];
  const sponsorMessage = sponsor ? copy(sponsor.message) : '';
  const editUrl = plan ? eventHttpsUrl(itineraryEditUrl) : '';
  const edit = editLabels[language];
  const isRecap = !!(transcript.length || editUrl);
  const title = isRecap ? recap : itinerary;
  const subject = `${title} · ${settings.name}`;
  const text = [subject, settings.timeZone];
  const link = (label: string, value: string) => {
    const url = eventHttpsUrl(value);
    return url ? `<a style="color:#3659ce" href="${escape(url)}">${escape(label)}</a>` : escape(label);
  };
  const highlights = transcript.length ? (() => {
    text.push('', conversation);
    return `<h2 style="font-size:20px;margin:24px 0 8px">${escape(conversation)}</h2>` + transcript.map(turn => {
      const speaker = turn.role === 'user' ? visitor : guide;
      const message = copy(turn.text);
      text.push(`${speaker}: ${message}`);
      return `<p style="margin:8px 0 14px"><strong>${escape(speaker)}</strong><br><span dir="auto">${escape(message).replace(/\r?\n/g, '<br>')}</span></p>`;
    }).join('');
  })() : '';
  if (plan && isRecap) text.push('', itinerary);
  if (editUrl) text.push(edit, editUrl);
  const days = (plan?.days ?? []).map((day) => {
    const date = eventDisplayDate(day.date, language);
    text.push('', date);
    if (!day.attending) text.push(dayOff);
    return `<h2 style="font-size:20px;margin:24px 0 8px">${escape(date)}</h2>` + (day.attending
      ? day.items.map((item) => {
          const time = eventDisplayTime(item.start, language) + (item.endEstimated ? '' : ` – ${eventDisplayTime(item.end, language)}`);
          const title = item.title || (item.kind === 'Break' ? lunch : exhibits);
          const note = copy(item.note);
          text.push([time, title, item.location, note, item.url].filter(Boolean).join(' · '));
          return `<div style="padding:12px 0;border-top:1px solid #dfe4f1"><small>${escape(time)}</small><br><strong>${link(title, item.url)}</strong>${item.location ? `<br>${escape(item.location)}` : ''}${note ? `<br><small>${escape(note)}</small>` : ''}</div>`;
        }).join('') : `<p>${escape(dayOff)}</p>`);
  }).join('');
  if (sponsor) text.push('', `${presentedBy} ${sponsor.name}`, sponsorMessage);
  text.push('', changes, settings.informationUrl, settings.privacyUrl, '', 'LivingWiki', 'https://livingwiki.com');
  const html = `<!doctype html><html lang="${locale.id}" dir="${locale.direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(subject)}</title></head><body style="margin:0;background:#0b1020;color:#101830;font:16px/1.5 Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 12px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px"><tr><td dir="${locale.direction}" style="padding:22px;background:#15254a;color:#ffffff;border-radius:12px 12px 0 0">
    ${sponsor ? `<small>${escape(presentedBy)} ${escape(sponsor.name)}</small>` : ''}<h1 style="margin:8px 0;font:32px Georgia,serif">${escape(title)}</h1><p style="margin:0">${escape(settings.name)} · ${escape(settings.timeZone)}</p></td></tr>
    <tr><td dir="${locale.direction}" style="padding:8px 22px 22px;background:#ffffff">${highlights}${plan && isRecap ? `<h2 style="font-size:23px;margin:28px 0 8px">${escape(itinerary)}</h2>` : ''}
    ${editUrl ? `<p style="margin:12px 0 20px"><a href="${escape(editUrl)}" style="display:inline-block;border-radius:8px;padding:10px 16px;background:#15254a;color:#ffffff;text-decoration:none;font-weight:bold">${escape(edit)}</a></p>` : ''}${days}<p>${escape(changes)}</p>
    ${settings.informationUrl ? `<p>${link(info, settings.informationUrl)}</p>` : ''}</td></tr>
    <tr><td dir="${locale.direction}" style="padding:18px 22px;background:#e9eef9;border-radius:0 0 12px 12px">
    ${sponsor ? `<p>${escape(sponsorMessage)}</p>` : ''}${settings.privacyUrl ? link(privacy, settings.privacyUrl) : ''}
    <p style="margin:10px 0 0;font-size:14px;font-weight:bold">${link('LivingWiki', 'https://livingwiki.com')}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text: text.join('\n') };
}
