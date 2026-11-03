import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { defineSecret } from 'firebase-functions/params';
import { contentLanguageDetails } from './content-language';
import { missingBoardTranslationSegments, normalizeTranslatedBoardSegments, type BoardTranslationLanguage, type BoardTranslationSegment } from './board-translation';
import { translateInBatches } from './translation-batches';

export const geminiApiKey = defineSecret('GEMINI_API_KEY');
export const BOARD_TRANSLATION_MODEL = 'gemini-3.1-flash-lite';
let client: GoogleGenAI | undefined;
const schema = { type: 'array', items: { type: 'object', properties: {
  key: { type: 'string' }, text: { type: 'string' },
}, required: ['key', 'text'] } } as const;

export async function translateBoardTextSegments(
  segments: readonly BoardTranslationSegment[],
  language: BoardTranslationLanguage,
  onBatch?: (segments: BoardTranslationSegment[]) => Promise<void> | void,
): Promise<BoardTranslationSegment[]> {
  return translateInBatches(segments, async (group) => {
    client ??= new GoogleGenAI({ apiKey: geminiApiKey.value(), httpOptions: {timeout: 30_000} });
    const translated: BoardTranslationSegment[] = [];
    let remaining = group;
    for (let attempt = 0; attempt < 3 && remaining.length; attempt++) {
      const parameters = {
        model: BOARD_TRANSLATION_MODEL,
        contents: [
          `Translate every text value faithfully into natural ${contentLanguageDetails(language).name}.`,
          'Return one JSON object per input key. Keep keys byte-for-byte unchanged. No commentary, summarizing, embellishment or added facts.',
          'Preserve paragraph breaks, URLs, email addresses, @handles, hashtags, prices, measurements, catalog numbers, emoji and what3words addresses.',
          'Keep product, artist, person, venue and place names in their established form unless they have a standard name in the target language.',
          JSON.stringify(remaining),
        ].join('\n\n'),
        config: { responseMimeType: 'application/json', responseJsonSchema: schema,
          temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
      };
      const result = await generate(parameters);
      const parsed: unknown = JSON.parse((result.text ?? '[]').replace(/^```(?:json)?\s*|\s*```$/gu, ''));
      if (Array.isArray(parsed)) translated.push(...parsed);
      remaining = missingBoardTranslationSegments(group, translated);
    }
    return normalizeTranslatedBoardSegments(group, translated);
  }, onBatch);
}

async function generate(parameters: Parameters<GoogleGenAI['models']['generateContent']>[0]) {
  for (let attempt = 0; ; attempt++) {
    try { return await client!.models.generateContent(parameters); }
    catch (error) {
      const status = (error as {status?: number})?.status;
      if (attempt >= 1 || !status || ![429, 500, 502, 503, 504].includes(status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
