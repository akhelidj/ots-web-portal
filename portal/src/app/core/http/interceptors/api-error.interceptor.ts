import {
  HttpErrorResponse,
  HttpEventType,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { withNormalizedHttpErrorMessage } from '@portal/core/http/utils/http-error.utils';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { environment } from '@app-env/environment';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const connectivity = inject(ConnectivityService);
  const session = inject(SessionService);
  const isApiRequest = req.url.startsWith(environment.apiUrl);

  return next(req).pipe(
    tap((event) => {
      if (!isApiRequest) {
        return;
      }

      if (event.type === HttpEventType.Response) {
        connectivity.markApiReachable();
      }
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        if (isApiRequest && error.status === 0) {
          connectivity.markApiUnreachable();
        }

        // An inspector whose cached profile predates the gate (or whose signature state
        // changed server-side) is told so by the API: surface the shell gate.
        if (
          isApiRequest &&
          error.status === 403 &&
          (error.error as { code?: string } | null)?.code ===
            'SIGNATURE_REQUIRED'
        ) {
          session.setHasSignature(false);
          session.demandSignature();
        }

        return throwError(() => withNormalizedHttpErrorMessage(error));
      }

      return throwError(() => error);
    }),
  );
};
