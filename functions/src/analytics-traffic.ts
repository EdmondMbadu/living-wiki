import { AggregateField, type Query } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { includesAudience, type AnalyticsAudience } from './analytics-activity';

export const trafficTracking = (boardId: string) => db.collection('board_tracking').doc(boardId);
export function trafficVisitorRoot(boardId: string, internal: boolean) {
  const root = trafficTracking(boardId);
  return internal ? root.collection('audiences').doc('internal') : root;
}
export function trafficStartedAt(data: Record<string, any> | undefined, audience: AnalyticsAudience): string | null {
  const visitor = data?.started_at?.toDate().toISOString() || null;
  const internal = data?.internal_started_at?.toDate().toISOString() || null;
  return audience === 'visitors' ? visitor : audience === 'internal' ? internal : [visitor, internal].filter(Boolean).sort()[0] || null;
}
export async function trafficDocs(query: Query, maximum = 20000) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    docs.push(...page.docs);
    if (docs.length > maximum) throw new HttpsError('resource-exhausted', 'Choose a shorter traffic reporting period.');
    if (page.size < 500) return docs;
    cursor = page.docs.at(-1);
  }
}
export async function trafficVisitorCounts(boardId: string, from: string, to: string, audience: AnalyticsAudience, cardId?: string) {
  const scopes = audience === 'all' ? [false, true] : [audience === 'internal'];
  const groups = await Promise.all(scopes.map(async internal => {
    const root = trafficVisitorRoot(boardId, internal);
    const target = cardId ? root.collection('cards').doc(cardId) : root;
    return trafficDocs(target.collection('visitors').where('last_day', '>=', from).orderBy('last_day'));
  }));
  const visitors = new Set<string>();
  const viewDays=groups.map(group=>{const days=new Map<string,Set<string>>();for(const doc of group){
    if(doc.data().days?.some((day:string)=>day>=from&&day<=to))visitors.add(doc.id);
    for(const day of doc.data().view_days||[]){if(day<from||day>to)continue;const ids=days.get(day)||new Set<string>();ids.add(doc.id);days.set(day,ids);}
  }return days;});
  const overlapByDay=new Map<string,number>();
  if(viewDays.length===2)for(const [day,ids] of viewDays[0])overlapByDay.set(day,[...ids].filter(id=>viewDays[1].get(day)?.has(id)).length);
  return {visitors,overlapByDay};
}

export async function trafficVisitors(boardId:string,from:string,to:string,audience:AnalyticsAudience,cardId?:string){
  return (await trafficVisitorCounts(boardId,from,to,audience,cardId)).visitors;
}

/** Separate sums preserve legacy shards that omit one or more counter fields.
 * All-minus-internal also preserves old visitor rows that have no internal flag.
 * A read-only transaction keeps all sums at the same snapshot during live traffic.
 */
export async function platformTraffic(from: string, to: string, audience: AnalyticsAudience) {
  const base = db.collection('board_analytics_daily_shards').where('day', '>=', from).where('day', '<=', to);
  const fields = ['views', 'card_opens', 'talking_card_opens'];
  const scopes = audience === 'visitors' ? [false, true] : [audience === 'internal'];
  try {
    const values = await db.runTransaction(async tx => Promise.all(scopes.map(async internal => {
      const query = internal ? base.where('internal', '==', true) : base;
      return Promise.all(fields.map(async field => {
        const result = await tx.get(query.aggregate({total: AggregateField.sum(`counts.${field}`)}));
        return Number(result.data().total) || 0;
      }));
    })), {readOnly: true});
    const counters = values[0].map((value, i) => Math.max(0, value - (values[1]?.[i] || 0)));
    return {views: counters[0], cardOpens: counters[1] + counters[2]};
  } catch (error) {
    // New indexes can take time to build. Existing small reports stay usable during rollout.
    const code = (error as {code?:unknown})?.code;
    if (code !== 9 && code !== 'failed-precondition') throw error;
    logger.warn('Traffic aggregate index is not ready; using bounded fallback.', {audience});
    const docs = await trafficDocs(base.orderBy('day'));
    return docs.filter(doc => includesAudience(audience, doc.data().internal === true)).reduce((sum, doc) => {
      const counts = doc.data().counts || {};
      sum.views += Number(counts.views) || 0;
      sum.cardOpens += (Number(counts.card_opens) || 0) + (Number(counts.talking_card_opens) || 0);
      return sum;
    }, {views: 0, cardOpens: 0});
  }
}
