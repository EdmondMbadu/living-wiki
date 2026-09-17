// Opt-in live smoke test. Uses synthetic evidence; never reads or writes boards.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { analyses, extraction } = require('./fixtures/listing-copy.cjs');
const { buildListingCopyPlan } = require('../lib/board-wizard-copy-plan');
const { buildBoardWizardListingMarketingBatchFromAnalyses: compose } = require('../lib/board-wizard-listing-marketing');
const { generateBoardWizardListingStory, shortenStackScriptNarrations, repairBoardWizardCopy } = require('../lib/gemini');
const { inspectBoardWizardCopy, finalizeBoardWizardCopy } = require('../lib/board-wizard-copy-quality');
const { preservesNarrationQualifications, isFinishedNarration } = require('../lib/narration-text');

async function main() {
  if (!process.argv.includes('--live') || !process.env.GEMINI_API_KEY) {
    throw new Error('This opt-in check requires --live and GEMINI_API_KEY in the environment. It makes paid model requests using synthetic data only.');
  }
  const started = performance.now();
  const plan = buildListingCopyPlan(analyses, 10);
  const scenes = await generateBoardWizardListingStory({
    listingName:extraction.listingName,address:extraction.address,
    facts:{address:extraction.address,price:extraction.price,bedrooms:'3',bathrooms:'2',property_type:'Condo'},
    photos:analyses,sceneCount:10,cardPlan:plan,narrationStyle:'storyteller',
    narrationSecondsPerCard:5,marketingStyle:'Warm, precise and specific.',direction:'',listingIntent:'sale',furnishingsIncluded:false,
  });
  assert.equal(scenes.length, plan.length, 'The live writer must return every planned card');
  const batch = compose({extraction,targetBoardTitle:'',count:10,narrationSecondsPerCard:5,style:'warm',listingIntent:'sale',analyses,aiScenes:scenes});
  assert.deepEqual(inspectBoardWizardCopy(batch), []);
  const qualified = 'The living room is shown staged. Furniture is not included. The sale is subject to approval.';
  const shortened = await shortenStackScriptNarrations({targetSentences:1,cards:[
    {cardId:'qualified',title:'Living room',narration:qualified,sourceNarration:qualified},
    {cardId:'plain',title:'Kitchen',narration:'White cabinetry lines the kitchen. A window overlooks the garden.'},
  ]});
  assert.equal(shortened.length,2);
  assert.ok(shortened.every(card => isFinishedNarration(card.narration)));
  assert.ok(preservesNarrationQualifications(shortened[0].narration,qualified));
  const broken = {...batch,cards:[{...batch.cards[0],title:'Museum',subtitle:'Shipbuilding exhibit and navigation display',notes:'Review and edit this generated card before sharing the board.',short_summary:''}]};
  const repaired = await finalizeBoardWizardCopy(broken,async (batch, issues) => {
    const repairs = await repairBoardWizardCopy(batch,issues);
    console.log(JSON.stringify({repairCandidates:repairs}));
    return repairs;
  });
  assert.deepEqual(inspectBoardWizardCopy(repaired),[]);
  console.log(JSON.stringify({promptVersion:'listing-story-v3-group-copy',planned:plan.length,returned:scenes.length,
    keptWriterNarrations:batch.cards.filter(card=>scenes.some(scene=>scene.narration===card.notes)).length,
    elapsedSeconds:Math.round((performance.now()-started)/1000),cards:batch.cards.map(card=>({title:card.title,notes:card.notes})),shortened,
    generalRepair:repaired.cards[0].notes},null,2));
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
