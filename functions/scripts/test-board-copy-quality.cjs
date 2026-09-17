const assert = require('node:assert/strict');
const { buildBoardWizardListingMarketingBatchFromAnalyses: compose } = require('../lib/board-wizard-listing-marketing');
const { buildListingCopyPlan, normalizeListingStoryRole } = require('../lib/board-wizard-copy-plan');
const { inspectBoardWizardCopy, applyBoardCopyRepairs, finalizeBoardWizardCopy } = require('../lib/board-wizard-copy-quality');
const { containsEditorCopy, hasDanglingNarration, isFinishedNarration } = require('../lib/narration-text');
const { analyses, extraction } = require('./fixtures/listing-copy.cjs');

for (const [input, expected] of Object.entries({visual_hook:'hook', living_room:'living', outdoor_space:'outdoor', dining_area:'dining', call_to_action:'action'})) {
  assert.equal(normalizeListingStoryRole(input), expected);
}
assert.equal(normalizeListingStoryRole('neighborhood-detour'), null);
const plan = buildListingCopyPlan(analyses, 4);
assert.equal(new Set(plan.map(p => p.cardKey)).size, plan.length);
assert.ok(plan.some(p => p.cardKey === 'kitchen'));
assert.ok(plan.every(p => p.photoIndices.length <= (p.cardKey === 'overview' ? 3 : 4)));
const base = { extraction, targetBoardTitle: '', analyses, style: 'warm', listingIntent: 'sale' };
let checked = 0;
for (const count of [1, 2, 4, 6, 10, 24]) for (const seconds of [5, 10, 15, 30, 180]) {
  const batch = compose({ ...base, count, narrationSecondsPerCard: seconds });
  const publicCards = batch.cards.filter(c => !c.authorOnly);
  assert.deepEqual(inspectBoardWizardCopy(batch), [], `${count} cards / ${seconds}s should have finished public copy`);
  assert.equal(new Set(publicCards.map(c => c.notes)).size, publicCards.length, 'overview, rooms and CTA must be distinct');
  assert.equal(batch.cards[0].imageUrls.length, 42);
  assert.ok(publicCards.every(c => isFinishedNarration(c.notes) && !containsEditorCopy(c.notes) && !hasDanglingNarration(c.notes)));
  if (count > 1) assert.ok(publicCards.some(c => c.listingPresentation?.groupKey === 'outdoor'));
  checked++;
}

const living = analyses.find(p => p.sceneType === 'living');
const good = { photoIndex: living.index, role: 'living_room', title: 'Living Area', subtitle: 'Hardwood floors and vaulted ceiling',
  narration: 'Hardwood flooring and a vaulted ceiling define the living area.', durationSeconds: 5, factKeys: [] };
const batchWithAlias = compose({ ...base, count: 10, narrationSecondsPerCard: 15, aiScenes: [good] });
assert.equal(batchWithAlias.cards.find(c => c.listingPresentation?.groupKey === 'living').notes, good.narration);
assert.notEqual(batchWithAlias.cards[0].notes, good.narration);
for (const narration of ['Shown staged with.', 'The living area features a.', 'Continue the property tour through living areas, using only details visible in the source photographs.']) {
  const result = compose({ ...base, count: 4, narrationSecondsPerCard: 5, aiScenes: [{ ...good, narration }] });
  assert.ok(result.cards.every(c => !containsEditorCopy(c.notes) && !hasDanglingNarration(c.notes)));
}
const outside = analyses.find(p => p.sceneType === 'outdoor');
const mismatched = compose({ ...base, count: 10, narrationSecondsPerCard: 30, aiScenes: [{ ...good, cardKey: 'kitchen', role: 'kitchen', photoIndex: outside.index }] });
assert.notEqual(mismatched.cards.find(c => c.listingPresentation?.groupKey === 'kitchen').notes, good.narration);
// A fifth photo's unique feature is not eligible for the four-image presentation.
const wrongPhoto = { ...good, photoIndex: living.index + 6, narration: 'A fireplace anchors the living area.' };
const wrongPhotoBatch = compose({ ...base, count: 10, narrationSecondsPerCard: 30, aiScenes: [wrongPhoto] });
assert.ok(!wrongPhotoBatch.cards.some(c => /fireplace/i.test(c.notes)));
const baseBatch = compose({ ...base, count: 4, narrationSecondsPerCard: 15 });
for (const narration of ['Every bedroom has a closet.', 'The home has three bathrooms.']) {
  const result = compose({...base,count:10,narrationSecondsPerCard:15,aiScenes:[{...good,narration}]});
  assert.ok(!result.cards.some(card=>card.notes===narration), 'room coverage and unit-specific counts must not be invented');
}
const broken = { ...baseBatch, cards: baseBatch.cards.map((c, i) => i === 1 ? { ...c, notes: 'Review and edit this generated card before sharing the board.' } : c) };
const issues = inspectBoardWizardCopy(broken);
assert.equal(issues.length, 1);
const repair = { cardIndex: 1, title: broken.cards[1].title, subtitle: broken.cards[1].subtitle, notes: 'The exterior features siding and white railings.', short_summary: 'Siding and white railings frame the exterior.' };
const fixed = applyBoardCopyRepairs(broken, issues, [repair]);
assert.deepEqual(inspectBoardWizardCopy(fixed), []);
assert.deepEqual(fixed.cards[1].imageUrls, broken.cards[1].imageUrls);
assert.equal(applyBoardCopyRepairs(broken, issues, [repair,repair]).cards[1].notes, broken.cards[1].notes);
const authoritative = { ...broken, cards: [{ ...broken.cards[1], tags: ['source-item'] }] };
assert.deepEqual(inspectBoardWizardCopy(authoritative), [], 'explicit source text remains authoritative');
assert.deepEqual(inspectBoardWizardCopy({ ...broken, cards: [{ ...broken.cards[1], authorOnly: true }] }), []);
assert.equal(containsEditorCopy('Continue along the marked trail, then turn left.'), false);
assert.equal(containsEditorCopy('Review the terms before booking.'), false);
(async () => {
  let repairs = 0;
  assert.equal(await finalizeBoardWizardCopy(baseBatch, async () => { repairs++; return []; }), baseBatch);
  assert.equal(repairs, 0);
  await assert.rejects(finalizeBoardWizardCopy(broken, async () => []), /narration could not be completed/);
  assert.deepEqual(inspectBoardWizardCopy(await finalizeBoardWizardCopy(broken, async () => [repair])), []);
  console.log(`Board copy quality checks passed (${checked} listing count/duration scenarios plus incident and repair regressions).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
