const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sgMail = require('@sendgrid/mail');
const { applicationEmailIdentity, sendApplicationEmail } = require('../lib/email-config');
const originalSend = sgMail.send;
const names = ['EMAIL_FROM', 'EMAIL_FROM_NAME', 'EMAIL_REPLY_TO', 'EMAIL_REPLY_TO_NAME'];
const originalEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
afterEach(() => {
  sgMail.send = originalSend;
  for (const name of names) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

test('every email uses LivingWiki and Jim, preserving content, attachments and preferences', async () => {
  for (const name of names) delete process.env[name];
  const message = { to: 'recipient@example.com', subject: 'Recap', text: 'Your plan', html: '<p>Your plan</p>',
    attachments: [{ filename: 'plan.ics', content: 'Y2FsZW5kYXI=' }],
    headers: { 'List-Unsubscribe': '<https://livingwiki.com/unsubscribe>' },
    trackingSettings: { clickTracking: { enable: false } } };
  sgMail.send = async payload => {
    assert.deepEqual(payload, { ...message, from: { email: 'info@livingwiki.com', name: 'LivingWiki' },
      replyTo: { email: 'jimwalker@mindpalace.com', name: 'Jim Walker' } });
    return [{ statusCode: 202, headers: { 'x-message-id': 'test' } }, {}];
  };
  assert.equal((await sendApplicationEmail(message))[0].statusCode, 202);
});

test('Reply-To and sender can change through environment settings without code changes', async () => {
  process.env.EMAIL_REPLY_TO = 'jim@livingwiki.com';
  process.env.EMAIL_REPLY_TO_NAME = 'LivingWiki Support';
  process.env.EMAIL_FROM = 'info@livingwiki.com';
  process.env.EMAIL_FROM_NAME = 'LivingWiki';
  sgMail.send = async payload => {
    assert.deepEqual(payload.replyTo, { email: 'jim@livingwiki.com', name: 'LivingWiki Support' });
    assert.equal(payload.from.email, 'info@livingwiki.com');
    return [{ statusCode: 202 }, {}];
  };
  await sendApplicationEmail({ to: 'recipient@example.com', text: 'Test' });
  process.env.EMAIL_REPLY_TO_NAME = 'Injected\r\nBcc: bad@example.com';
  assert.throws(applicationEmailIdentity, /Invalid email setting/);
});

test('provider errors expose only a safe status, preserving retry classification', async () => {
  for (const code of [400, 403, 429, 500, undefined]) {
    sgMail.send = async () => { throw { code, message: 'secret credential', response: { headers: { authorization: 'secret credential' } } }; };
    await assert.rejects(sendApplicationEmail({ to: 'recipient@example.com', text: 'Test' }), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /secret credential|authorization/);
      return true;
    });
  }
});

test('all application SendGrid sends pass through the centralized identity and safe error boundary', () => {
  const directory = path.join(__dirname, '../src');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    assert.doesNotMatch(source, /rocketgoals?\.(?:com|org)|missioncontrol@/i, file);
    if (file !== 'email-config.ts') assert.doesNotMatch(source, /sgMail\.send(?:Multiple)?\s*\(/, file);
  }
});
