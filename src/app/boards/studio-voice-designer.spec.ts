import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PersonalVoiceService, type PersonalVoice, type PersonalVoiceLibrary, type StudioVoiceDesign } from '../personal-voice.service';
import { StudioVoiceDesigner } from './studio-voice-designer';

describe('Studio voice designer', () => {
  const provider = jasmine.createSpyObj<PersonalVoiceService>('PersonalVoiceService', ['designStudioVoice', 'saveStudioVoice']);
  const previews = [0, 1, 2].map((index) => ({ index, contentType: 'audio/mpeg', audioBase64: 'AAAA' }));
  const voice = { id: 'flamingo', name: 'Flamingo', source: 'designed', narratorVoiceId: 'personal-voice:flamingo' } as PersonalVoice;

  beforeEach(() => {
    provider.designStudioVoice.calls.reset();
    provider.saveStudioVoice.calls.reset();
    provider.designStudioVoice.and.resolveTo({ sessionId: 'preview-session', previewText: 'The same text for every preview.', previews });
    provider.saveStudioVoice.and.resolveTo({ voice, voices: [voice] } as PersonalVoiceLibrary);
    TestBed.configureTestingModule({
      imports: [StudioVoiceDesigner],
      providers: [provideZonelessChangeDetection(), { provide: PersonalVoiceService, useValue: provider }],
    });
  });

  it('lets the user try an example, choose a preview, save it, and explicitly apply it to the board', async () => {
    const fixture = TestBed.createComponent(StudioVoiceDesigner);
    const saved = jasmine.createSpy('saved');
    const use = jasmine.createSpy('use');
    fixture.componentInstance.voiceSaved.subscribe(saved);
    fixture.componentInstance.useVoice.subscribe(use);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const button = (label: string) => Array.from(root.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === label)!;

    root.querySelector('details')!.open = true;
    expect(button('Generate previews').disabled).toBeTrue();
    button('Flamingo').click();
    fixture.detectChanges();
    button('Generate previews').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(provider.designStudioVoice).toHaveBeenCalledWith(jasmine.stringMatching(/flamingo.*higher register/i), 'en');
    expect(root.querySelectorAll('audio').length).toBe(3);
    expect(button('Save to My voices').disabled).toBeTrue();
    root.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click();
    fixture.detectChanges();
    let completeSave!: (library: PersonalVoiceLibrary) => void;
    provider.saveStudioVoice.and.returnValue(new Promise((resolve) => { completeSave = resolve; }));
    const saveButton = button('Save to My voices');
    saveButton.click();
    fixture.detectChanges();
    expect(saveButton.textContent?.trim()).toBe('Saving your voice…');
    expect(saveButton.querySelector('.designer__spinner')).not.toBeNull();
    expect(saveButton.getAttribute('aria-disabled')).toBe('true');
    saveButton.click();
    expect(saved).not.toHaveBeenCalled();

    completeSave({ voice, voices: [voice] } as PersonalVoiceLibrary);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(provider.saveStudioVoice).toHaveBeenCalledOnceWith('preview-session', 1, 'Flamingo');
    expect(root.textContent).toContain('Flamingo is saved in My voices');
    expect(saved).toHaveBeenCalledWith(jasmine.objectContaining({ voice }));
    expect(use).not.toHaveBeenCalled();
    button('Use as board voice').click();
    expect(use).toHaveBeenCalledOnceWith(voice);
  });

  it('clears an old preview selection when the description changes', async () => {
    const fixture = TestBed.createComponent(StudioVoiceDesigner);
    fixture.detectChanges();
    const designer = fixture.componentInstance;
    designer.useExample(designer.examples[0]);
    await designer.generate();
    designer.selectedIndex.set(0);
    designer.useExample(designer.examples[1]);
    await designer.save();

    expect(designer.previews()).toEqual([]);
    expect(provider.saveStudioVoice).not.toHaveBeenCalled();
  });

  it('keeps the preview area visible and prevents duplicate requests while regenerating', async () => {
    const fixture = TestBed.createComponent(StudioVoiceDesigner);
    const designer = fixture.componentInstance;
    designer.useExample(designer.examples[0]);
    await designer.generate();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector('details')!.open = true;
    const previewArea = root.querySelector('fieldset');
    const generate = root.querySelector<HTMLButtonElement>('.designer__generate')!;
    let complete!: (result: StudioVoiceDesign) => void;
    provider.designStudioVoice.and.returnValue(new Promise((resolve) => { complete = resolve; }));

    generate.click();
    fixture.detectChanges();
    expect(generate.textContent?.trim()).toBe('Generating...');
    expect(generate.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('fieldset')).toBe(previewArea);
    expect(previewArea?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelectorAll('audio').length).toBe(0);
    generate.click();
    expect(provider.designStudioVoice).toHaveBeenCalledTimes(2);

    complete({ sessionId: 'next-session', previewText: 'A new sample.', previews });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(generate.textContent?.trim()).toBe('Generate new options');
    expect(root.querySelectorAll('audio').length).toBe(3);
  });
});
