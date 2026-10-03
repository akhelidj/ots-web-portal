import { Injectable, signal, effect } from '@angular/core';

export type UserPreferences = {
  compactMode: boolean;
  hasSeenOnboardingModal: boolean;
  disabledPulsingTabs: string[];
};

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly STORAGE_KEY = 'trackline_user_prefs';

  preferences = signal<UserPreferences>({
    compactMode: false,
    hasSeenOnboardingModal: false,
    disabledPulsingTabs: [],
  });

  constructor() {
    // Load from storage
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.preferences.set({ ...this.preferences(), ...parsed });
      } catch (e) {
        console.error('Failed to parse user preferences', e);
      }
    }

    // Persist on change
    effect(() => {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(this.preferences()),
      );
    });
  }

  setCompactMode(enabled: boolean) {
    this.preferences.update((p) => ({ ...p, compactMode: enabled }));
  }

  setHasSeenOnboardingModal(seen: boolean) {
    this.preferences.update((p) => ({ ...p, hasSeenOnboardingModal: seen }));
  }

  addDisabledPulsingTab(tab: string) {
    this.preferences.update((p) => {
      const tabs = p.disabledPulsingTabs || [];
      if (!tabs.includes(tab)) {
        return { ...p, disabledPulsingTabs: [...tabs, tab] };
      }
      return p;
    });
  }

  isCompactMode() {
    return this.preferences().compactMode;
  }
}
