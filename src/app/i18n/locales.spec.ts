import { localizedPath, SUPPORTED_LOCALES, supportedLocale } from './locales';

describe('locale routing', () => {
  const english = SUPPORTED_LOCALES[0];
  const french = SUPPORTED_LOCALES[1];
  const japanese = SUPPORTED_LOCALES[2];
  const portuguese = SUPPORTED_LOCALES[3];
  const spanish = SUPPORTED_LOCALES[4];

  it('recognizes locale IDs and language codes', () => {
    expect(supportedLocale('fr')).toBe(french);
    expect(supportedLocale('ja')).toBe(japanese);
    expect(supportedLocale('pt')).toBe(portuguese);
    expect(supportedLocale('pt-BR')).toBe(portuguese);
    expect(supportedLocale('es')).toBe(spanish);
    expect(supportedLocale('es-419')).toBe(spanish);
    expect(spanish.subPath).toBe('es');
    expect(supportedLocale('unsupported')).toBe(english);
  });

  it('adds and replaces locale prefixes while preserving the route', () => {
    expect(localizedPath('/home', french)).toBe('/fr/home');
    expect(localizedPath('/fr/boards/123', japanese)).toBe('/ja/boards/123');
    expect(localizedPath('/ja/chat/philly', english)).toBe('/chat/philly');
    expect(localizedPath('/fr/boards/123', portuguese)).toBe('/pt/boards/123');
    expect(localizedPath('/pt/boards/123', japanese)).toBe('/ja/boards/123');
    expect(localizedPath('/pt/boards/123', english)).toBe('/boards/123');
    expect(localizedPath('/boards/123', spanish)).toBe('/es/boards/123');
    expect(localizedPath('/es/boards/123', portuguese)).toBe('/pt/boards/123');
    expect(localizedPath('/es/teams/abc', english)).toBe('/teams/abc');
    // A route that merely starts with "es" is not a locale prefix.
    expect(localizedPath('/essays', french)).toBe('/fr/essays');
  });

  it('handles locale roots', () => {
    expect(localizedPath('/', french)).toBe('/fr/');
    expect(localizedPath('/fr', english)).toBe('/');
    expect(localizedPath('/ja/', japanese)).toBe('/ja/');
    expect(localizedPath('/', portuguese)).toBe('/pt/');
    expect(localizedPath('/pt', english)).toBe('/');
    expect(localizedPath('/', spanish)).toBe('/es/');
    expect(localizedPath('/es', english)).toBe('/');
  });
  it('recognizes German and Simplified Chinese browser locale variants', () => {
    for (const locale of ['de', 'de-DE', 'de_AT']) {
      expect(supportedLocale(locale).language).toBe('de');
    }
    for (const locale of ['zh', 'zh-CN', 'zh-Hans', 'zh_Hans_CN']) {
      expect(supportedLocale(locale).id).toBe('zh-Hans');
    }
    expect(supportedLocale('de').label).toBe('Deutsch');
    expect(supportedLocale('zh').label).toBe('简体中文');
  });

  it('replaces every supported locale prefix without losing a nested route', () => {
    for (const from of SUPPORTED_LOCALES) {
      const route = `${from.subPath ? '/' + from.subPath : ''}/boards/board-a`;
      for (const to of SUPPORTED_LOCALES) {
        expect(localizedPath(route, to)).toBe(`${to.subPath ? '/' + to.subPath : ''}/boards/board-a`);
        expect(localizedPath(from.subPath ? '/' + from.subPath : '/', to)).toBe(to.subPath ? '/' + to.subPath + '/' : '/');
      }
    }
    expect(localizedPath('/details', supportedLocale('zh'))).toBe('/zh/details');
    expect(localizedPath('/zhuang', supportedLocale('de'))).toBe('/de/zhuang');
  });

});
