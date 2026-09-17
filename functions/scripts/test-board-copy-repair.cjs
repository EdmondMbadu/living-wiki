const assert = require('node:assert/strict');
const {proposeBoardCopyRepair,reviewedBoardCopyPatch,scanStoredBoardCopy,boardCopyFingerprint} = require('../lib/board-copy-repair');
const board = {id:'example-board',team_id:'team',team_revision:3,published_revision:0,visibility:'private',cards:[
  {id:'bad',title:'Kitchen',notes:'Continue the property tour through kitchen, using only details visible in the source photographs.',subtitle:'White cabinetry',imageUrls:['one','two'],tags:['listing']},
  {id:'fragment',title:'Living',notes:'From here, the tour moves into the living room. Shown staged with.'},
  {id:'intro',title:'Welcome',notes:'My supplied introduction',tags:['agent-intro']},
  {id:'private',title:'Setup',notes:'Review and edit this generated card.',authorOnly:true},
  {id:'authored',title:'A handwritten note',notes:'Sentence fragment as intended'},
]};
assert.deepEqual(scanStoredBoardCopy(board).map(issue=>issue.cardId),['bad','fragment']);
const proposal = proposeBoardCopyRepair(board.id,'team_boards',board,[{cardId:'bad',narration:'White cabinetry lines the kitchen.'}]);
const patch = reviewedBoardCopyPatch(proposal,structuredClone(board));
assert.equal(patch.cards[0].id,'bad');
assert.deepEqual(patch.cards[0].imageUrls,['one','two']);
assert.equal(patch.cards[0].notes,'White cabinetry lines the kitchen.');
assert.equal(patch.cards[0].stackNarrationSource,patch.cards[0].notes);
assert.deepEqual(patch.cards.slice(1),board.cards.slice(1));
assert.equal(patch.visibility,undefined);
assert.equal(patch.socialLandscapeVideoRenderVersion,'');
assert.deepEqual(proposal.before,board);
assert.throws(()=>reviewedBoardCopyPatch(proposal,{...board,team_revision:4}),/changed after/);
assert.throws(()=>reviewedBoardCopyPatch(proposal,{...board,title:'Colleague changed title'}),/changed after/);
assert.throws(()=>proposeBoardCopyRepair(board.id,'team_boards',board,[{cardId:'intro',narration:'Rewritten introduction.'}]),/defective/);
assert.throws(()=>proposeBoardCopyRepair(board.id,'team_boards',board,[{cardId:'bad',narration:'Shown staged with.'}]),/finished/);
assert.equal(boardCopyFingerprint({a:1,b:2}),boardCopyFingerprint({b:2,a:1}));
console.log('Stored-board scan, protected copy, reviewed repair, and stale-revision checks passed.');
