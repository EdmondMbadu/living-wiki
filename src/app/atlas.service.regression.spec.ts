import {
  AtlasService,
  MAX_AUTOMATIC_ATLAS_REPAIRS_PER_SESSION,
  shouldStartAutomaticAtlasRepair,
} from './atlas.service';
import { resolveCityGuide } from '../../functions/src/city-guide';

describe('city persona configuration round trip', () => {
  it('preserves an explicit custom-persona override while hydrating an atlas', () => {
    const service = Object.create(AtlasService.prototype) as any;
    const guide = service.hydrateChatGuideConfig({
      name: 'B. Franklin', label: 'Your local guide', image_url: '/franklin.jpg',
      city_persona_override: true,
    });
    expect(resolveCityGuide({ wiki_type: 'city', chat_guide: guide })?.name).toBe('B. Franklin');
    const defaultGuide = service.hydrateChatGuideConfig({ name: 'B. Franklin' });
    expect(resolveCityGuide({ wiki_type: 'city', chat_guide: defaultGuide })?.name).toBe('Picamo');
  });
});

describe('AtlasService automatic repair policy', () => {
  it('does not start repairs for local snapshots with pending writes', () => {
    expect(shouldStartAutomaticAtlasRepair('', 'owner-1', {
      fromCache: false,
      hasPendingWrites: true,
    })).toBeFalse();
  });

  it('waits for a server-backed snapshot and runs only once per user session', () => {
    const serverSnapshot = { fromCache: false, hasPendingWrites: false };

    expect(shouldStartAutomaticAtlasRepair('', 'owner-1', serverSnapshot)).toBeTrue();
    expect(shouldStartAutomaticAtlasRepair('owner-1', 'owner-1', serverSnapshot)).toBeFalse();
  });

  it('keeps legacy repair work deliberately bounded', () => {
    expect(MAX_AUTOMATIC_ATLAS_REPAIRS_PER_SESSION).toBe(10);
  });
});
