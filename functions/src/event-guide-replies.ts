import type { ContentLanguage } from './content-language';
import { eventDisplayDate, eventDisplayTime } from './event-guide-model';
import type { EventLookup } from './event-guide-planner';

const replies = {
  en: ["Listed as not exhibiting","Location to be announced","The exhibit floor is closed on this day.","That detail isn’t in the published event program. Check the official event information for updates.","Choose the days you’ll attend and tell me what you’d like to see."],
  fr: ["Indiqué comme non exposant","Lieu à confirmer","Le salon est fermé ce jour-là.","Ce détail ne figure pas dans le programme publié. Consultez les informations officielles.","Choisissez vos jours de présence et dites-moi ce que vous voulez voir."],
  ja: ["出展なしと記載されています","場所は後日発表","この日は展示会場が閉まっています。","公開プログラムには掲載されていません。最新情報は公式案内をご確認ください。","参加する日と、見たいものを教えてください。"],
  pt: ["Consta como não expositor","Local a confirmar","A área de exposições está fechada neste dia.","Esse detalhe não consta na programação publicada. Consulte as informações oficiais.","Escolha os dias em que vai participar e me diga o que quer ver."],
  es: ["Figura como no expositor","Ubicación por anunciar","La zona de exposición está cerrada ese día.","Ese detalle no figura en el programa publicado. Consulta la información oficial.","Elige los días en que asistirás y dime qué te gustaría ver."],
  de: ["Nicht als Aussteller gemeldet","Ort wird noch bekannt gegeben","Die Ausstellung ist an diesem Tag geschlossen.","Diese Angabe fehlt im veröffentlichten Programm. Prüfen Sie die offiziellen Informationen.","Wählen Sie Ihre Besuchstage aus und sagen Sie mir, was Sie sehen möchten."],
  zh: ["已列为不参展","地点待公布","展区当天关闭。","已发布的活动日程中没有这项信息。请查看官方最新消息。","请选择参加日期，并告诉我你想看什么。"],
  it: ["Risulta non espositore","Luogo da annunciare","L’area espositiva è chiusa in questo giorno.","Questo dettaglio non è nel programma pubblicato. Consulta le informazioni ufficiali.","Scegli i giorni in cui parteciperai e dimmi cosa vorresti vedere."],
  ko: ["전시 불참으로 표시됨","장소 추후 공지","이날은 전시장이 운영되지 않습니다.","공개된 프로그램에 없는 정보입니다. 공식 안내에서 최신 내용을 확인하세요.","참석할 날짜를 선택하고 보고 싶은 것을 알려주세요."],
  ar: ["مدرج على أنه غير مشارك في المعرض","سيُعلن عن الموقع لاحقًا","قاعة المعرض مغلقة في هذا اليوم.","هذه المعلومة غير موجودة في البرنامج المنشور. راجع المعلومات الرسمية لمعرفة المستجدات.","اختر أيام الحضور وأخبرني بما تود رؤيته."],
  hi: ["प्रदर्शनी में भाग नहीं ले रहा है","स्थान की घोषणा बाद में होगी","इस दिन प्रदर्शनी बंद है।","यह जानकारी प्रकाशित कार्यक्रम में नहीं है। अपडेट के लिए आधिकारिक जानकारी देखें।","अपने आने के दिन चुनें और बताएं कि आप क्या देखना चाहते हैं।"],
  ru: ["В списке указано, что стенда нет","Место будет объявлено позже","В этот день выставка закрыта.","Этой информации нет в опубликованной программе. Проверьте официальные обновления.","Выберите дни посещения и скажите, что хотите увидеть."],
} satisfies Record<ContentLanguage, string[]>;

export const isEventItineraryQuestion = (question: string): boolean => /\b(?:build|plan|create|generate)\b.*\bitinerary\b/i.test(question);

export function eventGuideReply(result: EventLookup, language: ContentLanguage, openItinerary = false): string {
  const [absent, pending, closed, unknown, itinerary] = replies[language];
  if (openItinerary) return itinerary;
  const lines = [
    ...result.floorHours.map(item => [eventDisplayDate(item.date, language),
      eventDisplayTime(item.start, language) + "–" + eventDisplayTime(item.end, language)].join(" · ")),
    ...result.exhibitors.map(item => [item.name, item.location || (item.status === "absent" ? absent : pending), item.note].filter(Boolean).join(" · ")),
    ...result.sessions.map(item => [eventDisplayDate(item.date, language), eventDisplayTime(item.start, language),
      item.title, item.room, item.access].filter(Boolean).join(" · ")),
  ];
  if (result.floorClosed) lines.push(closed);
  return lines.join("\n") || unknown;
}
