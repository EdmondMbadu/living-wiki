import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';
import { logger } from 'firebase-functions';
import { db } from './firebase';
import type { PreparedListingPhoto } from './board-wizard-listing-uploads';
import {
  analyzeBoardWizardListingPhotos,
  generateBoardWizardListingStory,
  type BoardWizardListingPhotoAnalysis,
  type BoardWizardListingStoryScene,
  type GeneratedBoardWizardBatch,
  type GeneratedBoardWizardCard,
} from './gemini';
import {
  BOARD_WIZARD_SOURCE_GALLERY_LIMIT,
  boardWizardListingFurnishingsIncluded,
  buildBoardWizardListingBatch,
  normalizeBoardWizardListingIntent,
  type BoardWizardListingExtraction,
  type BoardWizardListingImage,
  type BoardWizardListingIntent,
} from './board-wizard-listing';
import type { BoardNarrationStyleId } from './board-wizard-narration';
import { boardNarrationTargetWords } from './board-narration-length';
import { fitNarrationToWords, isFinishedNarration, narrationSummary, narrationNumberTokens } from './narration-text';
import {
  buildListingCopyPlan, DISALLOWED_STORY_SCENES, LISTING_GROUP_DEFINITIONS,
  listingPhotoGroups, listingGroupKey, orderedListingGroupPhotos, normalizeListingStoryRole,
  type ListingGroupKey, type ListingPhotoGroup,
} from './board-wizard-copy-plan';

export type BoardWizardListingMarketingStyle = 'warm' | 'guided' | 'luxury' | 'brisk' | 'investor';

export type BoardWizardListingMarketingOptions = {
  enabled: boolean;
  personalized: boolean;
  style: BoardWizardListingMarketingStyle;
  direction: string;
  propertyType: string;
  introMessage: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  agency: string;
  showContactOnClosingCard: boolean;
};

export type BoardWizardListingPreview = {
  kind: 'real-estate' | 'rental';
  listingName: string;
  address: string;
  price: string;
  status: string;
  propertyType: string;
  bedrooms: string;
  bathrooms: string;
  mlsId: string;
  imageCount: number;
  imageUrl: string;
  contactName: string;
  contactRole: string;
  brokerage: string;
  siteName: string;
  confidence: number;
};

const PHOTO_ANALYSIS_VERSION = 'listing-photo-v2-furnishings';
const STORY_VERSION = 'listing-story-v3-group-copy';
const PHOTO_BATCH_SIZE = 10;
const MAX_ANALYZED_PHOTOS = 48;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LISTING_PRESENTATION_IMAGE_LIMIT = 4;

export function normalizeBoardWizardListingMarketingOptions(value: unknown): BoardWizardListingMarketingOptions {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const style: BoardWizardListingMarketingStyle = record.style === 'guided'
    || record.style === 'luxury'
    || record.style === 'brisk'
    || record.style === 'investor'
    ? record.style
    : 'warm';
  return {
    enabled: record.enabled !== false,
    personalized: record.personalized === true,
    style,
    direction: cleanText(record.direction, 500),
    propertyType: cleanText(record.propertyType, 100),
    introMessage: cleanMultilineText(record.introMessage, 800),
    contactName: cleanText(record.contactName, 140),
    contactEmail: normalizedContactEmail(record.contactEmail),
    contactPhone: normalizedContactPhone(record.contactPhone),
    agency: cleanText(record.agency, 160),
    showContactOnClosingCard: record.showContactOnClosingCard !== false,
  };
}

function normalizedContactEmail(value: unknown): string {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizedContactPhone(value: unknown): string {
  const phone = cleanText(value, 40);
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d().\-\s]+$/.test(phone) ? phone : '';
}

function cleanMultilineText(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, max)
    : '';
}

function personalizedListingExtraction(
  extraction: BoardWizardListingExtraction,
  marketing: BoardWizardListingMarketingOptions,
): BoardWizardListingExtraction {
  const exposePersonalContact = !marketing.personalized || marketing.showContactOnClosingCard;
  return {
    ...extraction,
    realEstate: {
      ...extraction.realEstate,
      propertyType: marketing.personalized ? marketing.propertyType : marketing.propertyType || extraction.realEstate.propertyType,
      agentName: marketing.personalized
        ? (exposePersonalContact ? marketing.contactName : '')
        : marketing.contactName || extraction.realEstate.agentName,
      agentEmail: marketing.personalized
        ? (exposePersonalContact ? marketing.contactEmail : '')
        : extraction.realEstate.agentEmail,
      agentPhone: marketing.personalized
        ? (exposePersonalContact ? marketing.contactPhone : '')
        : extraction.realEstate.agentPhone,
      brokerage: marketing.personalized
        ? (exposePersonalContact ? marketing.agency : '')
        : marketing.agency || extraction.realEstate.brokerage,
    },
  };
}

export function boardWizardListingPreview(
  extraction: BoardWizardListingExtraction,
  listingIntent: BoardWizardListingIntent = 'auto',
): BoardWizardListingPreview {
  const intent = normalizeBoardWizardListingIntent(listingIntent);
  return {
    kind: intent === 'rental' ? 'rental' : 'real-estate',
    listingName: extraction.listingName,
    address: extraction.address,
    price: extraction.price,
    status: extraction.realEstate.listingStatus,
    propertyType: extraction.realEstate.propertyType,
    bedrooms: extraction.realEstate.bedrooms,
    bathrooms: extraction.realEstate.bathrooms,
    mlsId: extraction.realEstate.mlsId,
    imageCount: extraction.images.length,
    imageUrl: extraction.images[0]?.url || '',
    contactName: extraction.realEstate.agentName,
    contactRole: extraction.realEstate.agentRole,
    brokerage: extraction.realEstate.brokerage,
    siteName: extraction.siteName,
    confidence: extraction.confidence,
  };
}

export function isLikelyBoardWizardRealEstateUrl(value: string): boolean {
  if (/(^|\.)(?:zillow|trulia|hotpads|realtor|redfin|apartments|homes|rent|zumper|apartmentlist|exprealty)\./i.test(safeHostname(value))) {
    return true;
  }
  try {
    return /^\/listing-detail\/\d{6,}\/[A-Za-z0-9][A-Za-z0-9-]{5,}\/?$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/** Pure story-composition seam used by regression tests and the AI fallback. */
export function buildBoardWizardListingMarketingBatchFromAnalyses(options: {
  extraction: BoardWizardListingExtraction;
  targetBoardTitle: string;
  count: number;
  narrationSecondsPerCard: number;
  style: BoardWizardListingMarketingStyle;
  listingIntent?: BoardWizardListingIntent;
  analyses: BoardWizardListingPhotoAnalysis[];
  aiScenes?: BoardWizardListingStoryScene[];
  marketing?: BoardWizardListingMarketingOptions;
}): GeneratedBoardWizardBatch {
  const extraction = options.marketing
    ? personalizedListingExtraction(options.extraction, options.marketing)
    : options.extraction;
  const allAnalyses = mergeWithFallbackAnalyses(extraction, options.analyses);
  const listingIntent = normalizeBoardWizardListingIntent(options.listingIntent);
  const furnishingsIncluded = boardWizardListingFurnishingsIncluded(extraction);
  const aiScenes = validateAiScenes(
    options.aiScenes ?? [],
    allAnalyses,
    extraction,
    listingIntent,
    furnishingsIncluded,
  );
  return buildMarketingBatch({
    extraction,
    targetBoardTitle: options.targetBoardTitle,
    scenes: aiScenes,
    secondsPerCard: options.narrationSecondsPerCard,
    analyses: allAnalyses,
    maxCards: Math.max(1, Math.min(24, Math.round(options.count) || 12)),
    listingIntent,
    marketing: options.marketing,
  });
}

export async function generateBoardWizardListingMarketingBatch(options: {
  extraction: BoardWizardListingExtraction;
  targetBoardTitle: string;
  count: number;
  narrationStyle: BoardNarrationStyleId;
  narrationSecondsPerCard: number;
  marketing: BoardWizardListingMarketingOptions;
  listingIntent?: BoardWizardListingIntent;
  preparedPhotos?: PreparedListingPhoto[];
}): Promise<GeneratedBoardWizardBatch> {
  const extraction = personalizedListingExtraction(options.extraction, options.marketing);
  const listingIntent = normalizeBoardWizardListingIntent(options.listingIntent);
  const supportsTalkThru = extraction.kind === 'real-estate' || listingIntent === 'rental';
  const furnishingsIncluded = boardWizardListingFurnishingsIncluded(extraction);
  if (!supportsTalkThru || options.marketing.enabled === false || extraction.images.length === 0) {
    return buildBoardWizardListingBatch({
      extraction,
      targetBoardTitle: options.targetBoardTitle,
      count: options.count,
      listingIntent,
    });
  }

  const sceneCount = Math.max(1, Math.min(24, extraction.photoSource === 'upload' ? 24 : extraction.images.length, Math.round(options.count) || 12));
  const startedAt = Date.now();
  let analyses: BoardWizardListingPhotoAnalysis[] = [];
  let aiScenes: BoardWizardListingStoryScene[] = [];
  const rejectionReasons: Record<string, number> = {};
  try {
    analyses = await analyzeListingGallery(extraction, options.preparedPhotos);
    const usable = mergeWithFallbackAnalyses(extraction, analyses).filter((analysis) => !DISALLOWED_STORY_SCENES.has(analysis.sceneType));
    if (usable.length) {
      aiScenes = await cachedListingStoryPlan({
        listingName: extraction.listingName,
        address: extraction.address,
        facts: listingFacts(extraction),
        photos: usable,
        sceneCount,
        cardPlan: buildListingCopyPlan(usable, sceneCount),
        narrationStyle: options.narrationStyle,
        narrationSecondsPerCard: options.narrationSecondsPerCard,
        marketingStyle: marketingStyleDescription(options.marketing.style),
        direction: options.marketing.direction,
        listingIntent,
        furnishingsIncluded,
      }, (scenes) => validateAiScenes(scenes, usable, extraction, listingIntent, furnishingsIncluded,
        (reason) => { rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1; }));
    }
  } catch (error) {
    logger.warn('Listing Marketing Specialist AI pass failed; using the grounded story fallback.', {
      sourceHost: safeHostname(extraction.sourceUrl),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  const allAnalyses = mergeWithFallbackAnalyses(extraction, analyses);
  const validatedAiScenes = validateAiScenes(
    aiScenes,
    allAnalyses,
    extraction,
    listingIntent,
    furnishingsIncluded,
  );
  logger.info('Listing Marketing Specialist completed.', {
    sourceHost: safeHostname(extraction.sourceUrl),
    sourceImageCount: extraction.images.length,
    analyzedImageCount: analyses.length,
    aiSceneCount: validatedAiScenes.length,
    plannedCardCount: buildListingCopyPlan(allAnalyses, sceneCount).length,
    rejectedSceneCount: Object.values(rejectionReasons).reduce((sum, count) => sum + count, 0),
    rejectionReasons,
    fallbackCardCount: Math.max(0, buildListingCopyPlan(allAnalyses, sceneCount).length - validatedAiScenes.length),
    durationMs: Date.now() - startedAt,
    version: STORY_VERSION,
  });
  return buildMarketingBatch({
    extraction,
    targetBoardTitle: options.targetBoardTitle,
    scenes: validatedAiScenes,
    secondsPerCard: options.narrationSecondsPerCard,
    analyses: allAnalyses,
    maxCards: sceneCount,
    listingIntent,
    marketing: options.marketing,
  });
}

async function cachedListingStoryPlan(
  params: Parameters<typeof generateBoardWizardListingStory>[0],
  validate: (scenes: BoardWizardListingStoryScene[]) => BoardWizardListingStoryScene[],
): Promise<BoardWizardListingStoryScene[]> {
  const cacheKey = createHash('sha256').update(JSON.stringify({ version: STORY_VERSION, ...params })).digest('hex');
  const reference = db.collection('listing_story_plans').doc(cacheKey);
  let scenes: BoardWizardListingStoryScene[] = [];
  let cached = false;
  try {
    const snapshot = await reference.get();
    if (snapshot.data()?.['version'] === STORY_VERSION) {
      scenes = normalizeCachedStoryScenes(snapshot.data()?.['scenes']);
      cached = scenes.length > 0;
    }
  } catch (error) {
    logger.warn('Listing story-plan cache read failed.', { errorMessage: error instanceof Error ? error.message : String(error) });
  }
  if (!scenes.length) scenes = await generateBoardWizardListingStory(params);
  const accepted = validate(scenes);
  const acceptedKeys = new Set(accepted.map((scene) => scene.cardKey));
  const missing = (params.cardPlan || []).filter((card) => !acceptedKeys.has(card.cardKey));
  if (missing.length) {
    logger.info('Repairing listing card copy.', { planned: params.cardPlan?.length, missing: missing.map((card) => card.cardKey), cached });
    try {
      const missingKeys = new Set(missing.map((card) => card.cardKey));
      // A repair response must not replace or duplicate already accepted narration.
      accepted.push(...validate(await generateBoardWizardListingStory({ ...params, cardPlan: missing }))
        .filter((scene) => scene.cardKey && missingKeys.has(scene.cardKey as ListingGroupKey)));
    } catch (error) {
      logger.warn('Listing copy repair failed; using complete factual sentences.', { errorMessage: error instanceof Error ? error.message : String(error) });
    }
  }
  // Store only accepted copy. A fallback remains distinguishable from an AI-written scene.
  if (accepted.length && (!cached || missing.length)) {
    try {
      await reference.set({ version: STORY_VERSION, scenes: accepted, listing_name: params.listingName,
        address: params.address, updated_at: new Date().toISOString() }, { merge: true });
    } catch (error) {
      logger.warn('Listing story-plan cache write failed.', { errorMessage: error instanceof Error ? error.message : String(error) });
    }
  }
  return accepted;
}

function normalizeCachedStoryScenes(value: unknown): BoardWizardListingStoryScene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): BoardWizardListingStoryScene[] => {
    const scene = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const photoIndex = Number(scene.photoIndex);
    const title = cleanText(scene.title, 80);
    const narration = typeof scene.narration === 'string' ? scene.narration.trim() : '';
    if (!Number.isInteger(photoIndex) || photoIndex < 0 || !title || !narration || narration.length > 3600) return [];
    return [{
      photoIndex,
      role: normalizeListingStoryRole(cleanText(scene.role, 40)) || '',
      cardKey: cleanText(scene.cardKey, 40) || undefined,
      title,
      subtitle: cleanText(scene.subtitle, 120),
      narration,
      durationSeconds: Math.max(5, Math.min(180, Math.round(Number(scene.durationSeconds) || 30))),
      factKeys: Array.isArray(scene.factKeys)
        ? scene.factKeys.map((key) => cleanText(key, 60)).filter(Boolean).slice(0, 12)
        : [],
    }];
  });
}

async function analyzeListingGallery(extraction: BoardWizardListingExtraction, uploadedPhotos?: PreparedListingPhoto[]): Promise<BoardWizardListingPhotoAnalysis[]> {
  const images = extraction.images.slice(0, MAX_ANALYZED_PHOTOS);
  const cached = new Map<number, BoardWizardListingPhotoAnalysis>();
  const missing: Array<{ image: BoardWizardListingImage; index: number; key: string }> = [];
  const refs = images.map((image, index) => {
    const uploaded = uploadedPhotos?.find((photo) => photo.index === index);
    const key = uploaded
      ? analysisCacheKey(`${uploaded.cacheScope}\n${uploaded.contentHash}`)
      : analysisCacheKey(image.url);
    return { index, image, key, ref: db.collection('listing_photo_analysis').doc(key) };
  });
  if (refs.length) {
    try {
      const snapshots = await db.getAll(...refs.map((item) => item.ref));
      snapshots.forEach((snapshot, position) => {
        const value = normalizeCachedAnalysis(snapshot.data(), refs[position].index);
        if (value) cached.set(refs[position].index, value);
      });
    } catch (error) {
      logger.warn('Listing photo-analysis cache read failed.', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const item of refs) {
    if (!cached.has(item.index)) missing.push(item);
  }

  const prepared: Array<{
    index: number;
    key: string;
    sourceLabel: string;
    mimeType: 'image/jpeg';
    base64: string;
    contentHash: string;
  }> = [];
  for (let start = 0; start < missing.length; start += 4) {
    const group = missing.slice(start, start + 4);
    const results = await Promise.all(group.map(async (item) => {
      try {
        const uploaded = uploadedPhotos?.find((photo) => photo.index === item.index);
        const bytes = uploaded ? Buffer.from(uploaded.base64, 'base64') : await downloadAndResizeListingImage(item.image.url);
        return {
          index: item.index,
          key: item.key,
          sourceLabel: item.image.alt,
          mimeType: 'image/jpeg' as const,
          base64: bytes.toString('base64'),
          contentHash: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch (error) {
        logger.warn('Listing photo could not be prepared for visual analysis.', {
          imageHost: safeHostname(item.image.url),
          imageIndex: item.index,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }));
    prepared.push(...results.filter((item): item is NonNullable<typeof item> => !!item));
  }

  const duplicateOf = new Map<number, number>();
  const firstByHash = new Map<string, number>();
  const uniquePrepared = prepared.filter((item) => {
    const firstIndex = firstByHash.get(item.contentHash);
    if (firstIndex !== undefined) {
      duplicateOf.set(item.index, firstIndex);
      return false;
    }
    firstByHash.set(item.contentHash, item.index);
    return true;
  });
  for (let start = 0; start < uniquePrepared.length; start += PHOTO_BATCH_SIZE) {
    const batch = uniquePrepared.slice(start, start + PHOTO_BATCH_SIZE);
    const generated = await analyzeBoardWizardListingPhotos({
      listingName: extraction.listingName,
      address: extraction.address,
      photos: batch,
    });
    for (const analysis of generated) cached.set(analysis.index, analysis);
  }
  for (const [index] of duplicateOf) {
    cached.set(index, fallbackAnalysis(extraction.images[index], index, 'duplicate'));
  }

  const writes = refs.flatMap((item) => {
    const analysis = cached.get(item.index);
    if (!analysis || !missing.some((entry) => entry.index === item.index)) return [];
    return [item.ref.set({
      ...analysis,
      source_url: item.image.evidence === 'user-upload' ? '' : item.image.url,
      version: PHOTO_ANALYSIS_VERSION,
      updated_at: new Date().toISOString(),
    }, { merge: true })];
  });
  if (writes.length) {
    await Promise.allSettled(writes);
  }
  return Array.from(cached.values()).sort((left, right) => left.index - right.index);
}

function validateAiScenes(
  scenes: BoardWizardListingStoryScene[],
  analyses: BoardWizardListingPhotoAnalysis[],
  extraction: BoardWizardListingExtraction,
  listingIntent: BoardWizardListingIntent,
  furnishingsIncluded: boolean,
  onReject?: (reason: string) => void,
): BoardWizardListingStoryScene[] {
  const reject = (reason: string): [] => { onReject?.(reason); return []; };
  const analysisByIndex = new Map(analyses.map((analysis) => [analysis.index, analysis]));
  const factValues = Object.values(listingFacts(extraction)).join(' ');
  const plans = new Map(buildListingCopyPlan(analyses, 24).map((card) => [card.cardKey, card]));
  const seen = new Set<string>();
  const keyCounts = new Map<string, number>();
  for (const scene of scenes) if (scene.cardKey) keyCounts.set(scene.cardKey, (keyCounts.get(scene.cardKey) || 0) + 1);
  return scenes.flatMap((scene) => {
    const analysis = analysisByIndex.get(scene.photoIndex);
    const role = normalizeListingStoryRole(scene.role);
    if (!analysis || !role || DISALLOWED_STORY_SCENES.has(analysis.sceneType)) return reject('invalid-role-or-photo');
    const key = scene.cardKey || listingGroupKey(analysis);
    const plan = plans.get(key as ListingGroupKey);
    if (!plan || seen.has(key) || (keyCounts.get(key) || 0) > 1 || !plan.photoIndices.includes(scene.photoIndex)) return reject('invalid-card-photo-membership');
    if (scene.cardKey && role !== plan.role) return reject('role-mismatch');
    // A legacy hook/CTA cannot be recycled as a room description.
    if (!scene.cardKey && (['hook', 'overview', 'action', 'next-step', 'fact-and-action'].includes(role)
      || (role !== plan.role && role !== normalizeListingStoryRole(analysis.sceneType)))) return reject('legacy-role-mismatch');
    const copy = [scene.title, scene.subtitle, scene.narration].join('. ');
    if (!isFinishedNarration(scene.narration) || containsUnsafeListingLanguage(copy)) return reject('unfinished-or-unsafe-copy');
    if (/\b(?:each|every|all)\s+(?:of the\s+)?(?:bedrooms?|bathrooms?|rooms?)\b/iu.test(copy)) return reject('unverified-room-coverage');
    if (listingIntent !== 'rental' && !furnishingsIncluded && containsUnqualifiedSaleFurnishingClaim(copy)) return reject('unqualified-furnishings');
    const evidence = factValues + ' ' + plan.photoIndices.flatMap((index) => {
      const photo = analysisByIndex.get(index);
      return photo ? [...photo.features, ...(photo.movableFurnishings || [])] : [];
    }).join(' ');
    const numericValues = (text: string) => narrationNumberTokens(text).map((token) => token.match(/[\d.]+/)?.[0]);
    const approved = new Set(numericValues(evidence));
    if (numericValues(copy.replace(/\b(?:one|1) (?:of|possible)\b/gi, '')).some((number) => !approved.has(number))) return reject('unsupported-number');
    for (const token of narrationNumberTokens(copy)) {
      const claim = token.match(/^([\d.]+)(bedrooms?|beds?|bathrooms?|baths?)$/);
      if (!claim) continue;
      const expected = claim[2].startsWith('bed') ? extraction.realEstate.bedrooms : extraction.realEstate.bathrooms;
      if (Number(claim[1]) !== Number(expected) || !expected) return reject('conflicting-room-count');
    }
    if (scene.factKeys.some((key) => !(key in listingFacts(extraction)))) return reject('unknown-fact-key');
    seen.add(key);
    return [{ ...scene, role, cardKey: key }];
  });
}

function buildMarketingBatch(options: {
  extraction: BoardWizardListingExtraction;
  targetBoardTitle: string;
  scenes: BoardWizardListingStoryScene[];
  secondsPerCard: number;
  analyses: BoardWizardListingPhotoAnalysis[];
  maxCards: number;
  listingIntent: BoardWizardListingIntent;
  marketing?: BoardWizardListingMarketingOptions;
}): GeneratedBoardWizardBatch {
  const extractedAt = new Date().toISOString();
  const gallery = options.extraction.images.map((image) => image.url).slice(0, BOARD_WIZARD_SOURCE_GALLERY_LIMIT);
  const uploaded = options.extraction.photoSource === 'upload';
  const imageSource = uploaded ? 'user-upload' as const : 'source-page' as const;
  const imageTag = uploaded ? 'uploaded-image' : 'source-image';
  const groups = listingPhotoGroups(options.analyses)
    .filter((group) => group.analyses.some((analysis) => !!options.extraction.images[analysis.index]))
    .sort((left, right) => left.priority - right.priority);
  const plan = buildListingCopyPlan(options.analyses, options.maxCards);
  const sceneByKey = new Map(options.scenes.map((scene) => [scene.cardKey, scene]));
  const overviewAnalyses = plan[0].photoIndices.flatMap((index) => options.analyses.find((photo) => photo.index === index) || []);
  let overviewUrls = listingAnalysisUrls(options.extraction, overviewAnalyses);
  if (options.extraction.preferredCoverUrl && gallery.includes(options.extraction.preferredCoverUrl)) {
    overviewUrls = [options.extraction.preferredCoverUrl, ...overviewUrls.filter((url) => url !== options.extraction.preferredCoverUrl)]
      .slice(0, LISTING_PRESENTATION_IMAGE_LIMIT);
  }
  const overviewScene = sceneByKey.get('overview');
  const overviewNotes = finishListingCopy(overviewScene?.narration, listingOverviewNotes(options.extraction), options.secondsPerCard);
  const maxCards = Math.max(1, options.maxCards);
  const reserveNextStep = maxCards > 1 || (options.marketing?.personalized === true && options.listingIntent !== 'rental');
  // Once grouping is enabled, every confidently identified space remains
  // represented. The requested scene count controls narrative depth, not
  // whether a bedroom or bathroom silently disappears from the board.
  const selectedGroups = maxCards > 1 ? groups : [];
  const rentalTag = options.listingIntent === 'rental' ? 'rental' : 'real-estate';
  const shared = {
    scope: 'place' as const,
    place_query: options.extraction.address || options.extraction.listingName,
    entity_name: options.extraction.listingName,
    entity_type: 'place' as const,
    image_intent: 'place' as const,
    sourceUrl: options.extraction.sourceUrl,
    extractionConfidence: options.extraction.confidence,
    extractedAt,
  };
  const overview: GeneratedBoardWizardCard = {
    ...shared,
    title: options.extraction.listingName.slice(0, 80),
    subtitle: (overviewScene?.subtitle || listingOverviewSubtitleForStory(options.extraction)).slice(0, 120),
    notes: overviewNotes,
    type: 'place',
    status: 'saved',
    rating: 5,
    tags: ['listing', rentalTag, 'listing-story', 'listing-group', 'group-overview', imageTag],
    image_query: `${options.extraction.listingName} property overview`.slice(0, 120),
    image_context: options.extraction.address || options.extraction.listingName,
    short_summary: (overviewScene?.subtitle || listingOverviewSubtitleForStory(options.extraction)).slice(0, 160),
    rank: 1,
    imageUrl: overviewUrls[0] || gallery[0],
    // Preserve the complete exact gallery on the opening card for board browsing
    // and existing exports. Live View uses the explicit presentation subset.
    imageUrls: gallery,
    imageSource: gallery.length ? imageSource : 'missing',
    locationLat: options.extraction.latitude,
    locationLng: options.extraction.longitude,
    listingPresentation: {
      ...listingPresentation('overview', overviewUrls, overviewAnalyses, 'verified'),
      sourcePhotoCount: gallery.length,
    },
  };
  const groupCards = selectedGroups.map((group, index): GeneratedBoardWizardCard => {
    const ordered = orderedListingGroupPhotos(group);
    const urls = listingAnalysisUrls(options.extraction, ordered);
    const representative = sceneByKey.get(group.key);
    const subtitle = representative?.subtitle || listingGroupSubtitle(group, ordered.slice(0, LISTING_PRESENTATION_IMAGE_LIMIT));
    const notes = finishListingCopy(representative?.narration, listingGroupFallback(group, options.listingIntent,
      boardWizardListingFurnishingsIncluded(options.extraction), options.secondsPerCard), options.secondsPerCard);
    return {
      ...shared,
      title: group.label,
      subtitle,
      notes,
      type: 'note',
      status: 'saved',
      rating: 4,
      tags: ['listing', rentalTag, 'listing-story', 'listing-group', `group-${group.key}`, imageTag],
      image_query: `${options.extraction.listingName} ${group.label}`.slice(0, 120),
      image_context: group.reviewStatus === 'needs-review' ? 'Unclassified property photographs' : group.label,
      short_summary: narrationSummary(notes),
      rank: index + 2,
      imageUrl: urls[0],
      imageUrls: urls,
      imageSource: urls.length ? imageSource : 'missing',
      listingPresentation: listingPresentation(group.key, urls, ordered, group.reviewStatus),
    };
  });
  const cards: GeneratedBoardWizardCard[] = [];
  if (options.marketing?.personalized && options.listingIntent !== 'rental') {
    const introMessage = options.marketing?.introMessage.trim() || '';
    const contactName = options.marketing?.contactName.trim() || options.extraction.realEstate.agentName;
    const introImage = overviewUrls[0] || gallery[0];
    cards.push({
      ...shared,
      title: introMessage ? `Welcome from ${contactName || 'your agent'}`.slice(0, 80) : 'Intro card',
      subtitle: introMessage
        ? `A personal introduction to ${options.extraction.listingName}`.slice(0, 120)
        : 'Only you can see this reminder until you add your introduction.',
      notes: introMessage || 'Add a short welcome message about the property and invite buyers to look around.',
      type: 'note',
      status: 'saved',
      rating: 5,
      authorOnly: !introMessage,
      tags: introMessage
        ? ['listing', 'real-estate', 'listing-story', 'story-intro', 'agent-intro']
        : ['listing', 'real-estate', 'listing-story', 'story-intro', 'intro-placeholder', 'author-only'],
      image_query: `${options.extraction.listingName} welcome`.slice(0, 120),
      image_context: options.extraction.address || options.extraction.listingName,
      short_summary: introMessage
        ? introMessage.slice(0, 160)
        : 'Add your personal property introduction.',
      rank: 1,
      imageUrl: introImage,
      imageUrls: introImage ? [introImage] : [],
      imageSource: introImage ? imageSource : 'missing',
    });
  }
  cards.push(overview, ...groupCards);
  if (options.marketing?.personalized && options.listingIntent !== 'rental') {
    const setupImage = overviewUrls[0] || gallery[0];
    cards.push({
      ...shared,
      title: 'Your Talking Card',
      subtitle: 'Let buyers ask you questions about this property.',
      notes: 'Set up your agent Talking Card when you are ready. This card is visible only to you until setup is complete.',
      type: 'note',
      status: 'saved',
      rating: 5,
      authorOnly: true,
      tags: ['listing', 'real-estate', 'listing-story', 'listing-talking-card-placeholder', 'author-only'],
      image_query: `${options.extraction.listingName} agent conversation`.slice(0, 120),
      image_context: options.extraction.address || options.extraction.listingName,
      short_summary: 'Make yourself available to buyers.',
      rank: cards.length + 1,
      imageUrl: setupImage,
      imageUrls: setupImage ? [setupImage] : [],
      imageSource: setupImage ? imageSource : 'missing',
    });
  }
  if (reserveNextStep) {
    const finalScene = sceneByKey.get('next-step');
    const nextStepImage = overviewUrls[0] || gallery[0];
    const showContact = options.marketing?.personalized === true
      && options.listingIntent !== 'rental'
      && options.marketing?.showContactOnClosingCard !== false;
    const contactName = showContact
      ? options.marketing?.contactName.trim() || options.extraction.realEstate.agentName
      : '';
    const contactEmail = showContact ? options.marketing?.contactEmail.trim() || '' : '';
    const contactPhone = showContact ? options.marketing?.contactPhone.trim() || '' : '';
    const agency = showContact ? options.marketing?.agency.trim() || '' : options.extraction.realEstate.brokerage;
    const isListingContact = showContact && !!(contactPhone || contactEmail);
    const nextStepTitle = options.listingIntent === 'rental'
      ? options.extraction.kind === 'vacation-rental' ? 'Check availability & book' : 'Check availability & apply'
      : isListingContact ? `Contact ${contactName || 'the listing agent'}`
      : options.extraction.price ? `The next step · ${options.extraction.price}` : 'See the full listing';
    const contactInvitation = `Interested in this home? ${contactName ? `Contact ${contactName}` : 'Get in touch with the listing agent'} to ask a question or arrange a private showing.`;
    const closingSubtitleText = isListingContact
      ? `Questions about this home? Get in touch with ${contactName || 'the listing agent'}.`
      : closingSubtitle(options.extraction, options.listingIntent);
    const closingNotes = isListingContact
      ? contactInvitation
      : finishListingCopy(finalScene?.narration, options.secondsPerCard <= 10
        ? options.listingIntent === 'rental'
          ? 'Check the original listing for current availability, pricing, and rental terms.'
          : 'Contact the listing representative for current details and showing availability.'
        : listingClose(options.extraction, options.listingIntent, boardWizardListingFurnishingsIncluded(options.extraction)), options.secondsPerCard);
    cards.push({
      ...shared,
      title: nextStepTitle.slice(0, 80),
      subtitle: closingSubtitleText.slice(0, 120),
      notes: closingNotes,
      ...(isListingContact ? { contactDetails: { name: contactName, organization: agency, phone: contactPhone, email: contactEmail } } : {}),
      type: 'note',
      status: 'planned',
      rating: 4,
      tags: ['listing', rentalTag, 'listing-story', 'listing-group', 'group-next-step', 'action', ...(isListingContact ? ['listing-contact'] : [])],
      image_query: `${options.extraction.listingName} next step`.slice(0, 120),
      image_context: options.extraction.address || options.extraction.listingName,
      short_summary: closingSubtitleText.slice(0, 160),
      rank: cards.length + 1,
      imageUrl: nextStepImage,
      imageUrls: nextStepImage ? [nextStepImage] : [],
      imageSource: nextStepImage ? imageSource : 'missing',
      listingPresentation: listingPresentation('next-step', nextStepImage ? [nextStepImage] : [], [], 'verified'),
    });
  }
  return {
    board: {
      title: (options.targetBoardTitle || options.extraction.listingName).slice(0, 90),
      description: narrationSummary(storyBoardDescription(options.extraction, options.listingIntent), 240),
      icon: options.listingIntent === 'rental' ? 'key' : 'apartment',
      tone: options.listingIntent === 'rental' ? 'sky' : 'teal',
    },
    cards: cards.map((card, index) => ({ ...card, rank: index + 1 })),
  };
}

function listingAnalysisUrls(
  extraction: BoardWizardListingExtraction,
  analyses: BoardWizardListingPhotoAnalysis[],
): string[] {
  return Array.from(new Set(analyses
    .map((analysis) => extraction.images[analysis.index]?.url || '')
    .filter(Boolean)));
}

function listingPresentation(
  key: ListingGroupKey,
  imageUrls: string[],
  analyses: BoardWizardListingPhotoAnalysis[],
  reviewStatus: 'verified' | 'needs-review',
): NonNullable<GeneratedBoardWizardCard['listingPresentation']> {
  const definition = LISTING_GROUP_DEFINITIONS[key];
  const confidence = analyses.length
    ? analyses.reduce((sum, analysis) => sum + analysis.confidence, 0) / analyses.length
    : 1;
  return {
    kind: 'listing-group',
    groupKey: key,
    label: definition.label,
    confidence: Math.max(0, Math.min(1, confidence)),
    reviewStatus,
    sourcePhotoCount: imageUrls.length,
    presentationImageUrls: imageUrls.slice(0, key === 'overview' ? 3 : LISTING_PRESENTATION_IMAGE_LIMIT),
  };
}

function listingGroupSubtitle(group: ListingPhotoGroup, analyses: BoardWizardListingPhotoAnalysis[]): string {
  const features = Array.from(new Set(analyses.flatMap(listingFixedFeatures))).slice(0, 3);
  return narrationSummary(features.join(' · ') || group.label, 120);
}

function finishListingCopy(candidate: string | undefined, fallback: string, seconds: number): string {
  const selected = candidate && isFinishedNarration(candidate) ? candidate : fallback;
  return fitNarrationToWords(selected, boardNarrationTargetWords(seconds)) || fallback;
}

function listingOverviewNotes(extraction: BoardWizardListingExtraction): string {
  const details = extraction.realEstate;
  const rooms = [details.bedrooms ? `${details.bedrooms} bedrooms` : '', details.bathrooms ? `${details.bathrooms} bathrooms` : ''].filter(Boolean);
  if (rooms.length) return `This home has ${rooms.join(' and ')}.`;
  return `Explore the spaces at ${extraction.listingName}.`;
}

function listingGroupFallback(group: ListingPhotoGroup, intent: BoardWizardListingIntent, furnished: boolean, seconds: number): string {
  if (group.reviewStatus === 'needs-review') return 'Additional photographs offer further views of the property.';
  const photos = orderedListingGroupPhotos(group).slice(0, LISTING_PRESENTATION_IMAGE_LIMIT);
  // Use a single photograph's observations: never combine distinct bedrooms into one invented room.
  const photo = photos.find((entry) => listingFixedFeatures(entry).length) || photos[0];
  const features = photo ? listingFixedFeatures(photo).slice(0, seconds <= 10 ? 2 : 3) : [];
  const label = group.key === 'bedrooms' ? 'bedroom' : group.key === 'bathrooms' ? 'bathroom'
    : group.key === 'living' ? 'living area' : group.key === 'dining' ? 'dining area'
    : group.key === 'outdoor' ? 'outdoor space' : group.key === 'work-utility' ? 'space'
    : group.key === 'exterior' ? 'exterior' : group.label.toLowerCase();
  const sentences = [features.length
    ? `The pictured ${label} features ${humanList(features)}.`
    : `These photographs show the property's ${group.label.toLowerCase()}.`];
  const movable = photo ? listingMovableFurnishings(photo) : [];
  if (seconds > 10 && movable.length) sentences.push(intent === 'rental' || furnished
    ? `The photographs also show ${humanList(movable.slice(0, 3))}.`
    : `Shown staged with ${humanList(movable.slice(0, 3))}, the space illustrates one possible arrangement.`);
  return fitNarrationToWords(sentences.join(' '), boardNarrationTargetWords(seconds)) || sentences[0];
}

function listingOverviewSubtitleForStory(extraction: BoardWizardListingExtraction): string {
  return [
    extraction.price,
    extraction.realEstate.bedrooms ? `${extraction.realEstate.bedrooms} beds` : '',
    extraction.realEstate.bathrooms ? `${extraction.realEstate.bathrooms} baths` : '',
  ].filter(Boolean).join(' · ') || extraction.address || 'Property overview';
}

function mergeWithFallbackAnalyses(
  extraction: BoardWizardListingExtraction,
  analyses: BoardWizardListingPhotoAnalysis[],
): BoardWizardListingPhotoAnalysis[] {
  const byIndex = new Map(analyses.map((analysis) => [analysis.index, analysis]));
  return extraction.images.map((image, index) => byIndex.get(index) ?? fallbackAnalysis(image, index));
}

function fallbackAnalysis(
  image: BoardWizardListingImage,
  index: number,
  forcedScene?: string,
): BoardWizardListingPhotoAnalysis {
  let imagePath = '';
  try { imagePath = new URL(image.url).pathname; } catch { imagePath = image.url; }
  // Uploaded file names and paths are never evidence of room identity.
  const text = image.evidence === 'user-upload' ? '' : `${image.alt} ${imagePath}`.toLowerCase();
  const patterns: Array<[RegExp, string, string]> = [
    [/front|facade|exterior|building/, 'exterior', 'Exterior'],
    [/aerial|drone/, 'aerial', 'Aerial view'],
    [/living|great room|family room/, 'living', 'Living area'],
    [/kitchen/, 'kitchen', 'Kitchen'],
    [/dining/, 'dining', 'Dining area'],
    [/bed|primary|master/, 'bedroom', 'Bedroom'],
    [/bath|shower|vanity/, 'bathroom', 'Bathroom'],
    [/deck|balcony|terrace/, 'balcony', 'Outdoor living'],
    [/patio|yard|pool|outdoor/, 'outdoor', 'Outdoor space'],
    [/garage|parking/, 'garage', 'Garage and parking'],
    [/floor.?plan/, 'floor-plan', 'Floor plan'],
    [/agent|profile|portrait|realtor/, 'agent', 'Agent'],
    [/logo|brand/, 'logo', 'Logo'],
    [/map/, 'map', 'Map'],
  ];
  const match = patterns.find(([pattern]) => pattern.test(text));
  const sceneType = forcedScene || match?.[1] || 'unknown';
  return {
    index,
    sceneType,
    roomType: match?.[2] || 'Property view',
    features: [],
    movableFurnishings: [],
    qualityScore: Math.max(0.35, 0.72 - index * 0.002),
    heroScore: sceneType === 'exterior' ? 0.82 : index === 0 ? 0.68 : 0.4,
    confidence: match ? 0.72 : 0.3,
  };
}

function listingFacts(extraction: BoardWizardListingExtraction): Record<string, string> {
  const details = extraction.realEstate;
  const facts: Record<string, string> = {
    address: extraction.address,
    price: extraction.price,
    status: details.listingStatus,
    property_type: details.propertyType,
    bedrooms: details.bedrooms,
    bathrooms: details.bathrooms,
    full_bathrooms: details.fullBathrooms,
    half_bathrooms: details.halfBathrooms,
    year_built: details.yearBuilt,
    hoa_fee: details.hoaFee,
    taxes: details.taxes,
    mls_id: details.mlsId,
    contact: details.agentName ? `${details.agentRole || 'Site contact'}: ${details.agentName}` : '',
    brokerage: details.brokerage,
    data_source: details.dataSource,
    source_description: extraction.description,
  };
  details.features.slice(0, 16).forEach((feature, index) => {
    facts[`feature_${index + 1}`] = feature;
  });
  extraction.amenities.slice(0, 12).forEach((amenity, index) => {
    facts[`amenity_${index + 1}`] = amenity;
  });
  extraction.facts.slice(0, 16).forEach((fact, index) => {
    facts[`listing_fact_${index + 1}`] = fact;
  });
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => !!value));
}

function storyBoardDescription(extraction: BoardWizardListingExtraction, listingIntent: BoardWizardListingIntent): string {
  const details = [
    extraction.price,
    extraction.realEstate.bedrooms ? `${extraction.realEstate.bedrooms} bedrooms` : '',
    extraction.realEstate.bathrooms ? `${extraction.realEstate.bathrooms} bathrooms` : '',
    extraction.realEstate.propertyType,
  ].filter(Boolean).join(' · ');
  return `${extraction.listingName}${details ? ` — ${details}` : ''}.`;
}

function listingClose(
  extraction: BoardWizardListingExtraction,
  listingIntent: BoardWizardListingIntent,
  furnishingsIncluded: boolean,
): string {
  const contact = extraction.realEstate.agentName
    ? `Contact ${extraction.realEstate.agentName}, the ${extraction.realEstate.agentRole || 'site contact'}, to ask a question or arrange a showing.`
    : '';
  const action = listingIntent === 'rental'
    ? extraction.kind === 'vacation-rental'
      ? 'Open the original rental listing to confirm current price, availability, fees, cancellation terms, house rules, and booking details.'
      : 'Open the original rental listing to confirm current rent, availability, lease terms, deposits, fees, application requirements, and contact details.'
    : 'Confirm current price, status, disclosures, fees, showing availability, and contact details on the original listing.';
  const qualification = listingIntent === 'rental' ? '' : furnishingsIncluded
    ? 'The source describes the property as furnished; confirm the exact furniture inventory and exclusions.'
    : 'Furnishings and decor shown in photographs may be staging and may not be included in the sale.';
  return [action, contact, qualification].filter(Boolean).join(' ');
}

function closingSubtitle(extraction: BoardWizardListingExtraction, listingIntent: BoardWizardListingIntent): string {
  return [
    listingIntent === 'rental' ? 'Verify current availability' : '',
    extraction.realEstate.listingStatus,
    extraction.realEstate.mlsId ? `MLS# ${extraction.realEstate.mlsId}` : '',
    extraction.realEstate.brokerage,
  ].filter(Boolean).join(' · ').slice(0, 120);
}

function marketingStyleDescription(style: BoardWizardListingMarketingStyle): string {
  switch (style) {
    case 'guided': return 'welcoming guided property tour, direct and spatially coherent';
    case 'luxury': return 'restrained luxury editorial, polished but never hyperbolic';
    case 'brisk': return 'brisk agent reel, concise and energetic without urgency claims';
    case 'investor': return 'fact-forward property overview, emphasizing only verified practical details';
    default: return 'warm storyteller, inviting and visually connected without sales hype';
  }
}

const MOVABLE_FURNISHING_PATTERN = /\b(?:furnishings?|furniture|bunk\s+beds?|beds?|headboards?|nightstands?|dressers?|wardrobes?|desks?|office\s+chairs?|chairs?|sofas?|couches?|sectionals?|ottomans?|coffee\s+tables?|dining\s+tables?|tables?|stools?|benches?|rugs?|carpets?|artwork|paintings?|televisions?|tvs?|lamps?|cribs?|bookcases?|bookshelves?|loose\s+decor|decorations?|refrigerators?|washers?|dryers?|microwaves?|appliances?)\b/i;
const STAGING_QUALIFIER_PATTERN = /\b(?:staged|staging|shown|pictured|depicted|illustrat(?:e|es|ed|ing)|demonstrat(?:e|es|ed|ing)|could|may|might|imagine|example|possible|potential|visualiz(?:e|es|ed|ing)|accommodat(?:e|es|ed|ing)|space for|room for|can fit|if desired|depending on|not included|does not convey)\b/i;

function listingFixedFeatures(analysis: BoardWizardListingPhotoAnalysis): string[] {
  return (analysis.features ?? []).filter((feature) => !MOVABLE_FURNISHING_PATTERN.test(feature));
}

function listingMovableFurnishings(analysis: BoardWizardListingPhotoAnalysis): string[] {
  return Array.from(new Set([
    ...(analysis.movableFurnishings ?? []),
    ...(analysis.features ?? []).filter((feature) => MOVABLE_FURNISHING_PATTERN.test(feature)),
  ])).slice(0, 8);
}

function containsUnqualifiedSaleFurnishingClaim(value: string): boolean {
  return value
    .split(/(?<=[.!?])\s+|\s+[·|]\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => MOVABLE_FURNISHING_PATTERN.test(part) && !STAGING_QUALIFIER_PATTERN.test(part));
}

function humanList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function containsUnsafeListingLanguage(value: string): boolean {
  return /\b(?:safe(?:st)?|crime[- ]free|perfect for (?:families|singles|young professionals)|family[- ]friendly neighborhood|exclusive community|good schools?|best schools?|guaranteed return|won't last|act now)\b/i.test(value);
}

function analysisCacheKey(url: string): string {
  return createHash('sha256').update(`${PHOTO_ANALYSIS_VERSION}\n${url}`).digest('hex');
}

function normalizeCachedAnalysis(value: unknown, expectedIndex: number): BoardWizardListingPhotoAnalysis | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (record.version !== PHOTO_ANALYSIS_VERSION) return null;
  const score = (input: unknown) => Math.max(0, Math.min(1, Number(input) || 0));
  const features = Array.isArray(record.features)
    ? record.features.map((item) => cleanText(item, 90)).filter(Boolean).slice(0, 8)
    : [];
  const movableFurnishings = Array.isArray(record.movableFurnishings)
    ? record.movableFurnishings.map((item) => cleanText(item, 90)).filter(Boolean).slice(0, 8)
    : [];
  return {
    index: expectedIndex,
    sceneType: cleanText(record.sceneType, 40).toLowerCase() || 'unknown',
    roomType: cleanText(record.roomType, 80) || 'Property view',
    features,
    movableFurnishings,
    qualityScore: score(record.qualityScore),
    heroScore: score(record.heroScore),
    confidence: score(record.confidence),
  };
}

async function downloadAndResizeListingImage(url: string): Promise<Buffer> {
  let current = new URL(url);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    await assertPublicImageUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5',
        'User-Agent': 'LivingWiki/1.0 listing-story-image-reader',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Image redirect did not include a location.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Image download returned ${response.status}.`);
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) throw new Error('Listing media is not an image.');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_IMAGE_BYTES) throw new Error('Listing image is too large to analyze.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Listing image has an invalid size.');
    return sharp(buffer, { failOn: 'none', limitInputPixels: 30_000_000 })
      .rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer();
  }
  throw new Error('Listing image redirected too many times.');
}

async function assertPublicImageUrl(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Unsupported listing image URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('Private image host rejected.');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('Private image address rejected.');
  }
}

function isPrivateAddress(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const ipv4 = normalized.replace(/^::ffff:/, '').split('.').map(Number);
  if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part))) return false;
  return ipv4[0] === 10
    || ipv4[0] === 127
    || (ipv4[0] === 169 && ipv4[1] === 254)
    || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168)
    || ipv4[0] === 0;
}

function cleanText(value: unknown, max: number): string {
  return (typeof value === 'string' ? value : '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname; } catch { return ''; }
}
