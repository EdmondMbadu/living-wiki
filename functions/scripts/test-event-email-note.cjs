const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse}=require('parse5');
const {readFileSync}=require('node:fs');
const {renderEventEmail}=require('../lib/event-guide-email');
const {eventGuideConversationUrl}=require('../lib/event-guide-links');
const {prepareRecapEmailCopy}=require('../lib/recap-email-localization');
const settings={name:'CES 2027',timeZone:'America/Los_Angeles',informationUrl:'https://example.org/event',privacyUrl:'https://example.org/privacy',emailDesign:{theme:'spotlight',bannerUrl:'https://example.org/banner.jpg'}};
const plan={days:[{date:'2027-01-05',attending:true,items:[{start:540,end:580,title:'Robotics demo',location:'Hall A',kind:'Session',url:'https://example.org/session',note:''}],alternatives:[]}]};
const identity={avatarName:'Amy',returnUrl:eventGuideConversationUrl('ces-show','card-123','en')};
const render=(event=settings,itinerary=plan,sponsor=null,guide=identity)=>renderEventEmail(event,itinerary,'en',sponsor,[],'https://livingwiki.com/event-itinerary#id.key',x=>x,guide);

test('the approved welcome precedes the plan and adapts to the current event, guide, sponsor and plan state',()=>{
 const sponsor={name:'Nexora',message:'This conversation has been brought to you by Nexora.'};
 const email=render(settings,plan,sponsor);
 assert.ok(email.html.indexOf('Hi - I really enjoyed speaking with you!')<email.html.indexOf('Your itinerary'));
 assert.ok(email.html.indexOf('Below is your personalized plan.')<email.html.indexOf('Robotics demo'));
 for(const text of [email.html,email.text]){
  assert.match(text,/A note from Amy|Cheers,/);assert.match(text,/Nexora/);assert.match(text,/Talk to Amy again/);
  assert.match(text,/CES 2027 is an unmatched venue/);
 }
 const other=render({...settings,name:'Garden Expo',emailDesign:undefined},null,null,{...identity,avatarName:'Jordan'});
 assert.match(other.html,/Garden Expo brings people, ideas and new experiences together/);
 assert.match(other.html,/A note from Jordan/);assert.match(other.html,/Talk to Jordan again/);
 assert.match(other.html,/Below are your event details/);
 assert.doesNotMatch(other.html,/Amy|Nexora|CES|Below is your personalized plan/);
});

test('names and sponsor copy remain literal, unsafe links are rejected, and no transcript appears',()=>{
 const email=render(settings,plan,{name:'<Sponsor>',message:'<img src=x onerror="bad">'}, {avatarName:'<Amy & Co>',returnUrl:'javascript:alert(1)'});
 assert.match(email.html,/&lt;Amy &amp; Co&gt;/);assert.match(email.html,/&lt;Sponsor&gt;/);
 assert.doesNotMatch(email.html,/<img src=x|href="javascript:/);
 assert.doesNotMatch(email.text,/javascript:/);
 const noGuide=render(settings,null,null,{});
 assert.match(noGuide.html,/A note from your guide/);assert.doesNotMatch(noGuide.html,/Talk to Amy/);
});

test('return links reopen the same card in the selected language without private itinerary keys or email',()=>{
 for(const language of ['en','fr','ja','pt','es','de','zh','it','ko','ar','hi','ru']){
  const url=new URL(eventGuideConversationUrl('custom-event-slug','event-card',language));
  assert.equal(url.origin,'https://livingwiki.com');
  assert.equal(url.pathname,(language==='en'?'':`/${language}`)+'/boards/custom-event-slug');
  assert.equal(url.searchParams.get('voiceCard'),'event-card');
  assert.equal(url.searchParams.get('lang'),language);assert.equal(url.searchParams.get('contentLang'),language);
  assert.equal(url.hash,'');assert.equal(url.searchParams.size,3);
 }
 assert.equal(eventGuideConversationUrl('../bad','card','en'),'');
 assert.equal(eventGuideConversationUrl('board','<card>','en'),'');
});

test('the footer uses an email-safe official logo and the entire logo links to LivingWiki',()=>{
 const email=render();const doc=parse(email.html);const imgs=[];
 const visit=node=>{if(node.nodeName==='img')imgs.push(node);for(const child of node.childNodes||[])visit(child);};visit(doc);
 const logo=imgs.at(-1);const attr=(node,key)=>node.attrs.find(a=>a.name===key)?.value;
 assert.match(attr(logo,'src'),/livingwiki-email-logo\.png$/);
 assert.equal(attr(logo,'alt'),'LivingWiki');assert.equal(logo.parentNode.nodeName,'a');assert.equal(attr(logo.parentNode,'href'),'https://livingwiki.com');
 const png=readFileSync(require.resolve('../../public/assets/image/livingwiki-email-logo.png'));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});

test('new note and return-button copy are localized with placeholders preserved before inserting names',async()=>{
 const url=eventGuideConversationUrl('show','card','fr');const guide={avatarName:'Sofia',returnUrl:url};
 const output=copy=>renderEventEmail(settings,plan,'fr',null,[],'',copy,guide);
 const copy=await prepareRecapEmailCopy('fr',output,async source=>source.map(s=>({...s,text:s.text==='A note from {avatar}'?'Un mot de {avatar}':s.text==='Talk to {avatar} again'?'Reparler à {avatar}':s.text})));
 const email=output(copy);assert.match(email.html,/Un mot de Sofia/);assert.match(email.html,/Reparler à Sofia/);assert.match(email.text,/Reparler à Sofia/);
 assert.doesNotMatch(email.html,/\{avatar\}|\{event\}/);
});
