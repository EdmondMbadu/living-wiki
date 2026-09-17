import type { BoardWizardListingPhotoAnalysis } from './gemini';

export const LISTING_STORY_ROLES = [
  'hook', 'arrival', 'overview', 'exterior', 'aerial', 'entry', 'living', 'kitchen', 'dining',
  'bedroom', 'bathroom', 'office', 'flex', 'laundry', 'garage', 'outdoor', 'balcony', 'view',
  'amenity', 'floor-plan', 'property-view', 'facts', 'fact-and-action', 'action', 'next-step',
] as const;
export type ListingStoryRole = typeof LISTING_STORY_ROLES[number];
const ROLE_ALIASES: Record<string, ListingStoryRole> = {
  'visual-hook': 'hook', 'living-room': 'living', 'outdoor-space': 'outdoor',
  'dining-area': 'dining', 'call-to-action': 'action', bedrooms: 'bedroom', bathrooms: 'bathroom',
};
export function normalizeListingStoryRole(value: string): ListingStoryRole | null {
  const role = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ROLE_ALIASES[role] || (LISTING_STORY_ROLES.includes(role as ListingStoryRole) ? role as ListingStoryRole : null);
}

export const DISALLOWED_STORY_SCENES = new Set(['agent', 'logo', 'map', 'duplicate']);
export const LISTING_GROUP_DEFINITIONS = {
  overview: { label: 'Property Overview', priority: 0, role: 'overview' },
  exterior: { label: 'Exterior & Arrival', priority: 10, role: 'exterior' },
  living: { label: 'Living Areas', priority: 20, role: 'living' },
  kitchen: { label: 'Kitchen', priority: 30, role: 'kitchen' },
  dining: { label: 'Dining Areas', priority: 35, role: 'dining' },
  bedrooms: { label: 'Bedrooms', priority: 40, role: 'bedroom' },
  bathrooms: { label: 'Bathrooms', priority: 50, role: 'bathroom' },
  'work-utility': { label: 'More Spaces', priority: 60, role: 'property-view' },
  outdoor: { label: 'Outdoor Spaces & Views', priority: 70, role: 'outdoor' },
  amenities: { label: 'Amenities', priority: 80, role: 'amenity' },
  'floor-plans': { label: 'Floor Plans', priority: 90, role: 'floor-plan' },
  additional: { label: 'Additional Photos', priority: 95, role: 'property-view' },
  'next-step': { label: 'Next Step', priority: 100, role: 'next-step' },
} as const;
export type ListingGroupKey = keyof typeof LISTING_GROUP_DEFINITIONS;
export type ListingPhotoGroup = {
  key: ListingGroupKey; label: string; priority: number;
  reviewStatus: 'verified' | 'needs-review'; analyses: BoardWizardListingPhotoAnalysis[];
};
export type ListingCopyPlanCard = {
  cardKey: ListingGroupKey;
  role: ListingStoryRole;
  label: string;
  photoIndices: number[];
};

export function listingGroupKey(analysis: BoardWizardListingPhotoAnalysis): ListingGroupKey {
  if (analysis.confidence < 0.65 || analysis.sceneType === 'unknown') return 'additional';
  switch (analysis.sceneType) {
    case 'exterior': case 'aerial': case 'entry': return 'exterior';
    case 'living': return 'living';
    case 'kitchen': return 'kitchen';
    case 'dining': return 'dining';
    case 'bedroom': return 'bedrooms';
    case 'bathroom': return 'bathrooms';
    case 'office': case 'flex': case 'laundry': case 'garage': return 'work-utility';
    case 'outdoor': case 'balcony': case 'view': return 'outdoor';
    case 'amenity': return 'amenities';
    case 'floor-plan': return 'floor-plans';
    default: return 'additional';
  }
}

export function listingPhotoGroups(analyses: BoardWizardListingPhotoAnalysis[]): ListingPhotoGroup[] {
  const groups = new Map<ListingGroupKey, ListingPhotoGroup>();
  for (const analysis of analyses) {
    if (DISALLOWED_STORY_SCENES.has(analysis.sceneType)) continue;
    const key = listingGroupKey(analysis);
    const group = groups.get(key) || {
      key, ...LISTING_GROUP_DEFINITIONS[key],
      reviewStatus: key === 'additional' ? 'needs-review' as const : 'verified' as const, analyses: [],
    };
    group.analyses.push(analysis);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.priority - b.priority);
}

export function orderedListingGroupPhotos(group: ListingPhotoGroup): BoardWizardListingPhotoAnalysis[] {
  return [...group.analyses].sort((a, b) => b.qualityScore - a.qualityScore || b.heroScore - a.heroScore || a.index - b.index);
}

/** Plan against the exact photographs the audience will see, before writing. */
export function buildListingCopyPlan(analyses: BoardWizardListingPhotoAnalysis[], count: number): ListingCopyPlanCard[] {
  const usable = analyses.filter((photo) => !DISALLOWED_STORY_SCENES.has(photo.sceneType));
  const hero = [...usable].sort((a, b) =>
    Number(b.confidence >= 0.65) - Number(a.confidence >= 0.65)
    || b.heroScore - a.heroScore || b.qualityScore - a.qualityScore || a.index - b.index).slice(0, 3);
  const plan: ListingCopyPlanCard[] = [{ cardKey: 'overview', role: 'overview', label: 'Property Overview', photoIndices: hero.map((p) => p.index) }];
  if (count > 1) {
    for (const group of listingPhotoGroups(usable)) plan.push({
      cardKey: group.key, role: LISTING_GROUP_DEFINITIONS[group.key].role, label: group.label,
      photoIndices: orderedListingGroupPhotos(group).slice(0, 4).map((photo) => photo.index),
    });
    plan.push({ cardKey: 'next-step', role: 'next-step', label: 'Next Step', photoIndices: hero.slice(0, 1).map((p) => p.index) });
  }
  return plan;
}
