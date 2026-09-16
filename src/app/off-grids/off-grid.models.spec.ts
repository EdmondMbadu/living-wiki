import { directionsUrl, parseCoordinates, validPoint } from './off-grid.models';
describe('Off Grid locations', () => {
  it('accepts zero and negative points but rejects invalid numbers and ranges', () => {
    expect(validPoint(0, 0)).toBeTrue();
    expect(validPoint(-90, -180)).toBeTrue();
    for (const p of [
      [91, 0],
      [0, 181],
      [NaN, 0],
      [Infinity, 0],
      ['0', 0],
    ])
      expect(validPoint(p[0], p[1])).toBeFalse();
  });
  it('parses coordinate links without substituting a place title', () => {
    expect(parseCoordinates('0, -75.25')).toEqual({ lat: 0, lng: -75.25 });
    expect(parseCoordinates('https://www.google.com/maps?q=39.9,-75.1')).toEqual({
      lat: 39.9,
      lng: -75.1,
    });
    expect(parseCoordinates('https://www.google.com/maps/@39.9,-75.1,15z')).toEqual({
      lat: 39.9,
      lng: -75.1,
    });
    expect(parseCoordinates('https://evil.example/maps?q=39.9,-75.1')).toBeNull();
    expect(parseCoordinates('https://maps.app.goo.gl/short')).toBeNull();
    expect(parseCoordinates('91, 0')).toBeNull();
  });
  it('directions always use the exact saved coordinates, including zero', () => {
    const url = new URL(
      directionsUrl({ lat: 0, lng: -75.123456, source: 'map', confirmedAt: 'now' }),
    );
    expect(url.searchParams.get('destination')).toBe('0,-75.123456');
    expect(url.searchParams.get('api')).toBe('1');
  });
});
