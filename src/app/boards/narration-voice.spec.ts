import { browserNarrationVoice } from './narration-voice';

describe('browser narration voice', () => {
  const voices = [{ lang: 'en-US' }, { lang: 'pt-PT' }, { lang: 'pt-BR' }, { lang: 'ja-JP' }];

  it('selects the requested regional voice before another regional accent', () => {
    expect(browserNarrationVoice(voices, 'pt')).toBe(voices[2]);
    const spanishVoices = [{ lang: 'es-ES' }, { lang: 'es-US' }, { lang: 'es-MX' }];
    expect(browserNarrationVoice(spanishVoices, 'es')).toBe(spanishVoices[1]);
    expect(browserNarrationVoice([{ lang: 'es-MX' }], 'es')?.lang).toBe('es-MX');
  });

  it('does not substitute an English voice for translated speech', () => {
    expect(browserNarrationVoice(voices, 'fr')).toBeNull();
    for (const language of ['fr', 'ja', 'pt', 'es'] as const) {
      expect(browserNarrationVoice([{ lang: 'en-US' }], language)).toBeNull();
      const matching = { lang: ({ fr: 'fr-FR', ja: 'ja-JP', pt: 'pt-BR', es: 'es-MX' } as const)[language] };
      expect(browserNarrationVoice([{ lang: 'en-US' }, matching], language)).toBe(matching);
    }
  });
});
