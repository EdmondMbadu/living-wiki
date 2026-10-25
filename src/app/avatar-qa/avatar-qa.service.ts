import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';
export type QaCategory = 'education' | 'boundary' | 'urgent' | 'emergency';
export type StressCategory = 'instructions' | 'privacy' | 'accuracy' | 'harmful' | 'boundaries';
export interface StressQuestion { id: string; question: string; category: StressCategory; expectedBehavior: string }
export interface StressAssessment { status: 'passed' | 'failed'; critical: boolean; severity: 'none' | 'review' | 'high'; title: string; reason: string }
export interface DirectQuestion {
  id: string; question: string; answer: string; answerMode: string; citations: unknown[]; createdAt: string;
  assessment: StressAssessment | null; assessmentError?: string; changedDuringTest?: boolean;
}
export interface QaReference {
  id: string; question: string; expectedAnswer: string; category: QaCategory; source: string;
  approval: 'draft' | 'approved'; approvedBy: string; approvedOn: string;
  followUps: Array<{ question: string; expectedAnswer: string }>;
}
export interface QaTurn {
  question: string; expectedAnswer: string; actualAnswer: string; answerMode: string;
  reason: string; status: string; critical: boolean; citations: unknown[]; citedEntryIds: string[];
  title?: string; severity?: 'none' | 'review' | 'high';
}
export interface QaResult { id: string; referenceId: string; category: QaCategory | StressCategory; status: string; critical: boolean; turns: QaTurn[]; error?: string }
export interface QaReview { id: string; resultId: string; decision: string; note: string; reviewerId: string; createdAt: string }
export interface QaRepair {
  phase?: 'reassessing' | 'writing' | 'checking' | 'testing'; reviewed?: number; reviewTotal?: number;
  mode: 'fix' | 'retest'; round: number; rootRunId: string; sourceRunId: string;
  candidatePrompt?: string; previousPrompt?: string; changes?: string[]; baselineScore?: number; baselineReassessed?: boolean;
  retestRequired?: boolean; outcome: 'pending' | 'improved' | 'retained'; retainedRunId: string; noProgressCount: number; canApply: boolean;
  appliedAt?: string; restoredAt?: string;
  comparison: { score: number | null; previousScore: number; passed: number; total: number; resolved: number;
    regressions: string[]; checksPassed: number; checksTotal: number; allPassed: boolean };
}
export interface QaRun {
  id: string; createdAt: string; finishedAt?: string; status: string; cancelRequested?: boolean;
  total: number; completed: number; passed: number; failed: number; errors: number; cancelled: number; critical: number;
  fingerprint: string; suiteHash: string; protocol: string; stale?: boolean;
  references: Array<QaReference | StressQuestion>; results: QaResult[]; reviews: QaReview[];
  boundaries?: string; error?: string; configurationWarning?: string;
  repair?: QaRepair;
}
export interface QaWorkspace {
  target: { boardId: string; cardId: string; atlasId: string; boardTitle: string; avatarName: string; openingMessage: string; personaPrompt: string; boardSlug: string; avatarImageUrl?: string | null };
  references: QaReference[]; revision: number; documents: Array<{ id: string; filename: string; status: string }>;
  runs: QaRun[]; selectedRun: QaRun | null;
  boundaries?: string;
  attemptsRemaining?: number; repairUnavailableReason?: string;
}
@Injectable({ providedIn: 'root' })
export class AvatarQaService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  async command<T>(boardId: string, cardId: string, action: string, options: Record<string, unknown> = {}): Promise<T> {
    if (!this.isBrowser) throw new Error('Open avatar QA in your browser.');
    const callable = httpsCallable<Record<string, unknown>, T>(getFirebaseFunctions(), 'avatarQaCommand', { timeout: 180000 });
    return (await callable({ ...options, boardId, cardId, action })).data;
  }
}
