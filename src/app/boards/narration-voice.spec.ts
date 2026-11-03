import { CONTENT_LANGUAGES } from '../../../functions/src/content-language';
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
    for (const details of CONTENT_LANGUAGES.filter(({ id }) => id !== 'en')) {
      const language = details.id;
      expect(browserNarrationVoice([{ lang: 'en-US' }], language)).toBeNull();
      const matching = { lang: details.locale };
      expect(browserNarrationVoice([{ lang: 'en-US' }, matching], language)).toBe(matching);
    }
  });
  it('keeps Chinese fallback narration in Mandarin rather than Cantonese', () => {
    const voices = [{ lang: 'zh-HK' }, { lang: 'zh-TW' }, { lang: 'zh-CN' }];
    expect(browserNarrationVoice(voices, 'zh')).toBe(voices[2]);
    expect(browserNarrationVoice(voices.slice(0, 2), 'zh')).toBeNull();
    expect(browserNarrationVoice([{ lang: 'zh-Hans' }], 'zh')?.lang).toBe('zh-Hans');
    expect(browserNarrationVoice([{ lang: 'cmn-CN' }], 'zh')?.lang).toBe('cmn-CN');
  });

});
