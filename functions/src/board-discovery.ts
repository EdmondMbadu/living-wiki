import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';

/** Canonical reads make retries and older visibility events safe. */
export async function removeHiddenBoardFromDiscovery(boardId: string): Promise<boolean> {
  const boardRef = db.collection('boards').doc(boardId);
  const hidden = await db.runTransaction(async (tx) => {
    const board = (await tx.get(boardRef)).data();
    if (board?.visibility === 'public' && !board.parentCardId) return false;
    tx.delete(db.collection('public_board_summaries').doc(boardId));
    tx.delete(db.collection('public_team_listings').doc(boardId));
    return true;
  });
  if (!hidden) return false;
  const collections = await db.collection('board_collections')
    .where('board_ids', 'array-contains', boardId).get();
  for (const collection of collections.docs) {
    await db.runTransaction(async (tx) => {
      const [board, current] = await tx.getAll(boardRef, collection.ref);
      if (board.data()?.visibility === 'public' && !board.data()?.parentCardId) return;
      const ids = current.data()?.board_ids;
      if (!Array.isArray(ids) || !ids.includes(boardId)) return;
      tx.update(collection.ref, {
        board_ids: ids.filter((id) => id !== boardId),
        updated_at_iso: new Date().toISOString(),
        server_updated_at: FieldValue.serverTimestamp(),
      });
    });
  }
  return true;
}
