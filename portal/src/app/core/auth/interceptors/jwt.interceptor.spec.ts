/**
 * Expired-access-token recovery: a 401 from the API rotates the token pair through
 * `POST /auth/refresh` and replays the request once, so a long-open page (the template
 * definition wizard) can still save instead of failing with "Unauthorized".
 */
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { environment } from '@app-env/environment';
import { SessionService } from '@portal/core/auth/services/session.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { DbService } from '@portal/core/offline/services/db.service';
import { jwtInterceptor } from '@portal/core/auth/interceptors/jwt.interceptor';
import { apiErrorInterceptor } from '@portal/core/http/interceptors/api-error.interceptor';
import { signal } from '@angular/core';

const api = environment.apiUrl;
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('jwtInterceptor token refresh', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let session: SessionService;
  let navigate: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'old-access');
    localStorage.setItem('refresh_token', 'old-refresh');
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor, apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
        {
          provide: ConnectivityService,
          useValue: {
            isOnline: signal(true),
            markApiReachable: jest.fn(),
            markApiUnreachable: jest.fn(),
          },
        },
        {
          provide: DbService,
          useValue: {
            openForTenant: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    session = TestBed.inject(SessionService);
  });

  afterEach(() => http.verify());

  it('refreshes on 401 and replays the request with the new token', () => {
    let result: unknown;
    client
      .put(`${api}/templates/t1/definition`, { a: 1 })
      .subscribe((r) => (result = r));

    const first = http.expectOne(`${api}/templates/t1/definition`);
    expect(first.request.headers.get('Authorization')).toBe('Bearer old-access');
    first.flush({ message: 'Unauthorized' }, unauthorized);

    const refresh = http.expectOne(`${api}/auth/refresh`);
    expect(refresh.request.body).toEqual({ refreshToken: 'old-refresh' });
    refresh.flush({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    const retry = http.expectOne(`${api}/templates/t1/definition`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
    expect(retry.request.body).toEqual({ a: 1 });
    retry.flush({ ok: true });

    expect(result).toEqual({ ok: true });
    expect(session.getToken()).toBe('new-access');
    expect(session.getRefreshToken()).toBe('new-refresh');
  });

  it('shares one refresh between concurrent 401s (refresh tokens rotate)', () => {
    client.get(`${api}/a`).subscribe();
    client.get(`${api}/b`).subscribe();

    http.expectOne(`${api}/a`).flush(null, unauthorized);
    http.expectOne(`${api}/b`).flush(null, unauthorized);

    http
      .expectOne(`${api}/auth/refresh`)
      .flush({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    for (const url of [`${api}/a`, `${api}/b`]) {
      const retry = http.expectOne(url);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
      retry.flush({});
    }
  });

  it('ends the session when the refresh token itself is rejected', () => {
    let error: HttpErrorResponse | undefined;
    client.get(`${api}/templates`).subscribe({ error: (e) => (error = e) });

    http.expectOne(`${api}/templates`).flush(null, unauthorized);
    http
      .expectOne(`${api}/auth/refresh`)
      .flush({ message: 'Token revoked' }, unauthorized);

    expect(error?.status).toBe(401);
    expect(session.getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('keeps the session when the refresh fails for network reasons', () => {
    let error: HttpErrorResponse | undefined;
    client.get(`${api}/templates`).subscribe({ error: (e) => (error = e) });

    http.expectOne(`${api}/templates`).flush(null, unauthorized);
    http
      .expectOne(`${api}/auth/refresh`)
      .error(new ProgressEvent('error'), { status: 0 });

    expect(error?.status).toBe(401);
    expect(session.getToken()).toBe('old-access');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not loop when the replayed request is still 401', () => {
    let error: HttpErrorResponse | undefined;
    client.get(`${api}/templates`).subscribe({ error: (e) => (error = e) });

    http.expectOne(`${api}/templates`).flush(null, unauthorized);
    http
      .expectOne(`${api}/auth/refresh`)
      .flush({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    http.expectOne(`${api}/templates`).flush(null, unauthorized);

    expect(error?.status).toBe(401);
  });

  it('never refreshes for a 401 from login', () => {
    let error: HttpErrorResponse | undefined;
    client
      .post(`${api}/auth/login`, {})
      .subscribe({ error: (e) => (error = e) });

    http
      .expectOne(`${api}/auth/login`)
      .flush({ message: 'Invalid credentials' }, unauthorized);

    expect(error?.status).toBe(401);
    http.expectNone(`${api}/auth/refresh`);
  });
});
