import { ExistingProvider, InjectionToken, Type } from '@angular/core';
import { UserProfile } from '@portal/core/auth/services/session.service';

export interface DataHydrationContext {
  readonly isAuthenticated: boolean;
  readonly isOnline: boolean;
  readonly profile: UserProfile | null;
}

export interface DataHydrationSource {
  readonly resourceKey: string;
  refreshLocalCache?(): Promise<void>;
  pullAllAndCache(): Promise<void>;
  canHydrate?(context: DataHydrationContext): boolean;
}

export const DATA_HYDRATION_SOURCES = new InjectionToken<DataHydrationSource[]>(
  'DATA_HYDRATION_SOURCES',
);

export function provideDataHydrationSource(
  sourceType: Type<DataHydrationSource>,
): ExistingProvider {
  return {
    provide: DATA_HYDRATION_SOURCES,
    useExisting: sourceType,
    multi: true,
  };
}
