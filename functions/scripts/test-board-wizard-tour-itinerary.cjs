const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { script } = require('../../tests/fixtures/london-eagles-tour.json');
const { parseTourItinerary, tourItineraryInputError, TOUR_SOURCE_MAX_LENGTH } = require('../lib/board-wizard-tour-source');
const { buildTourItineraryBatch } = require('../lib/board-wizard-tour-itinerary');
const { finalizeBoardWizardCopy } = require('../lib/board-wizard-copy-quality');
const { resolveBoardWizardCount } = require('../lib/board-wizard-count-policy');
const options = { voiceStyle: 'historian', paceOrRouteStyle: 'Standard', extras: [] };

test('client and server use the same itinerary parser', () => {
  assert.equal(readFileSync(require('node:path').join(__dirname, '../../src/app/boards/board-wizard-tour-source.ts'), 'utf8'), readFileSync(require('node:path').join(__dirname, '../src/board-wizard-tour-source.ts'), 'utf8'));
});

test('Jim’s full nine-stop tour preserves every narration and separates directions', async () => {
  assert.ok(script.length > 2200 && script.length < TOUR_SOURCE_MAX_LENGTH);
  const source = parseTourItinerary(script);
  assert.equal(tourItineraryInputError(script, source), '');
  assert.equal(source.items.length, 9);
  assert.equal(source.items[8].returnToIndex, 0);
  assert.equal(source.items[1].arrivalInstruction, 'Stop near the Samuel Pepys bust.');
  assert.ok(source.items[1].guideScript.startsWith('Meet Samuel Pepys'));
  assert.equal(source.items[4].arrivalInstruction, 'Face the Thames, with Tower Bridge ahead.');
  assert.equal(source.items[0].durationText, '2–3 minutes');
  assert.equal(source.items[8].guideScript.endsWith('Go Birds!'), true);
  assert.equal(source.items[7].nextInstruction, 'Head west toward Trinity Square, then back to Pepys Street and the DoubleTree. 3–4 minutes.');
  const count = resolveBoardWizardCount({ text: script, submittedCount: 12, countMode: 'fixed', sourceCount: source.items.length });
  assert.equal(count.targetCount, 9);
  assert.equal(count.policy, 'source-exact');
  for (const mode of ['walking-tour', 'driving-tour']) {
    const batch = buildTourItineraryBatch(source, mode, options);
    assert.equal(batch.cards.length, 9);
    assert.equal(batch.board.kind, mode);
    assert.deepEqual(batch.cards.map(c => c.title), source.items.map(s => s.title));
    assert.deepEqual(batch.cards.map(c => c.tour.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [i, card] of batch.cards.entries()) {
      assert.equal(card.tour.guideScript, source.items[i].guideScript);
      assert.equal(card.notes, source.items[i].body);
      assert.equal(card.tour.legToNext?.instruction ?? '', source.items[i].nextInstruction);
      assert.equal(card.tour.guideScript.includes('Next:'), false);
      assert.equal(card.tour.lat, null); // No fabricated coordinates.
    }
    assert.equal(batch.cards.at(-1).tour.legToNext, null);
    assert.equal(batch.cards.at(-1).entity_name, batch.cards[0].entity_name);
    const final = await finalizeBoardWizardCopy(batch, () => { throw new Error('Authored narration must not be rewritten'); });
    assert.deepEqual(final, batch);
  }
});

test('place enrichment cannot rewrite the script, remove the return card, or move it to another hotel', () => {
  const source = parseTourItinerary(script);
  const batch = buildTourItineraryBatch(source, 'walking-tour', options);
  const enriched = { ...batch, cards: batch.cards.map((card, index) => ({ ...card,
    title: 'Provider title', notes: 'Provider prose', placeId: `place-${index}`, imageUrl: `https://example.com/${index}.jpg`,
    googleMapsUrl: `https://maps.example/${index}`, tour: { ...card.tour, lat: 51 + index / 100, lng: -0.1,
      address: `Address ${index}`, guideScript: 'Rewritten narration' } })) };
  const result = buildTourItineraryBatch(source, 'walking-tour', options, enriched);
  assert.equal(result.cards.length, 9);
  assert.deepEqual(result.cards.map(c => c.tour.guideScript), source.items.map(s => s.guideScript));
  assert.equal(result.cards[8].tour.lat, result.cards[0].tour.lat);
  assert.equal(result.cards[8].tour.address, 'Address 0');
  assert.equal(result.cards[8].placeId, 'place-0');
  assert.equal(result.cards[8].imageUrl, 'https://example.com/0.jpg');
  assert.notEqual(result.cards[8].tour.guideScript, result.cards[0].tour.guideScript);
});

test('markdown, CRLF, and the email preface do not become spoken narration', () => {
  const source = parseTourItinerary(`Hi Edmond,\nPlease import this.\nThanks! Jim\n\n${script.replace(/^(\d+\. .+)$/gm, '## **$1**').replace(/\n/g, '\r\n')}`);
  assert.equal(source.title, '');
  assert.equal(source.items.length, 9);
  assert.deepEqual(source.items.map(s => s.guideScript), parseTourItinerary(script).items.map(s => s.guideScript));
});

test('a repeated named endpoint stays a distinct stop at the original place', () => {
  const source = parseTourItinerary('1. The Central Hotel\nWelcome to our starting point.\nNext: Walk to the plaza.\n2. Plaza\nEnjoy the square.\nNext: Return to the hotel.\n3. The Central Hotel\nThanks for exploring with us.');
  assert.equal(source.items.length, 3);
  assert.equal(source.items[2].returnToIndex, 0);
});

test('invalid, oversized, and incomplete scripts fail explicitly instead of being truncated', () => {
  const errors = [
    [script + 'x'.repeat(30000), /30,000/],
    [script.replace('5. Tower Wharf', '6. Tower Wharf'), /consecutively/],
    [`1. First\n${'x'.repeat(3601)}\n2. Last\nClosing narration.`, /3,600/],
    ['1. First\nNarration.\n2. Last', /narration for stop 2/],
    [`1. First\nNarration.\nNext: ${'x'.repeat(261)}\n2. Last\nClosing.`, /260/],
    ['1. First\nNarration.\n2. Last\nClosing.\nNext: Missing destination', /final stop/],
  ];
  for (const [text, expected] of errors) assert.match(tourItineraryInputError(text), expected);
  assert.equal(parseTourItinerary('A historical walking tour around London.'), null);
  assert.equal(parseTourItinerary('1. Hotel\n2. Tower\n3. Bridge'), null);
  assert.equal(tourItineraryInputError('Create a walking tour of London'), '');
});

test('the callable imports the complete tour, enriches all stops, and assembles routes in order', async () => {
  const { mock } = require('node:test');
  process.env.GCLOUD_PROJECT = 'demo-tour-itinerary';
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-tour-itinerary', storageBucket: 'demo-tour-itinerary.appspot.com' });
  process.env.GOOGLE_PLACES_API_KEY = 'test-only';
  process.env.GOOGLE_CUSTOM_SEARCH_API_KEY = '';
  const { db } = require('../lib/firebase');
  const gemini = require('../lib/gemini');
  const { generateBoardWizardBatch } = require('../lib/index');
  const records = [];
  const routes = [];
  const unexpected = [];
  const source = parseTourItinerary(script);
  const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  mock.method(db, 'collection', name => {
    assert.equal(name, 'board_wizard_batches');
    return { add: async record => { records.push(record); return { id: 'test-batch' }; } };
  });
  mock.method(gemini, 'generateBoardWizardBatch', async () => { throw new Error('Authored script must not use AI rewriting'); });
  mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'maps.googleapis.com' && url.pathname.includes('/textsearch/')) {
      const query = url.searchParams.get('query');
      const index = source.items.findIndex(stop => query.toLowerCase().startsWith(stop.title.toLowerCase()));
      assert.ok(index >= 0, `Unexpected place query ${query}`);
      return response({ status: 'OK', results: [{ place_id: `place-${index}`, name: source.items[index].title,
        formatted_address: `${index} Tower Hill, London, UK`, types: ['tourist_attraction'],
        geometry: { location: { lat: 51.5 + index / 1000, lng: -0.07 } },
        photos: [{ photo_reference: `photo-${index}`, width: 1600, height: 900 }] }] });
    }
    if (url.hostname === 'routes.googleapis.com') {
      const body = JSON.parse(init.body);
      const index = Math.round((body.origin.location.latLng.latitude - 51.5) * 1000);
      routes.push(body);
      // Deliberately complete the route requests out of stop order.
      await new Promise(resolve => setTimeout(resolve, (9 - index) * 3));
      return response({ routes: [{ distanceMeters: 200, duration: '180s', polyline: { encodedPolyline: `leg-${index}` } }] });
    }
    if (url.hostname.endsWith('wikipedia.org') || url.hostname.endsWith('wikimedia.org')) return response({ query: { pages: {}, search: [] } });
    unexpected.push(url.hostname);
    throw new Error(`Unexpected external request: ${url.hostname}`);
  });
  try {
    await assert.rejects(generateBoardWizardBatch.run({ data: { mode: 'walking-tour', prompt: script } }), { code: 'unauthenticated' });
    await assert.rejects(generateBoardWizardBatch.run({ auth: { uid: 'author' }, data: { mode: 'walking-tour', prompt: script + 'x'.repeat(30000) } }), { code: 'invalid-argument' });
    const result = await generateBoardWizardBatch.run({ auth: { uid: 'author' }, data: {
      mode: 'walking-tour', prompt: script, count: 12, countMode: 'fixed', mediaMode: 'images',
      narrationSecondsPerCard: 15, tourOptions: options,
    } });
    assert.equal(result.cards.length, 9);
    assert.equal(result.generation.countPolicy, 'source-exact');
    assert.equal(result.generation.targetCount, 9);
    assert.deepEqual(result.cards.map(card => card.tour.guideScript), source.items.map(stop => stop.guideScript));
    assert.ok(result.cards.every(card => card.imageUrl && card.placeId && card.tour.lat !== null));
    assert.equal(result.cards[8].placeId, result.cards[0].placeId);
    assert.equal(result.board.tourMeta.routePolyline, Array.from({ length: 8 }, (_, i) => `leg-${i}`).join('|'));
    assert.equal(routes.length, 8);
    assert.equal(routes[7].destination.location.latLng.latitude, result.cards[0].tour.lat);
    assert.equal(result.cards[8].tour.legToNext, null);
    assert.equal(records.length, 1);
    assert.equal(records[0].generated_count, 9);
    assert.deepEqual(unexpected, []);
  } finally { mock.restoreAll(); }
});
