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
  });
});
