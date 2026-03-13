import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { withNormalizedHttpErrorMessage } from '@portal/core/http/utils/http-error.utils';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        return throwError(() => withNormalizedHttpErrorMessage(error));
      }

      return throwError(() => error);
    }),
  );
};
