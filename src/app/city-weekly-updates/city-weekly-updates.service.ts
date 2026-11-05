import { Injectable } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from '../firebase.client';

export interface CityWeeklySettings {
  enabled: boolean;
  emailVerified: boolean;
  citySlug: string | null;
  cityName: string | null;
  available: boolean;
}

@Injectable({ providedIn: 'root' })
export class CityWeeklyUpdatesService {
  async preference(enabled?: boolean): Promise<CityWeeklySettings> {
    const functions = getFirebaseFunctions();
    if (!functions) throw new Error('Weekly city updates are unavailable.');
    const call = httpsCallable<unknown, CityWeeklySettings>(functions, 'cityWeeklyUpdatesPreference');
    const result = await call(enabled === undefined ? { action: 'get' } : { action: 'set', enabled });
    return result.data;
  }
}
