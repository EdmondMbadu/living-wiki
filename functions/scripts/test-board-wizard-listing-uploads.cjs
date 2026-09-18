const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');
const sharp = require('sharp');
process.env.GCLOUD_PROJECT = 'demo-living-wiki';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-living-wiki', storageBucket: 'demo-living-wiki.appspot.com' });

// Exercise real image preparation and composition without cloud reads or AI charges.
const storageApi = require('firebase-admin/storage');
storageApi.getDownloadURL = async (file) => `https://storage.example/${file.name}`;
const firebase = require('../lib/firebase');
const gemini = require('../lib/gemini');
const {
  normalizeUploadedListingPhotos, assertListingPhotoTeamAccess, loadUploadedListingPhotos,
} = require('../lib/board-wizard-listing-uploads');
const {
  generateBoardWizardListingMarketingBatch, buildBoardWizardListingMarketingBatchFromAnalyses,
  normalizeBoardWizardListingMarketingOptions,
} = require('../lib/board-wizard-listing-marketing');
const { extractBoardWizardListing } = require('../lib/board-wizard-listing');
const { publicTeamBoard } = require('../lib/team-model');

const teamScope = { userId: 'member', teamId: 'team-a', draftId: 'draft-a' };
const personalScope = { userId: 'owner', teamId: '', draftId: 'draft-a' };
let files, cache, activeMember, downloads, classificationCalls, red, blue, lastStory;
before(async () => {
  red = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  blue = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#0000ff' } }).jpeg().toBuffer();
});
beforeEach(() => {
  files = new Map(); cache = new Map(); activeMember = true; downloads = []; classificationCalls = 0; lastStory = null;
  firebase.db.doc = (path) => ({ path });
  firebase.db.getAll = async (...refs) => refs.map((ref) => ({ data: () => ref.path
    ? { status: ref.path.includes('/members/') && !activeMember ? 'removed' : 'active' }
    : cache.get(ref.key) }));
  firebase.db.collection = (collection) => ({ doc: (key) => ({
    key: `${collection}/${key}`,
    get: async () => ({ data: () => cache.get(`${collection}/${key}`) }),
    set: async (value) => { cache.set(`${collection}/${key}`, value); },
  }) });
  firebase.storage.bucket = () => ({ file: (path) => ({
    name: path,
    getMetadata: async () => {
      const value = files.get(path);
      if (!value) throw new Error('Missing file');
      return [{ contentType: value.type || 'image/jpeg', size: value.bytes.length }];
    },
    download: async () => { downloads.push(path); return [files.get(path).bytes]; },
  }) });
  gemini.analyzeBoardWizardListingPhotos = async ({ photos }) => {
    classificationCalls++;
    return Promise.all(photos.map(async (photo) => {
      const { data } = await sharp(Buffer.from(photo.base64, 'base64')).raw().toBuffer({ resolveWithObject: true });
      const kitchen = data[0] > data[2];
      return { index: photo.index, sceneType: kitchen ? 'kitchen' : 'bedroom', roomType: kitchen ? 'Kitchen' : 'Bedroom',
        features: kitchen ? ['cabinetry'] : ['windows'], movableFurnishings: [], qualityScore: .9, heroScore: .8, confidence: .95 };
    }));
  };
  gemini.generateBoardWizardListingStory = async (params) => {
    lastStory = params;
    return []; // Verify the factual fallback, including complete narration and room/image binding.
  };
});

function teamPhoto(id, bytes = red) {
  const storagePath = `team-media/team-a/draft-a/${id}.jpg`;
  files.set(storagePath, { bytes });
  return { id, storagePath };
}
function extraction(images, preferredCoverUrl) {
  const url = 'https://www.zillow.com/homedetails/10-Example-St/123_zpid/';
  const listing = extractBoardWizardListing(url, url, `<script type="application/ld+json">${JSON.stringify({
    '@type': 'RealEstateListing', name: '10 Example St', address: '10 Example St',
    offers: { price: 314900, priceCurrency: 'USD' }, numberOfBedrooms: 3, numberOfBathroomsTotal: 2,
    image: ['https://publisher.example/scraped-exterior.jpg'],
  })}</script>`);
  assert.ok(listing);
  return { ...listing, images, photoSource: 'upload', preferredCoverUrl: preferredCoverUrl || images[0]?.url };
}
function generation(listing) {
  return { extraction: listing, targetBoardTitle: '', count: 10, narrationStyle: 'storyteller', narrationSecondsPerCard: 30,
    marketing: normalizeBoardWizardListingMarketingOptions({ personalized: true, propertyType: 'Townhouse',
      contactName: 'Listing Agent', contactEmail: 'agent@example.com' }), listingIntent: 'sale' };
}

test('rejects cross-user, cross-team, cross-draft, duplicate, and malformed storage references', () => {
  const valid = { id: 'photo-1', storagePath: 'team-media/team-a/draft-a/photo.jpg' };
  assert.deepEqual(normalizeUploadedListingPhotos([valid], teamScope), [valid]);
  for (const path of [
    'team-media/team-b/draft-a/photo.jpg', 'team-media/team-a/draft-b/photo.jpg',
    'team-media/team-a/draft-a/../private.jpg', 'team-media/team-a/draft-a/', 'https://example.com/photo.jpg',
  ]) assert.throws(() => normalizeUploadedListingPhotos([{ ...valid, storagePath: path }], teamScope));
  assert.throws(() => normalizeUploadedListingPhotos([valid, valid], teamScope));
  assert.throws(() => normalizeUploadedListingPhotos([], teamScope));
  assert.throws(() => normalizeUploadedListingPhotos(Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, storagePath: `${valid.storagePath}${i}` })), teamScope));
  assert.throws(() => normalizeUploadedListingPhotos([{ id: 'p', storagePath: 'users/other/boards/draft-a/listing-photos/p.jpg' }], personalScope));
});

test('requires active membership and team status', () => {
  assert.doesNotThrow(() => assertListingPhotoTeamAccess({ status: 'active' }, { status: 'active' }));
  for (const [team, member] of [[{}, {}], [{ status: 'archived' }, { status: 'active' }], [{ status: 'active' }, { status: 'removed' }]])
    assert.throws(() => assertListingPhotoTeamAccess(team, member), { code: 'permission-denied' });
});

test('reads and resizes private team images without issuing public download URLs', async () => {
  const photos = [teamPhoto('kitchen', red), teamPhoto('bedroom', blue)];
  const loaded = await loadUploadedListingPhotos(photos, teamScope);
  assert.deepEqual(loaded.images.map((image) => image.url), photos.map((photo) => `team-media:${photo.storagePath}`));
  assert.ok(loaded.images.every((image) => image.evidence === 'user-upload'));
  assert.notEqual(loaded.preparedPhotos[0].contentHash, loaded.preparedPhotos[1].contentHash);
  assert.equal(loaded.preparedPhotos[0].cacheScope, 'team:team-a');
  const metadata = await sharp(Buffer.from(loaded.preparedPhotos[0].base64, 'base64')).metadata();
  assert.equal(metadata.format, 'jpeg');
  activeMember = false;
  const count = downloads.length;
  await assert.rejects(loadUploadedListingPhotos(photos, teamScope), { code: 'permission-denied' });
  assert.equal(downloads.length, count, 'revocation must be checked before a read or cache hit');
});

test('reads only the owner’s personal upload path and keeps its display URL', async () => {
  const photo = { id: 'p', storagePath: 'users/owner/boards/draft-a/listing-photos/p.jpg' };
  files.set(photo.storagePath, { bytes: red });
  const loaded = await loadUploadedListingPhotos([photo], personalScope);
  assert.match(loaded.images[0].url, /^https:\/\/storage\.example\/users\/owner\//);
  assert.equal(loaded.preparedPhotos[0].cacheScope, 'user:owner');
});

test('rejects missing, corrupt, or unsupported files instead of using scraped photos', async () => {
  const missing = { id: 'missing', storagePath: 'team-media/team-a/draft-a/missing.jpg' };
  await assert.rejects(loadUploadedListingPhotos([missing], teamScope), { code: 'failed-precondition' });
  const corrupt = teamPhoto('corrupt', Buffer.from('not an image'));
  await assert.rejects(loadUploadedListingPhotos([corrupt], teamScope), { code: 'failed-precondition' });
  const svg = teamPhoto('svg'); files.get(svg.storagePath).type = 'image/svg+xml';
  await assert.rejects(loadUploadedListingPhotos([svg], teamScope), { code: 'failed-precondition' });
});

test('binds narration to uploaded room photos, preserves facts and cover, and remaps cached analysis after reordering', async () => {
  const photos = [teamPhoto('kitchen', red), teamPhoto('bedroom', blue)];
  const loaded = await loadUploadedListingPhotos(photos, teamScope);
  const first = await generateBoardWizardListingMarketingBatch({ ...generation(extraction(loaded.images, loaded.images[1].url)), preparedPhotos: loaded.preparedPhotos });
  const kitchen = first.cards.find((card) => card.title === 'Kitchen');
  const bedrooms = first.cards.find((card) => card.title === 'Bedrooms');
  const overview = first.cards.find((card) => card.tags.includes('group-overview'));
  assert.equal(kitchen.imageUrl, loaded.images[0].url);
  assert.equal(bedrooms.imageUrl, loaded.images[1].url);
  assert.match(kitchen.notes, /cabinetry/i);
  assert.match(bedrooms.notes, /windows/i);
  assert.equal(overview.imageUrl, loaded.images[1].url, 'the user’s cover choice must override AI hero scoring');
  assert.match(overview.notes, /3 bedrooms and 2 bathrooms/);
  assert.equal(lastStory.facts.bedrooms, '3');
  assert.equal(lastStory.facts.bathrooms, '2');
  assert.ok(first.cards.every((card) => card.imageSource === 'user-upload'));
  assert.ok(first.cards.every((card) => !card.imageUrl.includes('publisher.example')));
  assert.ok(first.cards.every((card) => /[.!?]$/.test(card.notes)));
  const secondLoaded = await loadUploadedListingPhotos([...photos].reverse(), teamScope);
  const second = await generateBoardWizardListingMarketingBatch({ ...generation(extraction(secondLoaded.images)), preparedPhotos: secondLoaded.preparedPhotos });
  assert.equal(classificationCalls, 1, 'content analysis should be reused without reusing old indices');
  assert.equal(second.cards.find((card) => card.title === 'Kitchen').imageUrl, loaded.images[0].url);
  assert.equal(second.cards.find((card) => card.title === 'Bedrooms').imageUrl, loaded.images[1].url);
  assert.ok([...cache.values()].filter((value) => value.version?.startsWith('listing-photo')).every((value) => value.source_url === ''));
});

test('rejects conflicting AI room counts and mismatched room photos while retaining grounded AI copy', async () => {
  const loaded = await loadUploadedListingPhotos([teamPhoto('kitchen', red), teamPhoto('bedroom', blue)], teamScope);
  gemini.generateBoardWizardListingStory = async () => [
    { cardKey: 'overview', role: 'overview', photoIndex: 0, title: 'Property Overview', subtitle: '',
      narration: 'This home has 2 bedrooms.', factKeys: ['bedrooms'] },
    { cardKey: 'kitchen', role: 'kitchen', photoIndex: 1, title: 'Kitchen', subtitle: '',
      narration: 'The kitchen has a panoramic view.', factKeys: [] },
    { cardKey: 'bedrooms', role: 'bedroom', photoIndex: 1, title: 'Bedrooms', subtitle: '',
      narration: 'This bedroom has visible windows.', factKeys: [] },
  ];
  const batch = await generateBoardWizardListingMarketingBatch({ ...generation(extraction(loaded.images)), preparedPhotos: loaded.preparedPhotos });
  assert.match(batch.cards.find((card) => card.tags.includes('group-overview')).notes, /3 bedrooms and 2 bathrooms/);
  const kitchen = batch.cards.find((card) => card.title === 'Kitchen');
  assert.equal(kitchen.imageUrl, loaded.images[0].url);
  assert.match(kitchen.notes, /cabinetry/i);
  assert.doesNotMatch(kitchen.notes, /panoramic/);
  assert.equal(batch.cards.find((card) => card.title === 'Bedrooms').notes, 'This bedroom has visible windows.');
});

test('keeps all 24 photos and their provenance in grouped and public listing galleries', () => {
  const images = Array.from({ length: 24 }, (_, i) => ({ url: `team-media:team-media/team-a/draft-a/p${i}.jpg`, alt: `Photo ${i}`, evidence: 'user-upload' }));
  const analyses = images.map((_, index) => ({ index, sceneType: 'bedroom', roomType: 'Bedroom', features: ['windows'],
    movableFurnishings: [], qualityScore: .9, heroScore: .8, confidence: .95 }));
  const batch = buildBoardWizardListingMarketingBatchFromAnalyses({ ...generation(extraction(images)), style: 'warm', analyses });
  assert.equal(batch.cards.find((card) => card.tags.includes('group-overview')).imageUrls.length, 24);
  assert.equal(batch.cards.find((card) => card.title === 'Bedrooms').imageUrls.length, 24);
  const publicBoard = publicTeamBoard({ ...batch.board, cards: batch.cards }, 'team-a', { name: 'Team' }, new Date().toISOString());
  const publicOverview = publicBoard.cards.find((card) => card.tags.includes('group-overview'));
  assert.equal(publicOverview.imageSource, 'user-upload');
  assert.equal(publicOverview.imageUrls.length, 24);
});

test('uncertain uploads remain neutral even when filenames claim a specific room', () => {
  const images = [{ url: 'team-media:team-media/team-a/draft-a/kitchen-bedroom-luxury.jpg', alt: 'Luxury kitchen', evidence: 'user-upload' }];
  const batch = buildBoardWizardListingMarketingBatchFromAnalyses({ ...generation(extraction(images)), style: 'warm', analyses: [] });
  assert.equal(batch.cards.some((card) => ['Kitchen', 'Bedrooms'].includes(card.title)), false);
  const additional = batch.cards.find((card) => card.title === 'Additional Photos');
  assert.equal(additional.listingPresentation.reviewStatus, 'needs-review');
  assert.equal(additional.imageUrl, images[0].url);
});
