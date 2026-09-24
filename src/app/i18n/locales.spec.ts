import { localizedPath, SUPPORTED_LOCALES, supportedLocale } from './locales';

describe('locale routing', () => {
  const english = SUPPORTED_LOCALES[0];
  const french = SUPPORTED_LOCALES[1];
  const japanese = SUPPORTED_LOCALES[2];
  const portuguese = SUPPORTED_LOCALES[3];

  it('recognizes locale IDs and language codes', () => {
    expect(supportedLocale('fr')).toBe(french);
    expect(supportedLocale('ja')).toBe(japanese);
    expect(supportedLocale('pt')).toBe(portuguese);
    expect(supportedLocale('pt-BR')).toBe(portuguese);
    expect(supportedLocale('unsupported')).toBe(english);
  });

  it('adds and replaces locale prefixes while preserving the route', () => {
    expect(localizedPath('/home', french)).toBe('/fr/home');
    expect(localizedPath('/fr/boards/123', japanese)).toBe('/ja/boards/123');
    expect(localizedPath('/ja/chat/philly', english)).toBe('/chat/philly');
    expect(localizedPath('/fr/boards/123', portuguese)).toBe('/pt/boards/123');
    expect(localizedPath('/pt/boards/123', japanese)).toBe('/ja/boards/123');
    expect(localizedPath('/pt/boards/123', english)).toBe('/boards/123');
  });

  it('handles locale roots', () => {
    expect(localizedPath('/', french)).toBe('/fr/');
    expect(localizedPath('/fr', english)).toBe('/');
    expect(localizedPath('/ja/', japanese)).toBe('/ja/');
    expect(localizedPath('/', portuguese)).toBe('/pt/');
    expect(localizedPath('/pt', english)).toBe('/');
  });
});
