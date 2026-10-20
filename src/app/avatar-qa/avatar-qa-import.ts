import { normalizeQaReferences } from '../../../functions/src/avatar-qa-model';
import type { QaReference } from './avatar-qa.service';

export interface QaImportPreview {
  entries: QaReference[];
  turns: number;
  drafts: number;
  error: string;
}

/** Validate imports against the same contract used when the server saves a suite. */
export function previewQaImport(text: string, existing: QaReference[]): QaImportPreview {
  const empty = { entries: [], turns: 0, drafts: 0, error: '' };
  if (!text.trim()) return empty;
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return { ...empty, error: 'This is not valid JSON. Start with the example file, or check for missing commas and quotation marks.' }; }
  try {
    if (!Array.isArray(value)) throw new Error('The file must contain a JSON array of test entries. Download the example for the right format.');
    const entries = normalizeQaReferences(value);
    if (!entries.length) throw new Error('The file is empty. Add at least one question and reference answer.');
    const existingIds = new Set(existing.map(entry => entry.id));
    const overlap = entries.find(entry => existingIds.has(entry.id));
    if (overlap) throw new Error(`Reference ID ${overlap.id} already exists. Rename overlapping IDs in your file; existing answers will not be replaced.`);
    normalizeQaReferences([...existing, ...entries]);
    return {
      entries,
      turns: entries.reduce((count, entry) => count + 1 + entry.followUps.length, 0),
      drafts: entries.filter(entry => entry.approval === 'draft').length,
      error: '',
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Check the test-file format.' };
  }
}
