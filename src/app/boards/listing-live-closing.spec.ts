import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ListingLiveClosingComponent } from './listing-live-closing';
import { listingContactCardDetails } from './listing-contact-card';

describe('Live contact completion screen', () => {
  async function render(phone = '2125550100', email = 'alex@example.com') {
    await TestBed.configureTestingModule({ imports: [ListingLiveClosingComponent], providers: [provideZonelessChangeDetection()] }).compileComponents();
    const fixture = TestBed.createComponent(ListingLiveClosingComponent);
    fixture.componentRef.setInput('contact', listingContactCardDetails({ contactDetails: { name: 'Alex', phone, email } }));
    fixture.componentRef.setInput('propertyTitle', 'A home');
    fixture.componentRef.setInput('imageUrl', '');
    fixture.detectChanges();
    return fixture;
  }

  it('shows contact links with completion, secondary replay/return actions, and small branding', async () => {
    const fixture = await render();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Tour complete');
    expect(element.querySelector('a[aria-label="Call Alex"]')?.getAttribute('href')).toBe('tel:2125550100');
    expect(element.querySelector('a[aria-label="Email Alex"]')?.getAttribute('href')).toBe('mailto:alex@example.com');
    expect(element.querySelector('footer')?.textContent).toContain('LivingWiki.com');
    const replay = jasmine.createSpy('replay');
    const back = jasmine.createSpy('return');
    fixture.componentInstance.replay.subscribe(replay);
    fixture.componentInstance.returnToBoard.subscribe(back);
    element.querySelectorAll('button')[0].click();
    element.querySelectorAll('button')[1].click();
    expect(replay).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('omits an absent phone and keeps the available email action', async () => {
    const fixture = await render('', 'alex@example.com');
    expect(fixture.nativeElement.querySelectorAll('a').length).toBe(1);
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('mailto:alex@example.com');
  });

  it('omits an absent email and renders long names as text', async () => {
    const fixture = await render('2125550100', '');
    fixture.componentRef.setInput('contact', listingContactCardDetails({ contactDetails: { name: '<script>Alex</script>', phone: '2125550100' } }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('a').length).toBe(1);
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('<script>Alex</script>');
  });
});
