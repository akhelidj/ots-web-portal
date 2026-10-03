import { Injectable, effect, inject, untracked } from '@angular/core';
import { SessionService } from '@portal/core/auth/services/session.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import {
  DataHydrationContext,
  DataHydrationSource,
  DATA_HYDRATION_SOURCES,
} from '@portal/core/offline/services/data-hydration.token';

interface HydrationOptions {
  readonly includeRemote?: boolean;
  readonly throwOnError?: boolean;
}

const AUTO_HYDRATION_INTERVAL_MS = 120000;

@Injectable({
  providedIn: 'root',
})
export class DataHydrationService {
  private readonly session = inject(SessionService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly sources =
    inject(DATA_HYDRATION_SOURCES, { optional: true }) ?? [];

  private activeHydration: Promise<void> | null = null;
  private intervalId: number | null = null;

  constructor() {
    effect(() => {
      const isAuthenticated = this.session.isAuthenticated();
      const isOnline = this.connectivity.isOnline();

      untracked(() => {
        if (!isAuthenticated) {
          return;
        }

        void this.hydrateAll({ includeRemote: isOnline });
      });
    });

    window.addEventListener('focus', this.handleWindowFocus);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.intervalId = window.setInterval(() => {
      if (document.hidden) {
        return;
      }

      if (!this.session.isAuthenticated() || !this.connectivity.isOnline()) {
        return;
      }

      void this.hydrateAll({ includeRemote: true });
    }, AUTO_HYDRATION_INTERVAL_MS);
  }

  private readonly handleWindowFocus = (): void => {
    if (!this.session.isAuthenticated() || !this.connectivity.isOnline()) {
      return;
    }

    void this.hydrateAll({ includeRemote: true });
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      return;
    }

    if (!this.session.isAuthenticated() || !this.connectivity.isOnline()) {
      return;
    }

    void this.hydrateAll({ includeRemote: true });
  };

  public async hydrateAll(options?: HydrationOptions): Promise<void> {
    if (this.activeHydration) {
      await this.activeHydration;

      if (!options?.throwOnError && options?.includeRemote !== true) {
        return;
      }
    }

    this.activeHydration = this.runHydration(options).finally(() => {
      this.activeHydration = null;
    });

    return this.activeHydration;
  }

  private async runHydration(options?: HydrationOptions): Promise<void> {
    const context: DataHydrationContext = {
      isAuthenticated: this.session.isAuthenticated(),
      isOnline: this.connectivity.isOnline(),
      profile: this.session.profile(),
    };

    if (!context.isAuthenticated || this.sources.length === 0) {
      return;
    }

    const activeSources = this.sources.filter((source) =>
      this.canHydrateSource(source, context),
    );

    const errors: unknown[] = [];
    await this.runSettled(
      activeSources.flatMap((source) => {
        const refresh = source.refreshLocalCache;
        return typeof refresh === 'function' ? [refresh.bind(source)] : [];
      }),
      errors,
    );

    const includeRemote = options?.includeRemote ?? context.isOnline;
    if (!includeRemote || !context.isOnline) {
      if (errors.length > 0 && options?.throwOnError) {
        throw this.toError(errors[0]);
      }
      return;
    }

    await this.runSettled(
      activeSources.map((source) => source.pullAllAndCache.bind(source)),
      errors,
    );

    if (errors.length > 0 && options?.throwOnError) {
      throw this.toError(errors[0]);
    }
  }

  private canHydrateSource(
    source: DataHydrationSource,
    context: DataHydrationContext,
  ): boolean {
    if (typeof source.canHydrate !== 'function') {
      return true;
    }

    try {
      return source.canHydrate(context);
    } catch (error) {
      console.warn(
        `Hydration predicate failed for source '${source.resourceKey}'.`,
        error,
      );
      return false;
    }
  }

  private async runSettled(
    tasks: Array<() => Promise<void>>,
    errors: unknown[],
  ): Promise<void> {
    if (tasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(tasks.map((task) => task()));
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }
  }

  private toError(input: unknown): Error {
    return input instanceof Error ? input : new Error(String(input));
  }
}
