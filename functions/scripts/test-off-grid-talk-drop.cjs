const assert = require('node:assert/strict');
const { offGridTalkDrop } = require('../lib/off-grid-talk-drop');
const urlFor = (path, bucket='test.appspot.com') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=test`;
const clip = {url:urlFor('users/owner/boards/talk-drops/clip.mp4'),mimeType:'video/mp4',fileName:'My place.mp4'};
assert.equal(offGridTalkDrop(undefined,'owner','test.appspot.com'),null);
assert.equal(offGridTalkDrop(null,'owner','test.appspot.com'),null);
assert.deepEqual(offGridTalkDrop(clip,'owner','test.appspot.com'),clip);
for (const patch of [
  {url:urlFor('users/another/boards/talk-drops/clip.mp4')},
  {url:urlFor('users/owner/boards/talk-drops/clip.mp4','foreign.appspot.com')},
  {url:urlFor('users/owner/profile/picture.mp4')},
  {url:urlFor('users/owner/boards/talk-drops/../clip.mp4')},
  {url:'javascript:alert(1)'}, {url:clip.url.replace('googleapis.com','googleapis.com.evil.test')},
  {mimeType:'text/html'}, {url:clip.url.replace('?alt=media','?alt=json')},
]) assert.throws(() => offGridTalkDrop({...clip,...patch},'owner','test.appspot.com'), e => e.code === 'invalid-argument');
console.log('Off-grid Talk Drop validation passed (optional video, valid upload, ownership, bucket, path, URL and MIME checks).');
