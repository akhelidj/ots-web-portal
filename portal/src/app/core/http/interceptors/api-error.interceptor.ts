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
import { environment } from '@app-env/environment';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const connectivity = inject(ConnectivityService);
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

        return throwError(() => withNormalizedHttpErrorMessage(error));
      }

      return throwError(() => error);
    }),
  );
};
