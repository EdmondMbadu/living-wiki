import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoardsComponent } from './boards';
import { RealEstateWizardSourceComponent } from './real-estate-wizard-source';
import type { BoardNarrationStyleId } from './board-narration-style';

@Component({
  imports: [RealEstateWizardSourceComponent],
  styleUrls: ['./boards.css', './board-wizard-redesign.css', './real-estate-wizard-modal.css'],
  template: ` <div class="boards-modal-backdrop">
    <section
      class="boards-modal boards-modal--wizard boards-modal--real-estate-configure"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
    >
      <div class="boards-modal__head">
        <div>
          <p>New board</p>
          <h3 id="preview-title">Real Estate VirtualTalkThru</h3>
          <span class="boards-wizard-modal__subtitle"
            >Turn a property listing into a story buyers can explore.</span
          >
        </div>
        <button type="button" class="boards-icon-button" aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <form
        class="boards-form boards-wizard boards-wizard--configure"
        (submit)="$event.preventDefault()"
      >
        <app-real-estate-wizard-source
          [(listingUrl)]="url"
          [(narrationStyle)]="style"
          [(narrationSeconds)]="seconds"
          [cardCount]="count"
        />
        <div class="boards-form__actions">
          <button type="button" class="boards-ghost-action">Back</button>
          <small class="real-estate-next-step"
            >Next: review the property details and personalize your TalkThru.</small
          >
          <button type="submit" class="boards-primary-action" [disabled]="!url()">
            <span class="material-symbols-outlined">auto_awesome</span>Analyze listing
          </button>
        </div>
      </form>
    </section>
  </div>`,
})
class WizardPreview {
  url = signal('');
  style = signal<BoardNarrationStyleId>('storyteller');
  seconds = signal(5);
  count = 12;
}

describe('Real estate source form', () => {
  let preview: HTMLElement | null = null;
  let styles: Node[] = [];
  // Optional local visual fixture: /debug.html?property-preview=1. No Firebase calls.
  afterAll(() => {
    if (!preview) return;
    document.body.replaceChildren(preview);
    document.head.append(...styles);
    document.body.style.margin = '0';
    for (const href of [
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
      'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap',
    ]) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.append(link);
    }
  });
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WizardPreview],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });
  async function render() {
    const fixture = TestBed.createComponent(WizardPreview);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }
  it('shows a focused URL and narration form without generic board controls', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('input[type=url]').length).toBe(1);
    expect(host.querySelectorAll('select option').length).toBe(5);
    expect(host.textContent).toContain('Estimated TalkThru: ~1 min');
    expect(host.textContent).toContain('~12 words per card');
    expect((host.querySelector('input[type=radio]:checked') as HTMLInputElement).value).toBe('5');
    for (const removed of ['Card visuals', 'Default card type', 'Vibe'])
      expect(host.textContent).not.toContain(removed);
    expect(host.querySelector('details')!.open).toBeFalse();
    if (location.search.includes('property-preview=1')) {
      preview = host.cloneNode(true) as HTMLElement;
      styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) =>
        node.cloneNode(true),
      );
    }
  });
  it('updates the parent URL and keeps browser URL validation', async () => {
    const fixture = await render();
    const input = fixture.nativeElement.querySelector('input[type=url]') as HTMLInputElement;
    input.value = 'not a url';
    input.dispatchEvent(new Event('input'));
    expect(input.checkValidity()).toBeFalse();
    input.value = 'https://example.com/home';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.url()).toBe('https://example.com/home');
    expect(input.checkValidity()).toBeTrue();
    expect(fixture.nativeElement.querySelector('button[type=submit]').disabled).toBeFalse();
  });
  it('preserves every narration style and updates its starting voice', async () => {
    const fixture = await render();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'guided-tour';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(fixture.componentInstance.style()).toBe('guided-tour');
    expect(fixture.nativeElement.textContent).toContain('Friendly Explainer');
    expect(
      fixture.nativeElement.querySelector('#property-style-description').textContent,
    ).toContain('Speaks directly');
  });
  it('updates duration and estimates through accessible native presets', async () => {
    const fixture = await render();
    const radio = fixture.nativeElement.querySelector(
      'input[type=radio][value="30"]',
    ) as HTMLInputElement;
    radio.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.seconds()).toBe(30);
    expect(fixture.nativeElement.textContent).toContain('Estimated TalkThru: ~6 min');
    expect(fixture.nativeElement.querySelectorAll('input[type=radio]:checked').length).toBe(1);
  });
  it('restores a custom duration and sends range changes back to the wizard', async () => {
    const fixture = await render();
    fixture.componentInstance.seconds.set(75);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('details').open).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('1 min 15 sec per card');
    const slider = fixture.nativeElement.querySelector('input[type=range]') as HTMLInputElement;
    slider.value = '90';
    slider.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.seconds()).toBe(90);
    expect(slider.getAttribute('aria-valuetext')).toBe('1 min 30 sec per card');
  });
});

describe('Real estate doorway defaults', () => {
  function harness(): any {
    return Object.assign(Object.create(BoardsComponent.prototype), {
      wizardEntryIntent: signal('default'),
      wizardSaveDestination: signal('board'),
      wizardPhotoStudioNotice: signal(''),
      wizardMode: signal('url'),
      wizardTargetBoardId: signal('old-board'),
      wizardDefaultType: signal('food'),
      wizardMediaMode: signal('videos'),
      wizardVibe: signal('foodie'),
      wizardStep: signal('choose'),
      wizardCount: signal(12),
      wizardCountMode: signal('auto'),
      wizardNarrationSecondsPerCard: signal(30),
      wizardNarrationLengthCustomized: signal(false),
    });
  }
  it('does not inherit hidden visual and card-type choices from another board', () => {
    const page = harness();
    page.chooseWizardMode('url', 'real-estate');
    expect(page.wizardDefaultType()).toBe('place');
    expect(page.wizardMediaMode()).toBe('images');
    expect(page.wizardVibe()).toBe('curator');
    expect(page.wizardTargetBoardId()).toBe('new');
    expect(page.wizardStep()).toBe('configure');
    expect(page.wizardNarrationSecondsPerCard()).toBe(5);
    expect(page.wizardNarrationLengthCustomized()).toBeFalse();
    expect(page.wizardNarrationSecondsForGeneration()).toBe(5);
  });
  it('keeps Quick when the card count changes', () => {
    const page = harness();
    page.chooseWizardMode('url', 'real-estate');
    page.setWizardCount(40);
    expect(page.wizardNarrationSecondsPerCard()).toBe(5);
  });
  it('restores the ordinary default when switching away from real estate', () => {
    const page = harness();
    page.chooseWizardMode('url', 'real-estate');
    page.chooseWizardMode('url', 'default');
    expect(page.wizardNarrationSecondsPerCard()).toBe(30);
    page.setWizardCount(40);
    expect(page.wizardNarrationSecondsPerCard()).toBe(15);
  });
  for (const seconds of [30, 75, 180]) {
    it(`preserves a chosen or restored ${seconds}-second duration`, () => {
      const page = harness();
      page.setWizardNarrationSeconds(seconds);
      page.chooseWizardMode('url', 'real-estate');
      page.setWizardCount(40);
      expect(page.wizardNarrationSecondsPerCard()).toBe(seconds);
    });
  }
  for (const intent of ['default', 'rental']) {
    it(`leaves existing ${intent} URL settings intact`, () => {
      const page = harness();
      page.chooseWizardMode('url', intent);
      expect(page.wizardDefaultType()).toBe('food');
      expect(page.wizardMediaMode()).toBe('videos');
      expect(page.wizardTargetBoardId()).toBe('old-board');
      expect(page.wizardNarrationSecondsPerCard()).toBe(30);
    });
  }
});
