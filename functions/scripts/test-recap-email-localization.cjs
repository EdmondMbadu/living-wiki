const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { buildVoiceConversationSummaryEmail } = require('../lib/voice-conversation-summary-email');
const { renderEventEmail } = require('../lib/event-guide-email');
const { prepareRecapEmailCopy } = require('../lib/recap-email-localization');

const sponsor = { name: 'Example Foundation', message: 'Thank you to our sponsor.' };
const voice = {
  recipientEmail: 'visitor@example.org',
  recipientName: 'Ada <Guest>',
  atlasName: 'Tate Modern',
  cityName: 'London',
  subjectName: 'The Tate Top 20',
  source: 'talking_card',
  summary: {
    title: 'Your afternoon at Tate Modern',
    summary: 'We discussed which galleries to visit.',
    keyQuestions: ['Which gallery opens first?'],
    takeaways: ['Start on the second floor.'],
    contextualAnswer: 'Check the opening hours.\nThen visit the gallery.',
    transcriptText: 'You: Which gallery opens first?\nLiving Wiki: Start on the second floor.',
  },
  answerCardUrl: 'https://livingwiki.com/answer-card/123',
  continueChatUrl: 'https://livingwiki.com/boards/the-tate-top-20',
  talkingCardActions: [
    { kind: 'schedule', label: 'Book a visit', url: 'https://example.org/booking', description: 'Choose a time.' },
    { kind: 'link', label: 'Museum guide', url: 'https://example.org/guide', description: 'Explore the galleries.' },
  ],
  placeLinks: [{
    name: 'Tate Modern', reason: 'We discussed its exhibitions.', address: 'Bankside, London',
    websiteUrl: 'https://example.org/tate', googleMapsUrl: 'https://example.org/maps',
    rating: 4.8, ratingCount: 150,
  }],
  sponsorship: sponsor,
};
const property = {
  ...voice,
  subjectName: '12 Museum Road',
  realEstate: {
    propertyTitle: '12 Museum Road', propertySubtitle: '', propertyDescription: 'A home with a garden.',
    propertyFacts: ['3 bedrooms'], propertyImageUrls: ['https://example.org/hero.jpg', 'https://example.org/side.jpg'],
    listingUrl: 'https://example.org/listing',
    contact: { name: 'Ada Agent', agency: 'Example Homes', phone: '+1 (555) 123-4567', email: 'agent@example.org' },
  },
  talkingCardAvatar: { name: 'Ada Agent', imageUrl: 'https://example.org/avatar.jpg' },
};
const settings = {
  name: 'CES 2027', timeZone: 'America/Los_Angeles', informationUrl: 'https://example.org/event',
  privacyUrl: 'https://example.org/privacy',
};
const plan = { days: [{ date: '2027-01-07', attending: true, items: [
  { start: 540, end: 600, kind: 'Keynote', title: 'CES Opening Keynote', location: 'LVCC',
    note: 'Doors open at 8:45.', url: 'https://example.org/keynote' },
] }, { date: '2027-01-08', attending: false, items: [] }] };
const transcript = [
  { role: 'user', text: 'When do the doors open?' },
  { role: 'assistant', text: 'Doors open at 8:45.' },
];
const editUrl = 'https://livingwiki.com/event-itinerary#plan.private-key';
const digest = email => createHash('sha256').update(JSON.stringify(email)).digest('hex');

test('English Talking Card, property, and Wiki voice emails match the existing output', async () => {
  const neverTranslate = () => assert.fail('English does not call the translator');
  const copy = await prepareRecapEmailCopy('en', () => assert.fail('English skips collecting translations'), neverTranslate);
  for (const [email, baseline] of [
    [buildVoiceConversationSummaryEmail(voice, 'en', copy), 'e746a493efc43241b04ca987e35e1f3e92e5c63683ecab9fc7453cd5c3e6d189'],
    [buildVoiceConversationSummaryEmail(property, 'en', copy), '6feb773d737538cc21de37a0deeb2de8d3b5a6e9e4b404e53186c8947ea62537'],
    [buildVoiceConversationSummaryEmail({ ...voice, source: 'wiki_voice' }, 'en', copy), '535ffe9c03237afc7be99a88ac23e2f2d265b617696131e79e6c2f5ac66e6666'],
  ]) assert.equal(digest(email), baseline);
});

test('Talking Card translates the subject, rich and plain copy, and optional property sections', async () => {
  const source = [];
  const translations = new Map([
    ['{place} — conversation recap & agent contact', 'Récapitulatif et coordonnées de l’agent — {place}'],
    ['Hi {name},', 'Bonjour {name},'],
    ['Your afternoon at Tate Modern', 'Votre après-midi à la Tate Modern'],
    ['We discussed which galleries to visit.', 'Nous avons parlé des galeries à visiter.'],
    ['A home with a garden.', 'Une maison avec jardin.'],
    ['Return to board', 'Revenir au tableau'],
    ['Which gallery opens first?', 'Quelle galerie ouvre en premier ?'],
    ['Thank you to our sponsor.', 'Merci à notre partenaire.'],
  ]);
  const render = copy => buildVoiceConversationSummaryEmail(property, 'fr', copy);
  const copy = await prepareRecapEmailCopy('fr', render, async (segments, language) => {
    assert.equal(language, 'fr');
    source.push(...segments.map(segment => segment.text));
    return segments.map(segment => ({ ...segment, text: translations.get(segment.text) ?? `FR · ${segment.text}` }));
  });
  const email = render(copy);
  assert.equal(email.subject, 'Récapitulatif et coordonnées de l’agent — 12 Museum Road');
  assert.match(email.html, /lang="fr" dir="ltr"/);
  assert.match(email.html, /Bonjour <strong>Ada &lt;Guest&gt;<\/strong>/);
  for (const body of [email.html, email.text]) {
    assert.match(body, /Nous avons parlé des galeries à visiter/);
    assert.match(body, /Une maison avec jardin/);
    assert.match(body, /Quelle galerie ouvre en premier/);
    assert.match(body, /Merci à notre partenaire/);
    assert.ok(body.includes(voice.continueChatUrl));
  }
  assert.match(email.html, /Votre après-midi à la Tate Modern/);
  assert.match(email.html, /Revenir au tableau/);
  assert.match(email.html, /href="tel:\+15551234567"/);
  assert.ok(source.includes('Check the opening hours.\nThen visit the gallery.'));
  assert.ok(source.includes('Property photo'));
  assert.ok(source.every(text => !text.includes('visitor@example.org') && !text.includes('Ada <Guest>')));
});

test('a regular Talking Card localizes the subject and action description even if the recap card is unavailable', async () => {
  const render = (copy, answerCardUrl = voice.answerCardUrl) =>
    buildVoiceConversationSummaryEmail({ ...voice, answerCardUrl }, 'es', copy);
  const copy = await prepareRecapEmailCopy('es', render, async (source, language) => {
    assert.equal(language, 'es');
    const translations = {
      'Your Living Wiki conversation recap for {place}': 'Tu resumen de Living Wiki sobre {place}',
      'Choose a time.': 'Elige una hora.',
    };
    return source.map(segment => ({ ...segment, text: translations[segment.text] ?? segment.text }));
  });
  const email = render(copy, null);
  assert.equal(email.subject, 'Tu resumen de Living Wiki sobre The Tate Top 20');
  assert.match(email.html, /Elige una hora/);
  assert.match(email.text, /Elige una hora/);
  assert.ok(!email.html.includes(voice.answerCardUrl));
});

test('Event Talking Card omits dialogue and localizes itinerary notes and sponsorship with Arabic layout', async () => {
  const translated = {
    'Doors open at 8:45.': 'تفتح الأبواب في الساعة 8:45.',
    'Thank you to our sponsor.': 'شكرًا للجهة الراعية.',
    'A note from your guide': 'رسالة من مرشدك',
    'Hi - I really enjoyed speaking with you!': 'مرحبًا، سعدت بالحديث معك!',
    '{event} is an unmatched venue for experiencing all the incredible innovations transforming how we live.': '{event} وجهة فريدة لاكتشاف الابتكارات التي تغير حياتنا.',
    'Below is your personalized plan.': 'فيما يلي برنامجك المخصص.',
    'Below are your event details.': 'فيما يلي تفاصيل فعاليتك.',
    'Please talk with me again if you need updated information.': 'تحدث معي مجددًا إذا احتجت إلى معلومات محدثة.',
    'Enjoy your stay!': 'استمتع بإقامتك!',
    'Cheers,': 'مع أطيب التحيات،',
    'Your event guide': 'مرشدك للفعالية',
    'Talk to your guide again': 'تحدث مع مرشدك مجددًا',
    'Have another question?': 'هل لديك سؤال آخر؟',
  };
  const localizedEdit = editUrl.replace('livingwiki.com/', 'livingwiki.com/ar/');
  const render = copy => renderEventEmail(settings, plan, 'ar', sponsor, transcript, localizedEdit, copy);
  const copy = await prepareRecapEmailCopy('ar', copy => {
    render(copy);
    renderEventEmail(settings, null, 'ar', null, transcript, '', copy);
  }, async (source, language) => {
    assert.equal(language, 'ar');
    assert.deepEqual(new Set(source.map(segment => segment.text)), new Set(Object.keys(translated)));
    return source.map(segment => ({ ...segment, text: translated[segment.text] }));
  });
  const email = render(copy);
  assert.equal(email.subject, 'ملخص الفعالية · CES 2027');
  assert.match(email.html, /lang="ar" dir="rtl"/);
  assert.match(email.html, /تعديل برنامجك/);
  for (const body of [email.html, email.text]) {
    assert.doesNotMatch(body, /When do the doors open|متى تفتح الأبواب/);
    assert.match(body, /تفتح الأبواب في الساعة 8:45/);
    assert.match(body, /شكرًا للجهة الراعية/);
    assert.match(body, /CES Opening Keynote/);
    assert.match(body, /LivingWiki/);
    assert.ok(body.includes(localizedEdit));
    assert.doesNotMatch(body, /Doors open at 8:45/);
  }
  const recapOnly = renderEventEmail(settings, null, 'ar', null, transcript, localizedEdit, copy);
  assert.equal(recapOnly.subject, email.subject);
  assert.doesNotMatch(recapOnly.html, /تعديل برنامجك|CES Opening Keynote/);
  const bannerUrl = 'https://example.org/amy.jpg?one=1&two=2';
  const brandedSettings = { ...settings, emailDesign: { theme: 'spotlight', bannerUrl } };
  const branded = renderEventEmail(brandedSettings, plan, 'ar', sponsor, transcript, localizedEdit, copy);
  assert.equal(branded.subject, email.subject);
  assert.equal(branded.text, email.text);
  assert.match(branded.html, /dir="rtl"/);
  assert.match(branded.html, /src="https:\/\/example\.org\/amy\.jpg\?one=1&amp;two=2"/);
  assert.ok(branded.html.indexOf('/amy.jpg') < branded.html.indexOf('<h1'));
  assert.ok(branded.html.indexOf('/amy.jpg') < branded.html.indexOf(localizedEdit));
  assert.match(branded.html, /شكرًا للجهة الراعية|LivingWiki/);
  const imageRemoved = renderEventEmail({ ...settings, emailDesign: { theme: 'spotlight', bannerUrl: 'javascript:alert(1)' } }, null, 'ar', null, transcript, '', copy);
  assert.doesNotMatch(imageRemoved.html, /javascript:|تعديل برنامجك/);
  assert.equal((imageRemoved.html.match(/<img /g) || []).length, 1); // The safe LivingWiki footer logo remains.
  assert.match(imageRemoved.html, /#f3effc/);
  const custom = renderEventEmail({ ...settings, emailDesign: {
    theme: 'custom', filename: 'ces.html', template: '<table><tr><td><img src="https://example.org/banner.jpg" onerror="alert(1)"><h2>CES</h2><!-- livingwiki:recap --></td></tr></table><script>alert(1)</script>',
  } }, plan, 'ar', sponsor, transcript, localizedEdit, copy);
  assert.equal(custom.subject, email.subject);
  assert.equal(custom.text, email.text);
  assert.match(custom.html, /lang="ar" dir="rtl"/);
  assert.match(custom.html, /<h2>CES<\/h2><div/);
  assert.match(custom.html, /src="https:\/\/example\.org\/banner\.jpg"/);
  assert.match(custom.html, /تعديل برنامجك/);
  assert.doesNotMatch(custom.html, /onerror|<script/);
});

test('only event emails omit raw transcripts in HTML and plain text for every language and design', () => {
  const { CONTENT_LANGUAGES } = require('../lib/content-language');
  const dialogue = [
    { role: 'user', text: 'VISITOR_DIALOGUE_SENTINEL' },
    { role: 'assistant', text: 'GUIDE_DIALOGUE_SENTINEL' },
  ];
  const designs = [undefined, { theme: 'spotlight', bannerUrl: 'https://example.org/banner.jpg' },
    { theme: 'custom', template: '<div><!-- livingwiki:recap --></div>' }];
  for (const { id: language } of CONTENT_LANGUAGES) {
    for (const emailDesign of designs) {
      for (const itinerary of [plan, null]) {
        const message = renderEventEmail({ ...settings, emailDesign }, itinerary, language, sponsor, dialogue, editUrl);
        for (const body of [message.html, message.text]) {
          assert.doesNotMatch(body, /VISITOR_DIALOGUE_SENTINEL|GUIDE_DIALOGUE_SENTINEL|From your conversation/);
          assert.ok(body.includes(settings.informationUrl));
          assert.ok(body.includes(sponsor.message));
          if (itinerary) {
            assert.ok(body.includes('CES Opening Keynote'));
            assert.ok(body.includes('https://example.org/keynote'));
            assert.ok(body.includes(editUrl));
          }
        }
      }
    }
  }
});

test('the banner is the first visible content in every event email and the supplied CES template', () => {
  const { parse } = require('parse5');
  const { readFileSync } = require('node:fs');
  const { CONTENT_LANGUAGES } = require('../lib/content-language');
  const firstVisibleContent = (node) => {
    if (['head', 'style', 'script'].includes(node.nodeName)) return null;
    const style = node.attrs?.find(attr => attr.name === 'style')?.value || '';
    if (/display\s*:\s*none/i.test(style)) return null;
    if (node.nodeName === 'img') return 'banner';
    if (node.nodeName === '#text' && node.value.trim()) return node.value.trim();
    for (const child of node.childNodes || []) {
      const visible = firstVisibleContent(child);
      if (visible) return visible;
    }
    return null;
  };
  for (const { id: language } of CONTENT_LANGUAGES) {
    for (const recapOnly of [false, true]) {
      const message = renderEventEmail({ ...settings, emailDesign: {
        theme: 'spotlight', bannerUrl: 'https://example.org/banner.jpg',
      } }, recapOnly ? null : plan, language, sponsor,
      recapOnly ? [{ role: 'assistant', text: 'Your visit recap.' }] : []);
      assert.equal(firstVisibleContent(parse(message.html)), 'banner', `${language}: ${recapOnly ? 'recap' : 'itinerary'}`);
      assert.equal((message.html.match(/<img /g) || []).length, 2); // Event banner and LivingWiki footer logo.
      assert.match(message.html, /padding:0 12px 20px/);
    }
  }
  const template = readFileSync(require.resolve('../../public/assets/event-guide/ces-2027-recap-template.html'), 'utf8');
  const message = renderEventEmail({ ...settings, emailDesign: { theme: 'custom', template } }, plan, 'en', sponsor);
  assert.equal(firstVisibleContent(parse(message.html)), 'banner');
});

test('custom HTML preserves safe email styles, removes active markup, and appends a missing slot', () => {
  const { prepareEventEmailTemplate, renderEventEmailTemplate, EVENT_EMAIL_TEMPLATE_MAX_BYTES } = require('../lib/event-email-template');
  const source = `<style>@media (max-width:620px){.card {width:100%}}</style>
    <style>@import 'https://example.org/unsafe.css'</style><meta http-equiv="refresh" content="0;url=https://example.org">
    <table class="card" title="&lt;!--livingwiki:recap--&gt;"><tr><td style="background:linear-gradient(#fff,#123)"><a href="https://example.org">Details</a>
    <img src="https://example.org/image.jpg" srcset="https://other.example.org/image.jpg 2x" onerror="alert(1)">
    <a href="java&#x09;script:alert(1)">Bad</a><span style="background:u\\72l(https://example.org)">Body</span>
    <form action="https://example.org"><input></form><iframe src="https://example.org"></iframe><svg><script>bad</script></svg></td></tr></table>`;
  const safe = prepareEventEmailTemplate(source);
  assert.equal(prepareEventEmailTemplate(safe), safe);
  assert.match(safe, /@media/);
  assert.match(safe, /linear-gradient/);
  assert.doesNotMatch(safe, /onerror|srcset|@import|refresh|javascript|<form|<iframe|<svg|background:u/);
  assert.match(renderEventEmailTemplate(safe, '<p>Recap</p>', 'en', 'ltr', 'Subject'), /<\/table><p>Recap<\/p><\/body>/);
  assert.equal(prepareEventEmailTemplate('<p>{{guest.name}}</p>'), null);
  assert.equal(prepareEventEmailTemplate('<script>alert(1)</script>'), null);
  assert.equal(prepareEventEmailTemplate('あ'.repeat(EVENT_EMAIL_TEMPLATE_MAX_BYTES / 2)), null);
});

test('imports the CES Handlebars layout and fills its heading and recap in the guest language', () => {
  const { prepareEventEmailTemplate } = require('../lib/event-email-template');
  const source = `<!doctype html><html lang="{{guest.language}}" dir="{{guest.direction}}"><head><title>Your CES 2027 Itinerary</title></head>
    <body><table><tr><td><table><tr><td style="background:#0e1530">
    {{#if event.logo_url}}<img src="{{event.logo_url}}">{{else}}<span>{{event.name}}</span>{{/if}}
    </td></tr><tr><td style="background:#121a3a"><div class="hero-title">{{labels.hello}} {{guest.first_name}}, your mission plan is ready.</div>
    <div>{{summary_line}}</div></td></tr>{{#each days}}<tr><td>{{date_label}}</td></tr>{{/each}}
    {{#if top_booths.length}}{{labels.times_note}}{{/if}}</table></td></tr></table></body></html>`;
  const template = prepareEventEmailTemplate(source);
  assert.ok(template);
  assert.equal(prepareEventEmailTemplate(template), template);
  const message = renderEventEmail({ ...settings, emailDesign: { theme: 'custom', filename: 'ces.html', template } },
    plan, 'fr', sponsor, [{ role: 'assistant', text: 'Bienvenue !' }], editUrl);
  assert.match(message.html, /background:#0e1530/);
  assert.match(message.html, /<span>CES 2027<\/span>/);
  assert.match(message.html, /class="hero-title">Votre récapitulatif/);
  assert.match(message.html, /ces-2027-amy-email\.jpg/);
  assert.doesNotMatch(message.html, /Bienvenue !/);
  assert.match(message.html, /Modifier votre itinéraire/);
  assert.match(message.html, /LivingWiki/);
  assert.doesNotMatch(message.html, /{{|your mission plan is ready/);
});

test('refuses an incomplete translation or one that changes interpolation or adds a header newline', async () => {
  const render = copy => ({ subject: copy('Hi {name},'), text: copy('Your conversation'), html: '' });
  await assert.rejects(prepareRecapEmailCopy('es', render, async () => []), /omitted/);
  for (const invalid of ['Hola', 'Hola {name}, {name}', 'Hola {name},\nOtro encabezado']) {
    await assert.rejects(prepareRecapEmailCopy('es', render, async source =>
      source.map(segment => ({ ...segment, text: segment.text.startsWith('Hi') ? invalid : 'Tu conversación' }))), /placeholder/);
  }
});
