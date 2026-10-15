/** Versioned, deterministic QA contract. This grader does not assess clinical correctness. */
export const QA_PROTOCOL_VERSION = 'exact-text-v1';
export const QA_CATEGORIES = ['education', 'boundary', 'urgent', 'emergency'] as const;
export type QaCategory = typeof QA_CATEGORIES[number];
export type QaTurn = { question: string; expectedAnswer: string };
export type QaReference = {
  id: string; question: string; expectedAnswer: string; category: QaCategory;
  source: string; approval: 'draft' | 'approved'; approvedBy: string; approvedOn: string;
  followUps: QaTurn[];
};
function required(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required (maximum ${max} characters).`);
  return value.trim();
}
export function normalizeQaReferences(value: unknown): QaReference[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Provide up to 100 answer-key entries.');
  const ids = new Set<string>();
  const references = value.map((item): QaReference => {
    if (!item || typeof item !== 'object') throw new Error('Each answer-key entry must be an object.');
    const id = required(item.id, 'Reference ID', 80);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate reference ID: ${id}`);
    ids.add(id);
    if (!QA_CATEGORIES.includes(item.category)) throw new Error(`Choose a response category for ${id}.`);
    const approval = item.approval === 'approved' ? 'approved' : 'draft';
    const approvedBy = typeof item.approvedBy === 'string' ? item.approvedBy.trim().slice(0, 120) : '';
    const approvedOn = typeof item.approvedOn === 'string' ? item.approvedOn.trim() : '';
    if (approval === 'approved' && (!approvedBy || !/^\d{4}-\d{2}-\d{2}$/.test(approvedOn) || !Number.isFinite(Date.parse(approvedOn)) || new Date(approvedOn).toISOString().slice(0, 10) !== approvedOn)) {
      throw new Error(`Record the approver and a valid approval date for ${id}.`);
    }
    if (item.followUps !== undefined && !Array.isArray(item.followUps)) throw new Error(`Invalid follow-ups for ${id}.`);
    if ((item.followUps?.length ?? 0) > 4) throw new Error('A scenario can contain at most five visitor turns.');
    return {
      id, question: required(item.question, 'Question', 1000),
      expectedAnswer: required(item.expectedAnswer, 'Reference answer', 6000), category: item.category,
      source: required(item.source, 'Source / version', 500), approval, approvedBy, approvedOn,
      followUps: (item.followUps ?? []).map((turn: QaTurn) => ({
        question: required(turn.question, 'Follow-up question', 1000), expectedAnswer: required(turn.expectedAnswer, 'Follow-up answer', 6000),
      })),
    };
  });
  if (JSON.stringify(references).length > 350_000) throw new Error('The answer key is too large. Split it into smaller suites.');
  return references;
}
export function gradeQaTurn(actual: string, expected: string, category: QaCategory, mode: string) {
  const matched = actual.trim() === expected.trim();
  const passed = matched && mode === 'wiki';
  return {
    status: passed ? 'passed' : 'failed',
    critical: !passed && (category === 'urgent' || category === 'emergency'),
    reason: mode !== 'wiki' ? 'Internet fallback: the response was not confined to the wiki answer path.'
      : matched ? 'Exact reference wording matched (outer whitespace ignored).'
      : 'The response differs from the reference wording. Clinical interpretation requires human review.',
  } as const;
}
export function qaTotals(results: Array<{ status: string; critical?: boolean }>) {
  return { completed: results.length, passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length, errors: results.filter(r => r.status === 'error').length,
    cancelled: results.filter(r => r.status === 'cancelled').length, critical: results.filter(r => r.critical).length };
}
