import sgMail, { type MailDataRequired } from '@sendgrid/mail';

function setting(name: string, fallback: string): string {
  const value = (process.env[name] || fallback).trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid email setting: ${name}`);
  return value;
}

/** Read at send time so all application mail uses the same configurable identity. */
export function applicationEmailIdentity() {
  return {
    from: { email: setting('EMAIL_FROM', 'info@livingwiki.com'), name: setting('EMAIL_FROM_NAME', 'LivingWiki') },
    replyTo: { email: setting('EMAIL_REPLY_TO', 'jimwalker@mindpalace.com'), name: setting('EMAIL_REPLY_TO_NAME', 'Jim Walker') },
  };
}

/** Keep the existing SendGrid transport; never propagate credential-bearing SDK errors. */
export async function sendApplicationEmail(message: Omit<MailDataRequired, 'from'>) {
  try {
    return await sgMail.send({ ...message, ...applicationEmailIdentity() } as MailDataRequired);
  } catch (cause) {
    const status = Number((cause as { code?: unknown } | null)?.code);
    const error = new Error('Application email could not be submitted to SendGrid.');
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      Object.assign(error, { code: status });
    }
    throw error;
  }
}
