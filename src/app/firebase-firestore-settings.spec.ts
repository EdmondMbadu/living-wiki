import { firestoreTransportSettings } from './firebase-firestore-settings';

describe('Firestore transport compatibility', () => {
  const macWebKit = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

  it('uses XHR for macOS Safari', () => {
    expect(firestoreTransportSettings({
      userAgent: `${macWebKit} Version/26.6.2 Safari/605.1.15`,
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })).toEqual({ useFetchStreams: false });
  });

  it('covers Safari, Chrome, Firefox, and embedded WebKit on iOS', () => {
    for (const suffix of ['Version/26.6 Mobile/15E148 Safari/604.1', 'CriOS/149.0 Mobile/15E148 Safari/604.1', 'FxiOS/143.0 Mobile/15E148 Safari/605.1.15', 'Mobile/15E148']) {
      expect(firestoreTransportSettings({
        userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 ${suffix}`,
        platform: 'iPhone',
        maxTouchPoints: 5,
      })).toEqual({ useFetchStreams: false });
    }
  });

  it('recognizes an iPad requesting the desktop site', () => {
    expect(firestoreTransportSettings({
      userAgent: macWebKit,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })).toEqual({ useFetchStreams: false });
  });

  it('preserves SDK defaults for desktop Chromium browsers despite their Safari token', () => {
    for (const suffix of ['', ' Edg/149.0', ' OPR/120.0']) {
      expect(firestoreTransportSettings({
        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36${suffix}`,
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })).toEqual({});
    }
  });

  it('preserves SDK defaults for Android and Firefox', () => {
    for (const userAgent of [
      'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/149.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
    ]) {
      expect(firestoreTransportSettings({ userAgent, platform: '', maxTouchPoints: 0 })).toEqual({});
    }
  });

  it('is safe without a browser during server rendering', () => {
    expect(firestoreTransportSettings()).toEqual({});
    expect(firestoreTransportSettings(null)).toEqual({});
  });
});
