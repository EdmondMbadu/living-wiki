import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';
export type QaCategory = 'education' | 'boundary' | 'urgent' | 'emergency';
export interface QaReference {
  id: string; question: string; expectedAnswer: string; category: QaCategory; source: string;
  approval: 'draft' | 'approved'; approvedBy: string; approvedOn: string;
  followUps: Array<{ question: string; expectedAnswer: string }>;
}
export interface QaTurn {
  question: string; expectedAnswer: string; actualAnswer: string; answerMode: string;
  reason: string; status: string; critical: boolean; citations: unknown[]; citedEntryIds: string[];
}
export interface QaResult { id: string; referenceId: string; category: QaCategory; status: string; critical: boolean; turns: QaTurn[]; error?: string }
export interface QaReview { id: string; resultId: string; decision: string; note: string; reviewerId: string; createdAt: string }
export interface QaRun {
  id: string; createdAt: string; finishedAt?: string; status: string; cancelRequested?: boolean;
  total: number; completed: number; passed: number; failed: number; errors: number; cancelled: number; critical: number;
  fingerprint: string; suiteHash: string; protocol: string; stale?: boolean;
  references: QaReference[]; results: QaResult[]; reviews: QaReview[];
}
export interface QaWorkspace {
  target: { boardId: string; cardId: string; atlasId: string; boardTitle: string; avatarName: string; openingMessage: string; personaPrompt: string; boardSlug: string };
  references: QaReference[]; revision: number; documents: Array<{ id: string; filename: string; status: string }>;
  runs: QaRun[]; selectedRun: QaRun | null;
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
