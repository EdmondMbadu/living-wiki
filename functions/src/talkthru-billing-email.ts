import type Stripe from 'stripe';
import sgMail from '@sendgrid/mail';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { db } from './firebase';
import {
  TALKTHRU_PLAN_CATALOG,
  individualPlanCents,
  normalizeTalkThruPlan,
  parseTalkThruLookupKey,
  teamSeatTotalCents,
  type TalkThruBillingCycle,
  type TalkThruPlanKey,
} from './talkthru-plans';

// Our own billing emails, so the "we'll remind you before your first charge"
// promise does not depend on a Stripe dashboard setting.
export const talkThruSendgridApiKey = defineSecret('SENDGRID_API_KEY');
const senderEmail = 'missioncontrol@rocketgoals.com';
const appUrl = 'https://livingwiki.com';
const sentCollection = db.collection('talkthru_billing_emails');

export interface BillingEmailContent { subject: string; text: string; html: string }

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#f4f8f4;color:#183227;font-family:Arial,sans-serif"><main style="max-width:580px;margin:auto;padding:32px;background:white;border:1px solid #dce9df;border-radius:16px"><p style="margin:0 0 20px;color:#1b332b;font-size:22px;font-weight:800">LivingWiki TalkThrus</p><h1 style="margin:0 0 20px;font-size:25px;line-height:1.25">${escapeHtml(title)}</h1>${body}<p style="margin:28px 0 0;color:#63756a;font-size:12px">You’re receiving this because you have a TalkThru plan on LivingWiki.</p></main></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 20px;border-radius:6px;background:#1b332b;color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function usd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars.toLocaleString('en-US')}` : `$${dollars.toFixed(2)}`;
}

export function talkThruPlanName(plan: TalkThruPlanKey): string {
  return TALKTHRU_PLAN_CATALOG[plan].label;
}

/** “$39/month” or, for teams, “$75/month for 3 agents”. */
export function talkThruPriceLabel(plan: TalkThruPlanKey, cycle: TalkThruBillingCycle, seats = 1): string {
  const cents = plan === 'team' ? teamSeatTotalCents(seats, cycle) : individualPlanCents(plan, cycle);
  const period = cycle === 'annual' ? 'year' : 'month';
  return plan === 'team' ? `${usd(cents)}/${period} for ${seats} agents` : `${usd(cents)}/${period}`;
}

export function formatEmailDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function buildTrialEndingEmail(input: { planName: string; priceLabel: string; endDate: string; manageUrl: string }): BillingEmailContent {
  const subject = `Your free month of ${input.planName} ends ${input.endDate}`;
  const text = `Your TalkThru free month ends on ${input.endDate}.\n\nAfter that, ${input.planName} continues at ${input.priceLabel}, charged to the card you added. Nothing else changes.\n\nTo change plans or cancel before you’re charged, open Billing: ${input.manageUrl}\n\nThe LivingWiki team`;
  const html = shell(`Your free month ends ${input.endDate}`,
    `<p>Your TalkThru free month ends on <strong>${escapeHtml(input.endDate)}</strong>.</p><p>After that, <strong>${escapeHtml(input.planName)}</strong> continues at <strong>${escapeHtml(input.priceLabel)}</strong>, charged to the card you added. Nothing else changes.</p><p>To change plans or cancel before you’re charged, open Billing.</p>${button(input.manageUrl, 'Manage my plan')}<p>The LivingWiki team</p>`);
  return { subject, text, html };
}

export function buildPaymentFailedEmail(input: { planName: string; amountLabel: string; manageUrl: string; invoiceUrl: string }): BillingEmailContent {
  const subject = `We couldn’t process your ${input.planName} payment`;
  const payLink = input.invoiceUrl || input.manageUrl;
  const text = `We tried to charge ${input.amountLabel} for ${input.planName}, but the payment didn’t go through.\n\nYour TalkThrus stay live while we retry over the next few days. Update your card to keep your plan: ${payLink}\n\nThe LivingWiki team`;
  const html = shell('Your payment didn’t go through',
    `<p>We tried to charge <strong>${escapeHtml(input.amountLabel)}</strong> for <strong>${escapeHtml(input.planName)}</strong>, but the payment didn’t go through.</p><p>Your TalkThrus stay live while we retry over the next few days. Update your card to keep your plan.</p>${button(payLink, 'Update payment')}<p>The LivingWiki team</p>`);
  return { subject, text, html };
}

async function recipientFor(subscription: Stripe.Subscription, stripe: Stripe): Promise<string> {
  const uid = subscription.metadata?.['userId'];
  if (uid) {
    try {
      const email = (await getAuth().getUser(uid)).email;
      if (email) return email;
    } catch { /* fall back to the Stripe customer */ }
  }
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return '';
  const customer = await stripe.customers.retrieve(customerId);
  return 'email' in customer && customer.email ? customer.email : '';
}

/** Sends once per key, even when Stripe retries the webhook. */
async function sendOnce(key: string, to: string, content: BillingEmailContent): Promise<boolean> {
  const apiKey = talkThruSendgridApiKey.value();
  if (!apiKey || !to) {
    logger.warn('TalkThru billing email skipped', { key, reason: apiKey ? 'no recipient' : 'SENDGRID_API_KEY missing' });
    return false;
  }
  const ref = sentCollection.doc(key);
  try {
    await ref.create({ status: 'sending', created_at: FieldValue.serverTimestamp() });
  } catch {
    return false; // already sent (or being sent) for this key
  }
  try {
    sgMail.setApiKey(apiKey);
    await sgMail.send({ to, from: { email: senderEmail, name: 'LivingWiki' }, subject: content.subject, text: content.text, html: content.html });
    await ref.set({ status: 'sent', sent_at: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  } catch (error) {
    // Let a later retry of the webhook try again.
    await ref.delete();
    throw error;
  }
}

function planOf(subscription: Stripe.Subscription): { plan: TalkThruPlanKey; cycle: TalkThruBillingCycle; seats: number; scope: 'user' | 'team'; teamId: string } | null {
  const item = subscription.items.data[0];
  const parsed = parseTalkThruLookupKey(item?.price?.lookup_key);
  const plan = parsed?.plan ?? normalizeTalkThruPlan(subscription.metadata?.['plan']);
  if (!plan) return null;
  return {
    plan,
    cycle: parsed?.cycle ?? (item?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'),
    seats: item?.quantity ?? 1,
    scope: subscription.metadata?.['scope'] === 'team' ? 'team' : 'user',
    teamId: subscription.metadata?.['teamId'] ?? '',
  };
}

function manageUrlFor(scope: 'user' | 'team', teamId: string): string {
  return scope === 'team' && teamId ? `${appUrl}/teams/${encodeURIComponent(teamId)}` : `${appUrl}/talkthrus/billing`;
}

export async function sendTalkThruTrialEndingEmail(subscription: Stripe.Subscription, stripe: Stripe): Promise<boolean> {
  if (subscription.metadata?.['source'] !== 'talkthru' || subscription.status !== 'trialing' || !subscription.trial_end) return false;
  // Someone who already cancelled is not charged; no reminder needed.
  if (subscription.cancel_at_period_end) return false;
  const info = planOf(subscription);
  if (!info) return false;
  const to = await recipientFor(subscription, stripe);
  return sendOnce(`trial_${subscription.id}_${subscription.trial_end}`, to, buildTrialEndingEmail({
    planName: talkThruPlanName(info.plan),
    priceLabel: talkThruPriceLabel(info.plan, info.cycle, info.seats),
    endDate: formatEmailDate(subscription.trial_end),
    manageUrl: manageUrlFor(info.scope, info.teamId),
  }));
}

export async function sendTalkThruPaymentFailedEmail(subscription: Stripe.Subscription, invoice: Stripe.Invoice, stripe: Stripe): Promise<boolean> {
  if (subscription.metadata?.['source'] !== 'talkthru' || !invoice.id) return false;
  const info = planOf(subscription);
  if (!info) return false;
  const to = await recipientFor(subscription, stripe);
  return sendOnce(`payment_failed_${invoice.id}`, to, buildPaymentFailedEmail({
    planName: talkThruPlanName(info.plan),
    amountLabel: usd(invoice.amount_due ?? 0),
    manageUrl: manageUrlFor(info.scope, info.teamId),
    invoiceUrl: invoice.hosted_invoice_url ?? '',
  }));
}
