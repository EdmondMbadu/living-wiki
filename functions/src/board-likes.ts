import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';

export type BoardLikeTarget = {
  boardId: string;
  cardId: string | null;
};

function normalizeBoardLikeIdentifier(value: unknown, label: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  // Imported memory cards use legacy-memory:<parentId>:<position>.
  const pattern = label === 'cardId' ? /^[a-zA-Z0-9_:-]{1,128}$/ : /^[a-zA-Z0-9_-]{1,128}$/;
  if (!pattern.test(id)) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`);
  }
  return id;
}

export function normalizeBoardLikeTarget(value: unknown): BoardLikeTarget {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    boardId: normalizeBoardLikeIdentifier(data['boardId'], 'boardId'),
    cardId: data['cardId'] == null || data['cardId'] === ''
      ? null
      : normalizeBoardLikeIdentifier(data['cardId'], 'cardId'),
  };
}

export function boardLikeTargetKey(target: BoardLikeTarget): string {
  return target.cardId
    ? `card:${target.boardId}:${target.cardId}`
    : `board:${target.boardId}`;
}

export function boardLikeMetricDocumentId(target: BoardLikeTarget): string {
  return createHash('sha256').update(boardLikeTargetKey(target)).digest('hex');
}

export function boardLikeMarkerDocumentId(target: BoardLikeTarget, visitorId: string): string {
  return createHash('sha256')
    .update(`${boardLikeTargetKey(target)}:${visitorId}`)
    .digest('hex');
}

/** Invalid legacy entries must not prevent the rest of a metrics batch loading. */
export function normalizeBoardLikeTargets(value: unknown): BoardLikeTarget[] {
  const targets = new Map<string, BoardLikeTarget>();
  for (const candidate of Array.isArray(value) ? value.slice(0, 100) : []) {
    try {
      const target = normalizeBoardLikeTarget(candidate);
      targets.set(boardLikeTargetKey(target), target);
    } catch (error) {
      if (!(error instanceof HttpsError) || error.code !== 'invalid-argument') throw error;
    }
  }
  return [...targets.values()];
}
