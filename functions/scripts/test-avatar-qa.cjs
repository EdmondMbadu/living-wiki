const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeQaReferences, gradeQaTurn, qaTotals } = require('../lib/avatar-qa-model');
const reference = { id: 'AMD-001', question: 'What is this?', expectedAnswer: 'Original response.', category: 'education', source: 'Source v1', approval: 'draft' };
test('answer-key contract rejects invalid IDs, duplicates, categories, empty sources and oversized suites', () => {
  for (const entries of [[{...reference,id:'../bad'}], [reference,reference], [{...reference,category:'other'}], [{...reference,source:''}], Array(101).fill(reference)]) assert.throws(() => normalizeQaReferences(entries));
});
test('documented approval requires a real calendar date and approver', () => {
  assert.throws(() => normalizeQaReferences([{...reference,approval:'approved'}]));
  assert.throws(() => normalizeQaReferences([{...reference,approval:'approved',approvedBy:'Reviewer',approvedOn:'2026-02-30'}]));
  assert.equal(normalizeQaReferences([{...reference,approval:'approved',approvedBy:'Reviewer',approvedOn:'2026-10-15'}])[0].approvedBy,'Reviewer');
});
test('follow-up scenarios cannot exceed the visitor path limit', () => {
  assert.equal(normalizeQaReferences([{...reference,followUps:Array(4).fill({question:'Follow up',expectedAnswer:'Reference'})}])[0].followUps.length,4);
  assert.throws(() => normalizeQaReferences([{...reference,followUps:Array(5).fill({question:'Follow up',expectedAnswer:'Reference'})}]));
});
test('strict wording preserves inner whitespace and does not accept an appended invitation', () => {
  assert.equal(gradeQaTurn(' \nOriginal response.\n','Original response.','education','wiki').status,'passed');
  assert.equal(gradeQaTurn('Original response. Want more?','Original response.','education','wiki').status,'failed');
  assert.equal(gradeQaTurn('Original  response.','Original response.','education','wiki').status,'failed');
});
test('even identical internet output fails reference-only checks', () => {
  const result = gradeQaTurn('Original response.','Original response.','urgent','internet');
  assert.equal(result.status,'failed'); assert.equal(result.critical,true);
  assert.equal(gradeQaTurn('Different','Reference','education','wiki').critical,false);
});
test('errors and cancellations do not inflate pass totals', () => {
  assert.deepEqual(qaTotals([{status:'passed'},{status:'failed',critical:true},{status:'error'},{status:'cancelled'}]), {completed:4,passed:1,failed:1,errors:1,cancelled:1,critical:1});
});
