import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap } from 'rxjs/operators';
import { environment } from '@app-env/environment';
import { SessionService } from '@portal/core/auth/services/session.service';

/** Auth endpoints never trigger a refresh: a 401 there is the real answer. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'];

/** One refresh at a time. Refresh tokens rotate (the old one is revoked), so concurrent
 *  401s must share a single `POST /auth/refresh`; a second call would present a revoked
 *  token and log the user out. */
let refreshInFlight$: Observable<string> | null = null;

function withToken(req: HttpRequest<unknown>, token: string | null) {
  return token
    ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
    : req;
}

function refreshAccessToken(
  http: HttpClient,
  session: SessionService,
): Observable<string> {
  if (!refreshInFlight$) {
    const refreshToken = session.getRefreshToken();
    const request$ = refreshToken
      ? http.post<{ accessToken: string; refreshToken: string }>(
          `${environment.apiUrl}/auth/refresh`,
          { refreshToken },
        )
      : throwError(() => new HttpErrorResponse({ status: 401 }));
    refreshInFlight$ = request$.pipe(
      map((res) => {
        session.updateTokens(res.accessToken, res.refreshToken);
        return res.accessToken;
      }),
      finalize(() => {
        refreshInFlight$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }
  return refreshInFlight$;
}

/**
 * Attaches the access token and, when the API answers 401 (the short-lived access token
 * expired while the page stayed open), rotates it via the refresh token and retries the
 * request once. Without this, long sessions (e.g. a template definition wizard) fail
 * their save with "Unauthorized" even though the user still looks signed in.
 */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const router = inject(Router);
  // Bypasses the interceptor chain so the refresh call can't recurse into itself.
  const backend = inject(HttpBackend);
  const sentToken = session.getToken();

  return next(withToken(req, sentToken)).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        !req.url.startsWith(environment.apiUrl) ||
        AUTH_ENDPOINTS.some((path) => req.url.includes(path)) ||
        !session.getRefreshToken()
      ) {
        return throwError(() => error);
      }

      // Another request (or another tab) already rotated the token: retry with it.
      const current = session.getToken();
      const token$ =
        current && current !== sentToken
          ? of(current)
          : refreshAccessToken(new HttpClient(backend), session);

      return token$.pipe(
        catchError((refreshError: unknown) => {
          // The refresh token itself is dead (expired/revoked): the session is over.
          // A network failure (status 0) keeps the session for offline work.
          if (
            refreshError instanceof HttpErrorResponse &&
            refreshError.status === 401
          ) {
            session.logout();
            void router.navigate(['/login']);
          }
          return throwError(() => error);
        }),
        switchMap((token) => next(withToken(req, token))),
      );
    }),
  );
};
