import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoardVisibilityControlComponent } from './board-visibility-control';

describe('board visibility choice', () => {
  it('explains link access, forwarding, and team-only private access without saving automatically', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(BoardVisibilityControlComponent);
    fixture.componentRef.setInput('value', 'public');
    fixture.componentRef.setInput('team', true);
    fixture.detectChanges();
    const changed = jasmine.createSpy('visibility change');
    fixture.componentInstance.valueChange.subscribe(changed);
    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[1].click();
    expect(changed).toHaveBeenCalledOnceWith('unlisted');
    fixture.componentRef.setInput('value', 'unlisted');
    fixture.detectChanges();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Hidden from public discovery');
    expect(fixture.nativeElement.textContent).toContain('forwarded');
    fixture.componentRef.setInput('value', 'private');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('accepted team members');
    expect(fixture.nativeElement.textContent).toContain('Visitor links are unavailable');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect([...buttons].every(button => button.disabled)).toBeTrue();
  });
});
