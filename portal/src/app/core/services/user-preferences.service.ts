import { Injectable, signal, effect } from '@angular/core';

export type UserPreferences = {
  compactMode: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly STORAGE_KEY = 'trackline_user_prefs';

  preferences = signal<UserPreferences>({
    compactMode: false,
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
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.preferences()));
    });
  }

  setCompactMode(enabled: boolean) {
    this.preferences.update(p => ({ ...p, compactMode: enabled }));
  }

  isCompactMode() {
    return this.preferences().compactMode;
  }
}
