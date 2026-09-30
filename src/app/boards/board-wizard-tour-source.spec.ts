import { signal } from '@angular/core';
import { BoardsComponent } from './boards';
import { parseTourItinerary, tourItineraryInputError, TOUR_SOURCE_MAX_LENGTH } from './board-wizard-tour-source';
import { boardWizardDraftPayloadWithPreferences } from './board-wizard-draft-persistence';
import fixture from '../../../tests/fixtures/london-eagles-tour.json';

describe('authored tour itinerary import', () => {
  it('recognizes the full nine-stop London script and its separate hotel return', () => {
    const source = parseTourItinerary(fixture.script)!;
    expect(fixture.script.length).toBeGreaterThan(2200);
    expect(tourItineraryInputError(fixture.script)).toBe('');
    expect(source.items.length).toBe(9);
    expect(source.items[8].returnToIndex).toBe(0);
    expect(source.items[8].guideScript).toContain('Go Birds!');
    expect(source.items[1].guideScript).toMatch(/^Meet Samuel Pepys/);
    expect(source.items[1].guideScript).not.toContain('Stop near');
    expect(source.items[0].guideScript).not.toContain('Next:');
    expect(source.items[0].durationText).toBe('2–3 minutes');
  });

  it('treats supplied coordinates as stop metadata instead of spoken narration', () => {
    const source = parseTourItinerary('1. Hotel\nAddress: 7 Pepys Street, London\nLatitude: 51.51078\nLongitude: -0.07830\nWelcome.\nNext: Walk to the bridge.\n2. Bridge\nLatitude: 51.50689\nLongitude: -0.07492\nLook at the Thames.')!;
    expect(source.items.map(stop => [stop.lat, stop.lng])).toEqual([[51.51078, -0.07830], [51.50689, -0.07492]]);
    expect(source.items[0].address).toBe('7 Pepys Street, London');
    expect(source.items[0].guideScript).toBe('Welcome.');
    expect(tourItineraryInputError('1. Hotel\nLatitude: 51.5\nWelcome.\n2. Bridge\nLook around.')).toContain('Latitude and Longitude');
  });

  it('updates the tour count from the source and retains oversized input for correction', () => {
    const c: any = Object.create(BoardsComponent.prototype);
    Object.assign(c, { isTourWizardMode: () => true, wizardPrompt: signal(''),
      wizardNarrationLengthCustomized: () => false, wizardNarrationSecondsPerCard: signal(30),
      setWizardCount: jasmine.createSpy('count') });
    c.updateWizardPrompt(fixture.script);
    expect(c.wizardPrompt()).toBe(fixture.script);
    expect(c.setWizardCount).toHaveBeenCalledWith(9, false);
    const oversized = fixture.script + 'x'.repeat(TOUR_SOURCE_MAX_LENGTH);
    c.updateWizardPrompt(oversized);
    expect(c.wizardPrompt()).toBe(oversized);
    expect(tourItineraryInputError(c.wizardPrompt())).toContain('30,000');
  });

  it('retains the complete source in a saved draft payload', () => {
    const payload = boardWizardDraftPayloadWithPreferences({ mode: 'walking-tour', prompt: fixture.script,
      result: { cards: [] } }, 'images');
    const restored = JSON.parse(JSON.stringify(payload));
    expect(restored.prompt).toBe(fixture.script);
    expect(parseTourItinerary(restored.prompt)?.items.length).toBe(9);
  });

  it('keeps every narration and direction through the card persistence normalizer', () => {
    const c: any = Object.create(BoardsComponent.prototype);
    const source = parseTourItinerary(fixture.script)!;
    for (const [index, stop] of source.items.entries()) {
      const tour = c.normalizeCardTour({ sequence: stop.rank, guideScript: stop.guideScript,
        lat: null, lng: null, address: '', legToNext: index < 8 ? {
          instruction: stop.nextInstruction, navScript: 'Continue to the next stop.',
          durationText: stop.durationText, distanceText: '', encodedPolyline: '',
        } : null });
      expect(tour.guideScript).toBe(stop.guideScript);
      expect(tour.sequence).toBe(stop.rank);
      expect(tour.legToNext?.instruction ?? '').toBe(stop.nextInstruction);
    }
  });

  it('opens the editor instead of replacing an authored stop with a different generated place', async () => {
    const c: any = Object.create(BoardsComponent.prototype);
    c.wizardTourSource = () => parseTourItinerary(fixture.script);
    c.openWizardCardEditor = jasmine.createSpy('edit stop');
    c.requestWizardBatch = jasmine.createSpy('generate');
    await c.redoWizardCard('stop-8');
    expect(c.openWizardCardEditor).toHaveBeenCalledOnceWith('stop-8');
    expect(c.requestWizardBatch).not.toHaveBeenCalled();
  });
});
