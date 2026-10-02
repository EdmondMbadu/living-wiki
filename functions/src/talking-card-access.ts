import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { isLinkReadableVisibility } from './board-visibility';

type RecordData = Record<string, unknown>;
export type TalkingCardTarget = { boardId?: unknown; cardId?: unknown };

/** A board may expose its owner's avatar through a visible card, without publishing the wiki. */
export function boardGrantsTalkingCardAccess(
  board: RecordData, atlas: RecordData, atlasId: string, cardId: string, uid: string | null,
): boolean {
  const owner = board['owner_user_id'];
  if (!owner || owner !== atlas['user_id'] || board['team_id'] || board['teamId']) return false;
  if (owner !== uid && !isLinkReadableVisibility(board['visibility'])) return false;
  const find = (values: unknown, depth = 0): boolean => {
    if (!Array.isArray(values) || depth > 10) return false;
    return values.some((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const card = value as RecordData;
      if (card['authorOnly'] === true
        || (Array.isArray(card['tags']) && card['tags'].includes('author-only'))) return false;
      const conversation = card['conversation'] as RecordData | undefined;
      return (card['id'] === cardId && conversation?.['provider'] === 'atlas'
        && conversation['atlasId'] === atlasId)
        || find(card['relatedCards'], depth + 1);
    });
  };
  return find(board['cards']);
}

export async function loadTalkingCardAtlas(
  atlasId: string, uid: string | null, target: TalkingCardTarget = {},
): Promise<RecordData & { id: string; user_id: string; is_public: boolean }> {
  const snapshot = await db.collection('atlases').doc(atlasId).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'This avatar is no longer available.');
  const atlas = snapshot.data()!;
  const ownerId = String(atlas['user_id'] || '');
  const adminIds = Array.isArray(atlas['admin_user_ids']) ? atlas['admin_user_ids'] : [];
  let accessible = atlas['is_public'] === true || (!!uid && (ownerId === uid || adminIds.includes(uid)));
  if (!accessible && ownerId) {
    const boardId = typeof target.boardId === 'string' ? target.boardId.trim() : '';
    const cardId = typeof target.cardId === 'string' ? target.cardId.trim() : '';
    if (/^[A-Za-z0-9_-]{1,180}$/.test(boardId) && /^[A-Za-z0-9_-]{1,180}$/.test(cardId)) {
      const board = (await db.collection('boards').doc(boardId).get()).data();
      accessible = !!board && boardGrantsTalkingCardAccess(board, atlas, atlasId, cardId, uid);
    }
  }
  if (!accessible) throw new HttpsError('permission-denied', 'This avatar is not available through this board.');
  return { ...atlas, id: snapshot.id, user_id: ownerId, is_public: atlas['is_public'] === true };
}

export const getTalkingCardAvatar = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const atlasId = typeof request.data?.atlasId === 'string' ? request.data.atlasId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(atlasId)) throw new HttpsError('invalid-argument', 'Choose a valid avatar.');
  const atlas = await loadTalkingCardAtlas(atlasId, request.auth?.uid ?? null, request.data);
  // Send only presentation fields. Private prompts, admin lists, integrations,
  // and raw documents remain inaccessible through Firestore and this endpoint.
  return { atlas: Object.fromEntries([
    'id', 'name', 'wiki_type', 'response_perspective', 'chat_guide', 'logo_url',
    'description', 'is_public',
  ].map((key) => [key, atlas[key] ?? null])) };
});
