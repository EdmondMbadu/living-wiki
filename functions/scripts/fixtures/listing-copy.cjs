// Anonymized regression fixture matching the reported 42-photo / 10-scene shape.
const groups = [
  ['exterior', 'Exterior', ['siding', 'white railings'], 3],
  ['living', 'Living area', ['hardwood flooring', 'vaulted ceiling'], 8],
  ['kitchen', 'Kitchen', ['white cabinetry', 'hardwood flooring'], 2],
  ['dining', 'Dining area', ['windows', 'hardwood flooring'], 2],
  ['bedroom', 'Bedroom', ['windows', 'closet'], 7],
  ['bathroom', 'Bathroom', ['double vanity', 'glass shower door'], 3],
  ['laundry', 'Laundry area', ['bifold door'], 3],
  ['outdoor', 'Outdoor space', ['balcony', 'railing'], 9],
  ['unknown', 'Property view', [], 5],
];
let index = 0;
const analyses = groups.flatMap(([sceneType, roomType, features, count]) => Array.from({ length: count }, () => ({
  index: index++, sceneType, roomType, features, movableFurnishings: sceneType === 'living' ? ['sofa'] : [],
  qualityScore: 0.9, heroScore: sceneType === 'living' ? 0.99 : 0.8, confidence: sceneType === 'unknown' ? 0.3 : 0.95,
})));
const extraction = {
  kind: 'real-estate', sourceUrl: 'https://example.com/listing/qa-home', finalUrl: 'https://example.com/listing/qa-home',
  siteName: 'QA Listings', listingName: 'QA Sample Home', description: 'A home with three bedrooms and two bathrooms.',
  address: '123 Example Avenue', host: '', price: '$799,900', rating: '', facts: ['3 bedrooms', '2 bathrooms'], amenities: [], units: [], confidence: 1,
  images: analyses.map((photo) => ({ url: `https://example.com/photo-${photo.index}.jpg`, alt: photo.roomType, evidence: 'embedded-gallery' })),
  realEstate: { mlsId: 'QA123', listingStatus: 'Active', propertyType: 'Condo', bedrooms: '3', bathrooms: '2',
    fullBathrooms: '2', halfBathrooms: '', yearBuilt: '', hoaFee: '', taxes: '', agentName: '', agentRole: '',
    agentProfileUrl: '', agentImageUrl: '', brokerage: '', dataSource: '', virtualTours: [], features: [] },
};
module.exports = { analyses, extraction };
