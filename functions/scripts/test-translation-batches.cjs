const assert = require('node:assert/strict');
const {test} = require('node:test');
const {translationBatches, translateInBatches} = require('../lib/translation-batches');

test('isolates the heading, deduplicates repeated narration and bounds request sizes', () => {
  const source = [{key:'board.title',text:'Museum'}, ...Array.from({length:30},(_,i)=>({key:`cardsById.c${i}.notes`,text:`${i}: ${'text '.repeat(200)}`})),
    {key:'cardsById.c0.stackNarration',text:`0: ${'text '.repeat(200)}`}];
  const plan = translationBatches(source);
  assert.deepEqual(plan.batches[0],[source[0]]);
  assert.equal(plan.batches.flat().length,source.length-1);
  for(const batch of plan.batches) assert.ok(batch.length<=12 && batch.reduce((n,s)=>n+s.text.length,0)<=2000);
});

test('delivers validated heading text before slow card work and preserves original ordering', async () => {
  const source = [{key:'board.title',text:'Museum'}, {key:'cardsById.one.notes',text:'Story'}, {key:'cardsById.one.stackNarration',text:'Story'}];
  let finish; const delivered=[];
  const pending = translateInBatches(source, group => group[0].key==='board.title'
    ? Promise.resolve(group.map(s=>({...s,text:`fr: ${s.text}`})))
    : new Promise(resolve=>{finish=()=>resolve(group.map(s=>({...s,text:`fr: ${s.text}`})));}), batch=>{delivered.push(...batch);});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(delivered.map(s=>s.key),['board.title']);
  finish(); const result=await pending;
  assert.deepEqual(result.map(s=>s.key),source.map(s=>s.key));
  assert.equal(result[1].text,result[2].text);
});

test('never streams a batch that omitted an expected field', async () => {
  const streamed=[];
  await assert.rejects(translateInBatches([{key:'board.description',text:'Story'}],async()=>[],batch=>{streamed.push(batch);}),/omitted/);
  assert.equal(streamed.length,0);
});

test('does not launch unbounded provider requests on a large board', async () => {
  const source=Array.from({length:20},(_,i)=>({key:`cardsById.c${i}.notes`,text:`${i}${'x'.repeat(1800)}`}));
  let active=0; let maximum=0;
  await translateInBatches(source,async group=>{maximum=Math.max(maximum,++active);await new Promise(resolve=>setImmediate(resolve));active--;return group;});
  assert.equal(maximum,3);
});
