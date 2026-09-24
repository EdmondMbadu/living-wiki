import { readFileSync } from 'node:fs';
import { Conversation } from '@elevenlabs/client';

const apiKey = readFileSync(0, 'utf8').trim();
const agentId = process.env.KIWI_AGENT_ID;
if (!apiKey || !agentId) throw new Error('Provide the ElevenLabs key on stdin and KIWI_AGENT_ID in the environment.');
const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?${new URLSearchParams({ agent_id: agentId, environment: 'production' })}`, {
  headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(12000),
});
if (!response.ok) throw new Error(`Could not issue a Kiwi session: ${response.status}`);
const { signed_url: signedUrl } = await response.json();
if (typeof signedUrl !== 'string') throw new Error('No signed URL returned.');
let sawTool = false;
let sawAgent = false;
let sentAt = 0;
let resolveDone;
const done = new Promise((resolve) => { resolveDone = resolve; });
const conversation = await Conversation.startSession({
  signedUrl, connectionType: 'websocket', textOnly: true,
  dynamicVariables: { assistant_name: 'Kiwi' },
  clientTools: {
    kiwi_request: ({ request }) => {
      sawTool = typeof request === 'string' && /board/i.test(request);
      console.log('kiwi_request received:', sawTool, 'after', Date.now() - sentAt, 'ms');
      resolveDone();
      return 'The board proposal is being prepared on screen.';
    },
    kiwi_apply: () => { throw new Error('Kiwi must not save without approval.'); },
  },
  onMessage: ({ role, message }) => {
    if (role === 'agent' && String(message).trim()) {
      sawAgent = true;
      console.log('Agent response after', Date.now() - sentAt, 'ms:', String(message).slice(0, 250));
    }
  },
  onConnect: ({ conversationId }) => console.log('Connected:', conversationId),
  onStatusChange: ({ status }) => console.log('Status:', status),
  onModeChange: ({ mode }) => console.log('Mode:', mode),
  onDisconnect: (details) => console.log('Disconnected:', JSON.stringify(details).slice(0, 250)),
  onError: (error) => console.error('Agent error:', String(error).slice(0, 200)),
});
console.log('Sending test message.');
sentAt = Date.now();
conversation.sendUserMessage('Please make a private board about my favorite walking routes.');
let timeout;
try {
  await Promise.race([done, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Kiwi did not call kiwi_request within 20 seconds.')), 20000);
  })]);
} finally { clearTimeout(timeout); }
await new Promise((resolve) => setTimeout(resolve, 1200));
await conversation.endSession();
if (!sawTool || !sawAgent) throw new Error(`Incomplete response: tool=${sawTool}, agent=${sawAgent}`);
console.log('Kiwi voice agent smoke test passed.');
