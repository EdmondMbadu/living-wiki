import {
  MAX_AUTOMATIC_ATLAS_REPAIRS_PER_SESSION,
  shouldStartAutomaticAtlasRepair,
} from './atlas.service';

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
