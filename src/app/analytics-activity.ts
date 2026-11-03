export type AnalyticsAudience = 'all' | 'visitors' | 'internal';
export const analyticsAudiences = [
  {value:'all' as const,label:$localize`All activity`},
  {value:'visitors' as const,label:$localize`Visitors only`},
  {value:'internal' as const,label:$localize`Internal only`},
];
export type ActivityTotals = {conversations:number;voice:number;text:number;seconds:number;questions:number;
  failedAnswers:number;unknownDurations:number;unattributedConversations:number};
export type AnalyticsActivity = {totals:ActivityTotals;daily:Array<ActivityTotals & {day:string}>;
  pendingVoice?:number;unverifiedVoice:number;knownParticipants:number;verifiedAt:string|null};
