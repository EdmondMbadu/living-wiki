import Stripe from 'stripe';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';

// Shared by every Stripe-backed feature (business claims, personal plans,
// memberships and TalkThru plans) so they use one client and one webhook secret.
export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

export const allowedCheckoutOrigins = new Set([
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:4201',
  'http://127.0.0.1:4201',
  'https://livingwiki.com',
  'https://www.livingwiki.com',
  'https://living-atlas-7622a.web.app',
  'https://living-atlas-7622a.firebaseapp.com',
]);

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  const secret = stripeSecretKey.value();
  if (!secret) {
    throw new HttpsError('failed-precondition', 'Stripe is not configured.');
  }
  stripeClient ??= new Stripe(secret);
  return stripeClient;
}

/** Test or live, from the configured key. */
export function stripeMode(): 'test' | 'live' {
  return /^(sk|rk)_live_/.test(stripeSecretKey.value() || '') ? 'live' : 'test';
}
