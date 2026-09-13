import type { FirestoreSettings } from 'firebase/firestore';

type BrowserIdentity = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

// The installed Firebase SDK supports this option at runtime, but does not
// expose it in its public settings type. Keep the compatibility extension here.
type FirestoreTransportSettings = FirestoreSettings & { useFetchStreams?: boolean };

export function firestoreTransportSettings(
  browser?: BrowserIdentity | null,
): FirestoreTransportSettings {
  if (!browser) return {};

  const isIOS = /iPad|iPhone|iPod/.test(browser.userAgent)
    || (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1);
  const isDesktopWebKit = /AppleWebKit\//.test(browser.userAgent)
    && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Android/i.test(browser.userAgent);

  // Safari 26 can hold a Firestore response until the next ~30-second heartbeat.
  // Use Firebase's recommended XHR workaround for Safari and iOS WebKit (also
  // iPad desktop mode and Capacitor), leaving other browsers on SDK defaults.
  // https://github.com/firebase/firebase-js-sdk/issues/9789#issuecomment-4879269690
  return isIOS || isDesktopWebKit ? { useFetchStreams: false } : {};
}
