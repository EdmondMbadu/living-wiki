import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

export const QA_SNAPSHOT_VERSION = 2;
const COLLECTIONS = ['documents', 'knowledge_entries', 'wiki_articles', 'wiki_topics', 'wiki_index'];
const PAGE_SIZE = 500;
const SAMPLE_SIZE = 15;
const SAMPLE_BYTES_PER_COLLECTION = 8192;
type Data = Record<string, any>;

function revision(document: DocumentSnapshot): unknown[] {
  return [document.id, document.exists, document.updateTime?.seconds ?? null, document.updateTime?.nanoseconds ?? null];
}

/** Capture all selected-avatar revisions in pages; retain only a small generation sample. */
async function avatarCollection(db: Firestore, name: string, ownerId: string, atlasId: string) {
  const source = db.collection(name).where('atlas_id', '==', atlasId);
  const digest = createHash('sha256');
  let cursor: QueryDocumentSnapshot | undefined;
  let count = 0;
  do {
    let query = source.select('user_id').limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const document of page.docs) {
      if (document.data().user_id !== ownerId) continue;
      digest.update(JSON.stringify(revision(document)) + '\n');
      count++;
    }
    cursor = page.size === PAGE_SIZE ? page.docs.at(-1) : undefined;
  } while (cursor);

  const sample = await source.limit(SAMPLE_SIZE).get();
  const records: Data[] = [];
  for (const document of sample.docs) {
    const data = document.data();
    if (data.user_id !== ownerId) continue;
    const record = { id: document.id, atlas_id: atlasId,
      title: String(data.title || data.name || data.filename || '').slice(0, 300),
      claim: String(data.claim || data.summary || data.content || '').slice(0, 1200) };
    if (Buffer.byteLength(JSON.stringify([...records, record])) <= SAMPLE_BYTES_PER_COLLECTION) records.push(record);
  }
  return { revisionHash: digest.digest('hex'), count, records };
}

/**
 * The public legacy fallback considers the latest 40 owner topics and first 300
 * non-orphaned entries. Track that bounded retrieval window without scanning the
 * owner's entire account or exporting another avatar's content. Each selected
 * topic can contribute at most 72 fetched entries after excluding 72 previews,
 * so only its first 144 IDs can affect that fallback.
 */
async function legacyRetrievalRevision(db: Firestore, ownerId: string) {
  const [topics, entries] = await Promise.all([
    db.collection('wiki_topics').where('user_id', '==', ownerId).orderBy('last_updated', 'desc').limit(40).select('entry_ids').get(),
    db.collection('knowledge_entries').where('user_id', '==', ownerId).where('orphaned', '==', false).limit(300).select().get(),
  ]);
  const ids = new Set<string>();
  for (const topic of topics.docs) {
    const values = topic.data().entry_ids;
    if (Array.isArray(values)) for (const value of values.slice(0, 144)) {
      if (typeof value === 'string' && value && !value.includes('/')) ids.add(value);
    }
  }
  const sorted = [...ids].sort();
  const referenced: DocumentSnapshot[] = [];
  for (let index = 0; index < sorted.length; index += 150) {
    referenced.push(...await db.getAll(...sorted.slice(index, index + 150).map(id => db.collection('knowledge_entries').doc(id)), { fieldMask: [] }));
  }
  return createHash('sha256').update(JSON.stringify({ topics: topics.docs.map(revision),
    entries: entries.docs.map(revision), referenced: referenced.map(revision) })).digest('hex');
}

export async function avatarQaCorpus(db: Firestore, context: {
  atlasId: string; atlas: Data; card: Data; boardId: string; board: Data;
}, protocol: string) {
  const [values, legacyOwnerRetrievalHash] = await Promise.all([
    Promise.all(COLLECTIONS.map(async name => [name, await avatarCollection(db, name, context.atlas.user_id, context.atlasId)])),
    legacyRetrievalRevision(db, context.atlas.user_id),
  ]);
  const atlas = Object.fromEntries(['user_id', 'name', 'persona_prompt', 'wiki_type', 'response_perspective', 'chat_guide', 'city_config', 'university_config', 'default_answer_mode'].map(key => [key, context.atlas[key] ?? null]));
  const snapshot = { snapshotVersion: QA_SNAPSHOT_VERSION, atlas, card: context.card, boardId: context.boardId,
    boardTitle: context.board.title, protocol, textModel: 'gemini-3-flash-preview', legacyOwnerRetrievalHash,
    corpus: Object.fromEntries(values) };
  return { snapshot, fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}
