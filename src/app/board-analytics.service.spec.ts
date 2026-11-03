import { BoardAnalyticsService, buildTrackedBoardUrl } from './board-analytics.service';

describe('board analytics helpers', () => {
  it('builds a stable tracked board URL without removing existing parameters', () => {
    const result = new URL(buildTrackedBoardUrl(
      'https://www.livingwiki.com/boards/cape-may-gems?view=stack',
      'Facebook',
      'Cape May 40,000 Group',
    ));
    expect(result.searchParams.get('view')).toBe('stack');
    expect(result.searchParams.get('utm_source')).toBe('facebook');
    expect(result.searchParams.get('utm_medium')).toBe('social');
    expect(result.searchParams.get('utm_campaign')).toBe('cape-may-40-000-group');
  });

  it('uses a channel-appropriate medium for non-social links', () => {
    const email = new URL(buildTrackedBoardUrl(
      'https://www.livingwiki.com/boards/cape-may-gems',
      'email',
      'August update',
    ));
    const qr = new URL(buildTrackedBoardUrl(
      'https://www.livingwiki.com/boards/cape-may-gems',
      'qr-code',
      'Visitor center',
    ));
    const partner = new URL(buildTrackedBoardUrl(
      'https://www.livingwiki.com/boards/cape-may-gems',
      'partner-website',
      'Tourism office',
    ));
    expect(email.searchParams.get('utm_medium')).toBe('newsletter');
    expect(qr.searchParams.get('utm_medium')).toBe('qr');
    expect(partner.searchParams.get('utm_medium')).toBe('referral');
  });
});

describe('board view sessions',()=>{
 let service:any;
 beforeEach(()=>{jasmine.clock().install();service=Object.create(BoardAnalyticsService.prototype);Object.assign(service,{isBrowser:true,functions:{},pendingWrites:new Set(),current:null,lastViewBoardId:'',lastViewAt:0,visitorId:()=> 'browser-tracking-12345',clientId:()=> 'session-tracking-12345',record:jasmine.createSpy('record')});});
 afterEach(()=>{service.stopBoardSession();jasmine.clock().uninstall();});
 const input=(visibility='public',currentUserId='owner')=>({boardId:'board-1',boardTitle:'Board',customSlug:'board',visibility,ownerUserId:'owner',currentUserId,requestedRouteKey:'board-1'});
 it('records an owner visit and coalesces repeated data hydration into one board view',()=>{service.startBoardSession(input());service.startBoardSession(input());expect(service.record).toHaveBeenCalledOnceWith('board_view');});
 it('counts each real return visit, including returning from analytics immediately',()=>{service.startBoardSession(input());service.stopBoardSession();service.startBoardSession(input());expect(service.record).toHaveBeenCalledTimes(2);service.stopBoardSession();jasmine.clock().tick(5000);service.startBoardSession(input());expect(service.record).toHaveBeenCalledTimes(3);});
 it('permits authorized private-board telemetry while stopping anonymous private pages',()=>{service.startBoardSession(input('private'));expect(service.record).toHaveBeenCalledWith('board_view');service.stopBoardSession();service.record.calls.reset();service.startBoardSession(input('private',''));expect(service.current).toBeNull();expect(service.record).not.toHaveBeenCalled();});
 it('records engagement and card attribution inside an active owner session',()=>{service.startBoardSession(input());service.trackCardOpen('card');expect(service.record).toHaveBeenCalledWith('board_engaged');expect(service.record).toHaveBeenCalledWith('card_open',{cardId:'card'});});
 it('waits for in-flight view writes when opening reports, with a two-second bound',async()=>{let finish!:(value?:unknown)=>void;service.pendingWrites.add(new Promise(resolve=>finish=resolve));let done=false;const wait=service.flush().then(()=>done=true);await Promise.resolve();expect(done).toBeFalse();finish();await wait;expect(done).toBeTrue();service.pendingWrites.clear();service.pendingWrites.add(new Promise(()=>{}));const bounded=service.flush();jasmine.clock().tick(2000);await bounded;});

});
