import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { SessionService } from '@portal/core/auth/services/session.service';
import { brandPalette, isBrandColor } from './brand-palette';

export type ThemeMode = 'light' | 'dark';

/** `GET /me/branding` — the signed-in customer's branding. */
export interface CustomerBranding {
  customerId: string;
  name: string;
  brandColor: string | null;
  /** Changes on every logo upload; null when there is no logo. */
  logoId: string | null;
}

const STORAGE_KEY = 'ots_portal_theme';
const BRANDING_KEY = 'ots_portal_branding';

/**
 * Light / dark theme and per-customer branding for the CUSTOMER experience.
 *
 * The theme is applied as `<html data-theme="…">` (see styles.scss) and only while a customer
 * is signed in; every other role never carries the attribute, so ops screens are unchanged.
 * The visitor's choice is remembered per browser; until they choose, the OS preference decides.
 *
 * Branding (brand colour + logo, set by an admin on the Customer) is fetched once per session
 * and cached per browser so the palette is right on the first paint and offline. The palette
 * (see brand-palette.ts) is written as inline custom properties on <html>, which override the
 * stylesheet's theme defaults; they are all removed again when a non-customer signs in.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly session = inject(SessionService);
  private readonly http = inject(HttpClient);

  public readonly mode = signal<ThemeMode>(this.initialMode());

  /** Themes are a customer-only feature. */
  public readonly available = computed(
    () => this.session.profile()?.role === APP_ROLES.CUSTOMER,
  );

  public readonly branding = signal<CustomerBranding | null>(this.readCachedBranding());
  /** Object URL of the customer's logo, once loaded; null without a logo (or offline). */
  public readonly logoUrl = signal<string | null>(null);

  public readonly brandColor = computed(() => {
    const color = this.available() ? this.branding()?.brandColor : null;
    return isBrandColor(color) ? color : null;
  });

  private appliedVars: string[] = [];
  private loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const root = document.documentElement;
      for (const name of this.appliedVars) root.style.removeProperty(name);
      this.appliedVars = [];

      if (!this.available()) {
        root.removeAttribute('data-theme');
        return;
      }
      const mode = this.mode();
      root.setAttribute('data-theme', mode);
      for (const [name, value] of Object.entries(brandPalette(this.brandColor(), mode))) {
        root.style.setProperty(name, value);
        this.appliedVars.push(name);
      }
    });

    // (Re)load the branding whenever a different customer account signs in; forget it on
    // sign-out so the next person on this browser never sees someone else's brand.
    effect(() => {
      const profile = this.session.profile();
      const key = this.available() && profile ? profile.id : null;
      untracked(() => {
        if (key === this.loadedFor) return;
        this.loadedFor = key;
        this.setLogoUrl(null);
        if (key) {
          void this.refreshBranding();
        } else {
          this.branding.set(null);
          this.writeCachedBranding(null);
        }
      });
    });
  }

  public toggle(): void {
    this.set(this.mode() === 'dark' ? 'light' : 'dark');
  }

  public set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage unavailable (private mode) — the choice just won't persist */
    }
  }

  /** Fetch the current branding (and logo). Offline, the cached branding stays in force. */
  public async refreshBranding(): Promise<void> {
    try {
      const branding = await firstValueFrom(
        this.http.get<CustomerBranding>(`${environment.apiUrl}/me/branding`),
      );
      this.branding.set(branding);
      this.writeCachedBranding(branding);
      if (branding.logoId) {
        const blob = await firstValueFrom(
          this.http.get(`${environment.apiUrl}/me/branding/logo`, {
            params: { v: branding.logoId },
            responseType: 'blob',
          }),
        );
        if (this.loadedFor) this.setLogoUrl(URL.createObjectURL(blob));
      }
    } catch {
      /* offline or not yet migrated — keep whatever is cached */
    }
  }

  private setLogoUrl(url: string | null): void {
    const previous = this.logoUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.logoUrl.set(url);
  }

  private readCachedBranding(): CustomerBranding | null {
    try {
      const raw = localStorage.getItem(BRANDING_KEY);
      return raw ? (JSON.parse(raw) as CustomerBranding) : null;
    } catch {
      return null;
    }
  }

  private writeCachedBranding(branding: CustomerBranding | null): void {
    try {
      if (branding) localStorage.setItem(BRANDING_KEY, JSON.stringify(branding));
      else localStorage.removeItem(BRANDING_KEY);
    } catch {
      /* ignore */
    }
  }

  private initialMode(): ThemeMode {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* ignore */
    }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
}
