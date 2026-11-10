import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PersonalVoiceService, type PersonalVoice, type PersonalVoiceLibrary } from '../personal-voice.service';
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
    button('Save to My voices').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(provider.saveStudioVoice).toHaveBeenCalledOnceWith('preview-session', 1, 'Flamingo');
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
});
