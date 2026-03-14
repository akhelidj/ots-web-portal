import {
  ApplicationConfig,
  ENVIRONMENT_INITIALIZER,
  inject,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { appRoutes } from './app.routes';
import { jwtInterceptor } from '@portal/core/auth/interceptors/jwt.interceptor';
import { apiErrorInterceptor } from '@portal/core/http/interceptors/api-error.interceptor';
import { environment } from '@app-env/environment';
import { provideDataHydrationSource } from '@portal/core/offline/services/data-hydration.token';
import { DataHydrationService } from '@portal/core/offline/services/data-hydration.service';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import { AdminUsersService } from '@portal/features/users/services/admin-users.service';
import { AdminCustomersService } from '@portal/features/customers/services/admin-customers.service';
import { AdminTemplatesService } from '@portal/features/templates/services/admin-templates.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([jwtInterceptor, apiErrorInterceptor])),
    provideDataHydrationSource(InspectionReportsService),
    provideDataHydrationSource(AdminUsersService),
    provideDataHydrationSource(AdminCustomersService),
    provideDataHydrationSource(AdminTemplatesService),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        inject(DataHydrationService);
      },
    },
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
