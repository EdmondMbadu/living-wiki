import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase.client';

export type AnalyticsConversation = {
  canReadTranscript?: boolean;
  id: string; mode: 'text' | 'voice'; startedAt: string; visitor: string;
  durationSeconds: number | null; durationKind: 'estimated' | 'recorded';
  status: string; questions: number; knowledgeGaps: number; failedAnswers: number; firstQuestion: string;
};
export type CardAnalyticsReport = {
  board: { id: string; title: string }; card: { id: string; title: string; talking: boolean };
  range: { days: number; from: string; to: string }; trackingStartedAt: string | null;
  canViewBoardAnalytics: boolean; canReadTranscripts: boolean; visitors: number; visitorsWhoChatted: number;
  popularQuestions?: Array<{question:string;count:number}>;
  opens: number; outboundClicks: number; pendingVoice: number; conversations: AnalyticsConversation[];
};
export type AnalyticsTurn = { id: string; role: 'user' | 'assistant'; text: string; at: string; status: string };
export type ConversationPage = { conversation: AnalyticsConversation; turns: AnalyticsTurn[]; nextCursor: string | null };

@Injectable({ providedIn: 'root' })
export class CardAnalyticsService {
  private readonly functions = isPlatformBrowser(inject(PLATFORM_ID)) ? getFirebaseFunctions() : null;
  private async call<T>(name: string, data: object): Promise<T> {
    if (!this.functions) throw new Error('Analytics are available in your browser.');
    return (await httpsCallable<object, T>(this.functions, name)(data)).data;
  }
  report(boardId: string, cardId: string, days: number): Promise<CardAnalyticsReport> {
    return this.call('getCardAnalytics', { boardId, cardId, days });
  }
  conversation(boardId: string, cardId: string, conversationId: string, cursor?: string | null): Promise<ConversationPage> {
    return this.call('getCardConversation', { boardId, cardId, conversationId, cursor });
  }
  endText(boardId:string,cardId:string,sessionId:string,anonymousVisitorId:string):Promise<{accepted:boolean}>{
    return this.call('endCardTextAnalytics',{boardId,cardId,sessionId,anonymousVisitorId});
  }
  syncVoice(sessionId: string, conversationId: string, anonymousVisitorId: string): Promise<{ pending: boolean }> {
    return this.call('syncCardVoiceAnalytics', { sessionId, conversationId, anonymousVisitorId });
  }
}
