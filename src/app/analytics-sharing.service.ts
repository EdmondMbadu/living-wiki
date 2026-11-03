import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase.client';
import type { AnalyticsAudience } from './analytics-activity';

export type SharedAnalyticsReport = {
  board:{title:string;customSlug:string;publicUrl:string|null}; range:{from:string;to:string};audience:AnalyticsAudience;
  generatedAt:string;verifiedAt:string|null;trackingStartedAt:string|null;
  totals:{views:number;uniqueVisitors:number;knownParticipants?:number;cardOpens:number;outboundClicks:number;engagedVisits:number;
    conversations:number;voice:number;text:number;seconds:number;unknownDurations:number;unattributedConversations:number};
  status:{pendingVoice:number;unverifiedVoice:number;partial:boolean};
  daily:Array<{day:string;views:number;conversations:number;voice:number;text:number;seconds:number}>;
  cards:Array<{title:string;opens:number;conversations:number;outboundClicks:number}>;shownCards:number;totalCards:number;
};
export type AnalyticsReportLink = {id:string;createdAt:string;expiresAt:string;revoked:boolean;audience:AnalyticsAudience;range:{from:string;to:string}};
@Injectable({providedIn:'root'})
export class AnalyticsSharingService {
  private readonly functions=isPlatformBrowser(inject(PLATFORM_ID))?getFirebaseFunctions():null;
  private async call<T>(name:string,data:object):Promise<T>{
    if(!this.functions)throw Error('Report sharing requires a browser.');
    return (await httpsCallable<object,T>(this.functions,name)(data)).data;
  }
  create(boardId:string,days:number,audience:AnalyticsAudience,expiresDays:number,from?:string,to?:string){
    return this.call<{id:string;url:string;path:string;expiresAt:string;snapshot:SharedAnalyticsReport}>('manageAnalyticsReportShares',{action:'create',boardId,days,audience,expiresDays,...(from&&to?{from,to}:{})});
  }
  list(boardId:string){return this.call<{links:AnalyticsReportLink[]}>('manageAnalyticsReportShares',{action:'list',boardId});}
  revoke(boardId:string,id:string){return this.call<{revoked:boolean}>('manageAnalyticsReportShares',{action:'revoke',boardId,id});}
  read(token:string){return this.call<{report:SharedAnalyticsReport;expiresAt:string}>('getSharedAnalyticsReport',{token});}
  reconcile(boardId:string,cursor:string|null){return this.call<{processed:number;recovered:number;unavailable:number;nextCursor:string|null}>('reconcileBoardAnalytics',{boardId,cursor});}
}
