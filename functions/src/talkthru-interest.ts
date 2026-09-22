import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';

export interface TalkThruInterest {
  role: 'agent' | 'agency';
  name: string;
  email: string;
  agency: string;
  listing: string;
  consent: true;
}

export function normalizeTalkThruInterest(input: Record<string, unknown>): TalkThruInterest {
  const value = (key: string) => typeof input[key] === 'string' ? input[key].trim() : '';
  const role = value('role');
  const name = value('name');
  const email = value('email').toLowerCase();
  const agency = value('agency');
  const listing = value('listing');
  if (role !== 'agent' && role !== 'agency') throw new HttpsError('invalid-argument', 'Choose an agent or agency.');
  if (name.length < 2 || name.length > 120) throw new HttpsError('invalid-argument', 'Enter your name.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email.');
  if (!agency || agency.length > 160) throw new HttpsError('invalid-argument', 'Enter your agency or brokerage.');
  if (listing) {
    let url: URL;
    try { url = new URL(listing); }
    catch { throw new HttpsError('invalid-argument', 'Enter a valid listing link.'); }
    if (url.protocol !== 'https:' || !url.hostname || listing.length > 2000)
      throw new HttpsError('invalid-argument', 'Enter an HTTPS listing link.');
  }
  if (input.consent !== true) throw new HttpsError('invalid-argument', 'Consent is required.');
  return { role, name, email, agency, listing, consent: true };
}

export const submitTalkThruInterest = onCall({ region: 'us-central1', cors: true, maxInstances: 10 }, async (request) => {
  const input = request.data;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HttpsError('invalid-argument', 'Enter your contact details.');
  // Quietly discard automated submissions that fill the hidden field.
  if (input.website) return { received: true };
  const interest = normalizeTalkThruInterest(input);
  const ip = request.rawRequest.ip || 'unknown';
  const key = createHash('sha256').update(ip).digest('hex');
  const limitRef = db.doc(`talkthru_interest_limits/${key}`);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const previous = (await tx.get(limitRef)).data();
    const count = (previous?.windowEndsAt ?? 0) > now ? Number(previous?.count) || 0 : 0;
    if (count >= 3) throw new HttpsError('resource-exhausted', 'Please try again later.');
    tx.set(limitRef, { count: count + 1, windowEndsAt: count ? Number(previous?.windowEndsAt) : now + 3600000 });
    tx.set(db.collection('talkthru_interests').doc(), {
      ...interest,
      source: '/talkthrus',
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { received: true };
});
