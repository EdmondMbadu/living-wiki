import { BoardTranslationCache, mergeBoardTranslationProgress } from './board-translation-cache';
import {
  applyBoardTranslation,
  boardAlreadyInEnglish,
  BOARD_TRANSLATION_LANGUAGES,
  boardTranslationLanguageForRoute,
  isBoardTranslationLanguage,
  normalizeBoardTranslationResult,
} from './board-translation';
import { SUPPORTED_LOCALES, supportedLocale } from '../i18n/locales';
import { CONTENT_LANGUAGES, contentLanguageForLocale } from '../../../functions/src/content-language';

describe('board translation overlay', () => {
  it('uses the same native language names as the site language switcher', () => {
    for (const language of BOARD_TRANSLATION_LANGUAGES.filter((item) => SUPPORTED_LOCALES.some((locale) => locale.language === item.id))) {
      expect(language.label).toBe(supportedLocale(language.id).label);
    }
  });
  for (const [locale, language] of [['fr', 'fr'], ['ja', 'ja'], ['pt-BR', 'pt'], ['es-419', 'es'], ['de', 'de'], ['zh-Hans', 'zh']] as const) {
    it(`translates plain ${locale} board links and honors explicit content choices`, () => {
      expect(boardTranslationLanguageForRoute(null, locale)).toBe(language);
      expect(boardTranslationLanguageForRoute('unsupported', locale)).toBe(language);
      expect(boardTranslationLanguageForRoute('original', locale)).toBeNull();
      expect(boardTranslationLanguageForRoute('en', locale)).toBe('en');
    });
  }

  it('maps all twelve visitor languages and their localized interfaces', () => {
    expect(CONTENT_LANGUAGES.length).toBe(12);
    for (const language of CONTENT_LANGUAGES) {
      expect(isBoardTranslationLanguage(language.id)).toBeTrue();
      expect(contentLanguageForLocale(language.locale.replace('-', '_'))).toBe(language.id);
      expect(boardTranslationLanguageForRoute(language.id, 'en-US')).toBe(language.id);
    }
    expect(contentLanguageForLocale('AR_eg')).toBe('ar');
    expect(contentLanguageForLocale('ko-KR')).toBe('ko');
    expect(contentLanguageForLocale('unsupported')).toBeNull();
    expect(isBoardTranslationLanguage('ar-SA')).toBeFalse();
    expect(isBoardTranslationLanguage('__proto__')).toBeFalse();
  });

  it('keeps English links in their authored language and allows explicit translations', () => {
    expect(boardTranslationLanguageForRoute(null, 'en-US')).toBeNull();
    expect(boardTranslationLanguageForRoute('es', 'en-US')).toBe('es');
    expect(boardTranslationLanguageForRoute('fr', 'es-419')).toBe('fr');
  });

  it('recognizes English without treating the fallback for short foreign text as proof', () => {
    const english = { title: 'Museum stories', description: 'This is the story of our city and the people who lived here.' };
    expect(boardAlreadyInEnglish(english)).toBeTrue();
    expect(boardAlreadyInEnglish({title: 'Bonjour'})).toBeFalse();
    expect(boardAlreadyInEnglish({title: 'Une promenade dans la ville avec les lieux et des histoires.'})).toBeFalse();
    expect(boardAlreadyInEnglish({...english, cards: [{id: 'one', notes: 'يقدم هذا المتحف تاريخ المدينة.'}]})).toBeFalse();
    expect(boardAlreadyInEnglish({...english, cards: [{id: 'one', notes: 'Bonjour', authorOnly: true}]})).toBeTrue();
    expect(boardAlreadyInEnglish({...english, cards: [{id: 'one', conversation: {openingMessage: 'Une promenade dans la ville avec les lieux et des histoires.'}}]})).toBeFalse();
    expect(boardAlreadyInEnglish({...english, learningQuiz: {title: '这个博物馆'}})).toBeFalse();
  });

  it('changes only approved text fields and preserves links and exact locations', () => {
    const board = {
      title: 'Places',
      description: 'A guide',
      stackCtaLabel: 'Go there',
      stackCtaUrl: 'https://example.com/go',
      cards: [{
        id: 'plaza',
        title: 'Steinbeck Plaza',
        notes: 'Meet here.',
        googleMapsUrl: 'https://maps.google.com/example',
        what3wordsAddress: '///candy.sage.sticks',
        price: '$10',
        tags: ['historic'],
      }],
    };

    const translated = applyBoardTranslation(board, [
      { key: 'board.title', text: 'Lieux' },
      { key: 'cardsById.plaza.notes', text: 'Rendez-vous ici.' },
      { key: 'cardsById.plaza.tags.0', text: 'histoire' },
      { key: 'cardsById.plaza.googleMapsUrl', text: 'https://malicious.example' },
      { key: 'cardsById.plaza.what3wordsAddress', text: '///wrong.words.here' },
    ]);

    expect(translated.title).toBe('Lieux');
    expect(translated.cards[0].notes).toBe('Rendez-vous ici.');
    expect(translated.cards[0].googleMapsUrl).toBe(board.cards[0].googleMapsUrl);
    expect(translated.cards[0].what3wordsAddress).toBe(board.cards[0].what3wordsAddress);
    expect(translated.cards[0].price).toBe('$10');
    expect(translated.cards[0].tags).toEqual(['historic']);
    expect(board.title).toBe('Places');
    expect(board.cards[0].notes).toBe('Meet here.');
  });

  it('rejects malformed callable responses and unsafe segment paths', () => {
    expect(normalizeBoardTranslationResult({ boardId: 'board-1' })).toBeNull();

    const result = normalizeBoardTranslationResult({
      boardId: 'board-1',
      targetLanguage: 'ja',
      sourceLanguage: 'en',
      fingerprint: 'fingerprint',
      schemaVersion: 3,
      expectedSegmentCount: 1,
      cached: true,
      changed: true,
      segments: [
        { key: 'board.title', text: '場所' },
        { key: '__proto__.polluted', text: 'yes' },
        { key: 'cardsById.plaza.productUrl', text: 'https://wrong.example' },
      ],
    });

    expect(result?.segments).toEqual([{ key: 'board.title', text: '場所' }]);
  });

  it('accepts Brazilian Portuguese board translations', () => {
    expect(isBoardTranslationLanguage('pt')).toBeTrue();
    expect(normalizeBoardTranslationResult({
      boardId: 'board-1',
      targetLanguage: 'pt',
      sourceLanguage: 'en',
      fingerprint: 'fingerprint',
      schemaVersion: 3,
      expectedSegmentCount: 1,
      segments: [{ key: 'board.title', text: 'Lugares' }],
    })?.segments).toEqual([{ key: 'board.title', text: 'Lugares' }]);
  });

  it('accepts Spanish board translations', () => {
    expect(isBoardTranslationLanguage('es')).toBeTrue();
    expect(normalizeBoardTranslationResult({
      boardId: 'board-1', targetLanguage: 'es', sourceLanguage: 'en',
      fingerprint: 'fingerprint', schemaVersion: 3, expectedSegmentCount: 1,
      segments: [{ key: 'board.title', text: 'Lugares' }],
    })?.targetLanguage).toBe('es');
  });

  it('matches cards by ID after author-only cards are filtered', () => {
    const board = { cards: [{ id: 'public-card', title: 'The house' }] };
    expect(applyBoardTranslation(board, [
      { key: 'cardsById.public-card.title', text: 'A casa' },
    ]).cards[0].title).toBe('A casa');
    expect(normalizeBoardTranslationResult({
      boardId: 'board-1', targetLanguage: 'pt', sourceLanguage: 'en',
      fingerprint: 'fingerprint', schemaVersion: 3, expectedSegmentCount: 2,
      segments: [{ key: 'board.title', text: 'A casa' }],
    })).toBeNull();
  });
});

describe('progressive board translation cache', () => {
  const result = {boardId:'board-123', targetLanguage:'fr', sourceLanguage:'en', fingerprint:'hash',
    schemaVersion:3, expectedSegmentCount:1, segments:[{key:'board.title',text:'Musée'}], cached:false, changed:true} as const;
  it('restores completed text after a locale reload and rejects edited source', () => {
    const values = new Map<string,string>();
    const storage = {getItem:(key:string)=>values.get(key)??null, setItem:(key:string,value:string)=>{values.set(key,value);}};
    const first = new BoardTranslationCache(storage);
    first.put('board-123:v1:fr','original source',{...result,segments:[...result.segments]});
    const reloaded = new BoardTranslationCache(storage);
    expect(reloaded.get('board-123:v1:fr','original source')?.segments[0].text).toBe('Musée');
    expect(reloaded.get('board-123:v1:fr','original source')?.cached).toBeTrue();
    expect(reloaded.get('board-123:v1:fr','edited source')).toBeNull();
    expect(reloaded.get('board-123:v1:de','original source')).toBeNull();
  });
  it('remains usable when storage is unavailable and bounds retained translations', () => {
    const cache = new BoardTranslationCache({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
    for(let i=0;i<15;i++) cache.put(`key-${i}`,'source',{...result,segments:[...result.segments]});
    expect(cache.get('key-0','source')).toBeNull();
    expect(cache.get('key-14','source')?.segments.length).toBe(1);
  });
  it('merges completed sections without losing earlier text and rejects a different revision', () => {
    const first = {...result,segments:[...result.segments]};
    const second = {...result,segments:[{key:'board.description',text:'Une histoire'}]};
    const merged = mergeBoardTranslationProgress(first,second);
    expect(merged.expectedSegmentCount).toBe(2);
    expect(merged.segments.map(item=>item.key)).toEqual(['board.title','board.description']);
    expect(()=>mergeBoardTranslationProgress(first,{...second,fingerprint:'changed'})).toThrow();
  });
});
