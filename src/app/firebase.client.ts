import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getFirebaseConfig } from './firebase.config';
import { firestoreTransportSettings } from './firebase-firestore-settings';

let analyticsPromise: Promise<Analytics | null> | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;
let functionsInstance: Functions | null = null;

export function getFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
}

export function initializeFirebaseClient(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const app = getFirebaseApp();

  analyticsPromise ??= isSupported()
    .then((supported) => (supported ? getAnalytics(app) : null))
    .catch(() => null);
}

export function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (!analyticsPromise) {
    initializeFirebaseClient();
  }

  return analyticsPromise ?? Promise.resolve(null);
}

export function getFirebaseFirestore(): Firestore {
  firestoreInstance ??= initializeFirestore(
    getFirebaseApp(),
    firestoreTransportSettings(typeof navigator === 'undefined' ? null : navigator),
  );
  return firestoreInstance;
}

export function getFirebaseStorage(): FirebaseStorage {
  storageInstance ??= getStorage(getFirebaseApp());
  return storageInstance;
}

export function getFirebaseFunctions(): Functions {
  functionsInstance ??= getFunctions(getFirebaseApp(), 'us-central1');
  return functionsInstance;
}
