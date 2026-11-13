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

test('English Talking Card, property, Wiki voice, and event emails match the existing output', async () => {
  const neverTranslate = () => assert.fail('English does not call the translator');
  const copy = await prepareRecapEmailCopy('en', () => assert.fail('English skips collecting translations'), neverTranslate);
  for (const [email, baseline] of [
    [buildVoiceConversationSummaryEmail(voice, 'en', copy), 'e746a493efc43241b04ca987e35e1f3e92e5c63683ecab9fc7453cd5c3e6d189'],
    [buildVoiceConversationSummaryEmail(property, 'en', copy), '6feb773d737538cc21de37a0deeb2de8d3b5a6e9e4b404e53186c8947ea62537'],
    [buildVoiceConversationSummaryEmail({ ...voice, source: 'wiki_voice' }, 'en', copy), '535ffe9c03237afc7be99a88ac23e2f2d265b617696131e79e6c2f5ac66e6666'],
    [renderEventEmail(settings, plan, 'en', sponsor, transcript, editUrl, copy), '24cfd6e14d60f74b4638661741ca62bf63c5b10075f2bf77b515151f0a523210'],
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

test('Event Talking Card localizes mixed-language turns, notes and sponsorship with Arabic layout', async () => {
  const translated = {
    'When do the doors open?': 'متى تفتح الأبواب؟',
    'Doors open at 8:45.': 'تفتح الأبواب في الساعة 8:45.',
    'Thank you to our sponsor.': 'شكرًا للجهة الراعية.',
  };
  const localizedEdit = editUrl.replace('livingwiki.com/', 'livingwiki.com/ar/');
  const render = copy => renderEventEmail(settings, plan, 'ar', sponsor, transcript, localizedEdit, copy);
  const copy = await prepareRecapEmailCopy('ar', render, async (source, language) => {
    assert.equal(language, 'ar');
    assert.deepEqual(new Set(source.map(segment => segment.text)), new Set(Object.keys(translated)));
    return source.map(segment => ({ ...segment, text: translated[segment.text] }));
  });
  const email = render(copy);
  assert.equal(email.subject, 'ملخص الفعالية · CES 2027');
  assert.match(email.html, /lang="ar" dir="rtl"/);
  assert.match(email.html, /تعديل برنامجك/);
  for (const body of [email.html, email.text]) {
    assert.match(body, /متى تفتح الأبواب/);
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
  assert.ok(branded.html.indexOf(localizedEdit) < branded.html.indexOf('/amy.jpg'));
  assert.match(branded.html, /شكرًا للجهة الراعية|LivingWiki/);
  const imageRemoved = renderEventEmail({ ...settings, emailDesign: { theme: 'spotlight', bannerUrl: 'javascript:alert(1)' } }, null, 'ar', null, transcript, '', copy);
  assert.doesNotMatch(imageRemoved.html, /<img|javascript:|تعديل برنامجك/);
  assert.match(imageRemoved.html, /#171f4a/);
});

test('refuses an incomplete translation or one that changes interpolation or adds a header newline', async () => {
  const render = copy => ({ subject: copy('Hi {name},'), text: copy('Your conversation'), html: '' });
  await assert.rejects(prepareRecapEmailCopy('es', render, async () => []), /omitted/);
  for (const invalid of ['Hola', 'Hola {name}, {name}', 'Hola {name},\nOtro encabezado']) {
    await assert.rejects(prepareRecapEmailCopy('es', render, async source =>
      source.map(segment => ({ ...segment, text: segment.text.startsWith('Hi') ? invalid : 'Tu conversación' }))), /placeholder/);
  }
});
