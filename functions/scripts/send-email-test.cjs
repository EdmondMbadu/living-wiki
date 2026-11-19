// Operator-only backend smoke test. Load the key securely into this process;
// never put it in CLI arguments. No public test endpoint is exposed.
const sgMail = require('@sendgrid/mail');
const { sendApplicationEmail } = require('../lib/email-config');
const { renderEventEmail } = require('../lib/event-guide-email');

async function main() {
  const to = process.env.EMAIL_TEST_RECIPIENT?.trim();
  if (!to || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('Set a valid EMAIL_TEST_RECIPIENT.');
  if (!process.env.SENDGRID_API_KEY) throw new Error('Load SENDGRID_API_KEY securely into the backend process.');
  const mode = process.argv[2] || '--configuration';
  if (!['--configuration', '--amy-sample'].includes(mode)) throw new Error('Use --configuration or --amy-sample.');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  sgMail.setTimeout(20_000);
  const body = "Hello,\n\nThis is a test email confirming that LivingWiki's SendGrid integration has been configured successfully.\n\nYou can reply directly to this email to contact the LivingWiki team.\n\nBest regards,\nThe LivingWiki Team";
  const message = mode === '--configuration'
    ? { subject: 'LivingWiki — Email Configuration Test', text: body }
    : { ...renderEventEmail({ name: 'CES 2027', timeZone: 'America/Los_Angeles', informationUrl: '', privacyUrl: '' },
      { days: [{ date: '2027-01-05', attending: true, items: [{ start: 540, end: 580,
        title: 'Explore innovations at CES', location: 'Check your event schedule', kind: 'Session', url: '', note: 'Sample itinerary for email preview.' }], alternatives: [] }] },
      'en', null, [], '', text => text, { avatarName: 'Amy', returnUrl: process.env.EMAIL_TEST_AMY_URL || '' }),
      subject: 'LivingWiki — Amy recap sample' };
  const [response] = await sendApplicationEmail({ ...message, to,
    trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } } });
  console.log(JSON.stringify({ mode, status: response.statusCode, messageId: response.headers?.['x-message-id'] || null }));
}
main().catch(error => {
  // The shared transport removes raw provider errors, headers and credentials.
  console.error('Email test failed.', { status: error?.code || null });
  process.exitCode = 1;
});
