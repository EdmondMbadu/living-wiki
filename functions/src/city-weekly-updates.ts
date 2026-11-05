import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, type Firestore, type Query, type DocumentReference, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase-admin/firestore';
import type { UserRecord } from 'firebase-admin/auth';

type Data = Record<string, any>;
type AuthDirectory = { getUser(uid: string): Promise<UserRecord>; getUserByEmail(email: string): Promise<UserRecord> };
export type CitySubscription = { id: string; data: Data; ref: DocumentReference };
const emailOf = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// A fixed UTC Monday-to-Sunday period keeps a city/timezone change from starting
// a second automatic account delivery in the same week.
export function cityUpdateWeek(now = new Date()): string {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

export function savedCity(profile: Data): string | null {
  const value = profile.preferredCitySlug ?? profile.preferred_city_slug;
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase() : null;
}

export function publicCity(atlas: Data): boolean {
  return atlas.is_public === true && (atlas.wiki_type === 'city' || (!atlas.wiki_type && !!atlas.city_config));
}

// Single-field indexes only; no silent city/recipient caps.
export async function* cityUpdatePages(query: Query, pageSize = 250) {
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    const ordered = query.orderBy(FieldPath.documentId()).limit(pageSize);
    const page: QuerySnapshot = await (cursor ? ordered.startAfter(cursor) : ordered).get();
    if (page.empty) return;
    yield page.docs;
    if (page.size < pageSize) return;
    cursor = page.docs[page.docs.length - 1];
  }
}

export class CityWeeklyUpdates {
  constructor(private readonly db: Firestore, private readonly auth: AuthDirectory, private readonly functionsUrl: string) {}

  private ref(uid: string) { return this.db.collection('city_weekly_updates').doc(uid); }

  async hasAccounts(slug: string): Promise<boolean> {
    for (const field of ['preferredCitySlug', 'preferred_city_slug']) {
      if (!(await this.db.collection('users').where(field, '==', slug).limit(1).get()).empty) return true;
    }
    return false;
  }

  private async subscriptions(field: string, value: string): Promise<CitySubscription[]> {
    const result: CitySubscription[] = [];
    for await (const page of cityUpdatePages(this.db.collection('atlas_subscriptions').where(field, '==', value))) {
      result.push(...page.map(doc => ({ id: doc.id, data: doc.data(), ref: doc.ref })));
    }
    return result;
  }

  async preference(uid: string, email: string): Promise<Data> {
    const ref = this.ref(uid);
    const existing = await ref.get();
    if (existing.exists) return existing.data()!;
    const subscriptions = [...await this.subscriptions('email', email), ...await this.subscriptions('subscriber_user_id', uid)];
    const initial = {
      enabled: !subscriptions.some(subscription => subscription.data.status === 'unsubscribed'),
      unsubscribe_token: randomUUID(),
      source: 'saved-home-city',
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    // First visit and the scheduler may initialize together. Never overwrite an opt-out.
    return this.db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.exists) return current.data()!;
      tx.create(ref, initial);
      return initial;
    });
  }

  async settings(uid: string) {
    const user = await this.auth.getUser(uid);
    const email = emailOf(user.email);
    const profile = (await this.db.collection('users').doc(uid).get()).data() ?? {};
    const citySlug = savedCity(profile);
    const preference = await this.preference(uid, email);
    let city: Data | undefined;
    if (citySlug) {
      const matches = await this.db.collection('atlases').where('slug', '==', citySlug).get();
      city = matches.docs.map(doc => doc.data()).find(publicCity);
    }
    return {
      enabled: preference.enabled === true,
      emailVerified: user.emailVerified && !user.disabled && !!email,
      citySlug,
      cityName: city ? String(city.city_config?.city_name || city.city_config?.name || city.name || city.title || citySlug).replace(/^Living\s*Wiki:\s*/i, '') : null,
      available: !!city && city.newsletter_config?.enabled !== false,
    };
  }

  async setEnabled(uid: string, enabled: boolean) {
    const user = await this.auth.getUser(uid);
    const email = emailOf(user.email);
    await this.preference(uid, email);
    await this.ref(uid).set({ enabled, updated_at: FieldValue.serverTimestamp(), source: 'account-setting' }, { merge: true });
    // An unverified account must not control an existing visitor's subscription
    // simply by registering that visitor's email address.
    if (!enabled && user.emailVerified) await this.stopManualSubscriptions(email);
  }

  private async stopManualSubscriptions(email: string) {
    if (!email) return;
    for (const subscription of await this.subscriptions('email', email)) {
      if (subscription.data.status === 'active') {
        await subscription.ref.set({ status: 'unsubscribed', unsubscribed_at: FieldValue.serverTimestamp(), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }

  async unsubscribe(uid: string, token: string): Promise<boolean> {
    if (!uid || uid.includes('/') || !token) return false;
    const preference = (await this.ref(uid).get()).data();
    if (!preference?.unsubscribe_token || preference.unsubscribe_token !== token) return false;
    await this.ref(uid).set({ enabled: false, source: 'email-unsubscribe', updated_at: FieldValue.serverTimestamp() }, { merge: true });
    try {
      await this.stopManualSubscriptions(emailOf((await this.auth.getUser(uid)).email));
    } catch (error: any) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    return true;
  }

  // Old visitor-email links must also stop automatic account mail.
  async optOutEmail(email: string) {
    if (!email) return;
    try {
      const user = await this.auth.getUserByEmail(email);
      await this.setEnabled(user.uid, false);
    } catch (error: any) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  }

  private async eligibleAccount(uid: string, slug: string) {
    let user: UserRecord;
    try { user = await this.auth.getUser(uid); }
    catch (error: any) { if (error.code === 'auth/user-not-found') return null; throw error; }
    const email = emailOf(user.email);
    if (!user.emailVerified || user.disabled || !email) return null;
    const profile = (await this.db.collection('users').doc(uid).get()).data() ?? {};
    if (savedCity(profile) !== slug) return null;
    const preference = await this.preference(uid, email);
    return preference.enabled === true ? { uid, email, token: String(preference.unsubscribe_token) } : null;
  }

  async deliver(params: {
    atlasId: string; slug: string; includeAccounts: boolean; week: string;
    subscriptions: CitySubscription[];
    send(email: string, unsubscribeUrl: string, accountCityUpdate: boolean): Promise<string | null>;
    manualUnsubscribeUrl(subscription: CitySubscription): Promise<string>;
  }) {
    const targets: ({ uid: string } | { subscription: CitySubscription })[] = [];
    if (params.includeAccounts) {
      const ids = new Set<string>();
      for (const field of ['preferredCitySlug', 'preferred_city_slug']) {
        for await (const page of cityUpdatePages(this.db.collection('users').where(field, '==', params.slug))) {
          for (const user of page) ids.add(user.id);
        }
      }
      targets.push(...[...ids].map(uid => ({ uid })));
    }
    targets.push(...params.subscriptions.map(subscription => ({ subscription })));
    let sentCount = 0;
    let failedCount = 0;
    const uncertainRecipients = new Set<string>();
    const messageIds: string[] = [];
    for (const target of targets) {
      let refs: DocumentReference[] = [];
      let attempted = false;
      try {
        let email: string;
        let unsubscribeUrl: string;
        let uid: string | null = null;
        if ('uid' in target) {
          // Re-read city, account email, verification and opt-out just before sending.
          const account = await this.eligibleAccount(target.uid, params.slug);
          if (!account) continue;
          uid = account.uid;
          email = account.email;
          unsubscribeUrl = `${this.functionsUrl}/unsubscribeCityWeeklyUpdates?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(account.token)}`;
        } else {
          const subscription = target.subscription;
          const fresh = (await subscription.ref.get()).data();
          if (fresh?.status !== 'active') continue;
          email = emailOf(fresh.email);
          if (!email) continue;
          // A Profile opt-out also suppresses overlapping visitor subscriptions.
          try {
            const user = await this.auth.getUserByEmail(email);
            if (user.emailVerified) {
              const preference = await this.preference(user.uid, email);
              if (preference.enabled !== true || user.disabled) continue;
            }
          } catch (error: any) { if (error.code !== 'auth/user-not-found') throw error; }
          unsubscribeUrl = await params.manualUnsubscribeUrl(subscription);
        }
        const keys = [`city:${params.atlasId}:${email}:${params.week}`];
        if (uid) keys.push(`account:${uid}:${params.week}`, `account-email:${email}:${params.week}`);
        refs = keys.map(key => this.db.collection('city_weekly_deliveries').doc(hash(key)));
        const claim = await this.db.runTransaction(async tx => {
          const snapshots = await tx.getAll(...refs);
          if (snapshots.some(doc => doc.exists)) return {
            claimed: false,
            uncertain: snapshots.some(doc => ['sending', 'uncertain'].includes(doc.data()?.status)),
          };
          for (const ref of refs) tx.create(ref, { status: 'sending', atlas_id: params.atlasId, user_id: uid, week: params.week, created_at: FieldValue.serverTimestamp() });
          return { claimed: true, uncertain: false };
        });
        if (!claim.claimed) {
          if (claim.uncertain) uncertainRecipients.add(refs[0].path);
          continue;
        }
        attempted = true;
        const messageId = await params.send(email, unsubscribeUrl, !!uid);
        sentCount += 1;
        if (messageId) messageIds.push(messageId);
        const batch = this.db.batch();
        for (const ref of refs) batch.update(ref, { status: 'sent', message_id: messageId, sent_at: FieldValue.serverTimestamp() });
        await batch.commit();
      } catch (error: any) {
        failedCount += 1;
        if (attempted) {
          // SendGrid has no exactly-once send API. A timeout could mean accepted:
          // retain the claim for review instead of automatically sending twice.
          const status = Number(error.response?.statusCode ?? error.code);
          const rejected = status >= 400 && status < 500;
          const batch = this.db.batch();
          for (const ref of refs) {
            if (rejected) batch.delete(ref);
            else batch.update(ref, { status: 'uncertain', error: String(error.message ?? error).slice(0, 500), updated_at: FieldValue.serverTimestamp() });
          }
          await batch.commit();
        }
        // Continue other recipients; the city run remains retryable on failure.
        console.error('City weekly delivery failed', { atlasId: params.atlasId, userId: 'uid' in target ? target.uid : null, error: String(error.message ?? error) });
      }
    }
    return { sentCount, failedCount, uncertainCount: uncertainRecipients.size, messageIds };
  }
}
