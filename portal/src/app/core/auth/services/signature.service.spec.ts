/**
 * The inspector signature gate on the portal side: the session flag that drives the shell
 * blur, the service that keeps it in sync, and the interceptor that re-raises it when the
 * API answers 403 SIGNATURE_REQUIRED.
 */
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { environment } from '@app-env/environment';
import {
  SessionService,
  UserProfile,
} from '@portal/core/auth/services/session.service';
import { SignatureService } from '@portal/core/auth/services/signature.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { DbService } from '@portal/core/offline/services/db.service';
import { apiErrorInterceptor } from '@portal/core/http/interceptors/api-error.interceptor';

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'insp@example.test',
  role: 'INSPECTOR',
  tenantId: 't1',
  ...over,
});

describe('inspector signature gate (portal)', () => {
  const online = signal(true);
  let http: HttpTestingController;
  let session: SessionService;
  let signatures: SignatureService;

  beforeEach(() => {
    localStorage.clear();
    online.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        {
          provide: ConnectivityService,
          useValue: {
            isOnline: online,
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
    session = TestBed.inject(SessionService);
    signatures = TestBed.inject(SignatureService);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  describe('SessionService.signatureRequired', () => {
    it('is true only for an INSPECTOR whose flag is explicitly false', () => {
      session.profile.set(profile({ hasSignature: false }));
      expect(session.signatureRequired()).toBe(true);

      session.profile.set(profile({ hasSignature: true }));
      expect(session.signatureRequired()).toBe(false);
    });

    it('does not gate a profile cached before the feature (flag undefined)', () => {
      session.profile.set(profile());
      expect(session.signatureRequired()).toBe(false);
    });

    it('never gates other roles, even without a signature', () => {
      for (const role of ['SUPERVISOR', 'ADMIN', 'RECEIVER', 'CUSTOMER']) {
        session.profile.set(profile({ role, hasSignature: false }));
        expect(session.signatureRequired()).toBe(false);
      }
    });

    it('gates a supervisor only once the API demanded a signature, until one is saved', () => {
      session.setSession('a', 'r', profile({ role: 'SUPERVISOR', hasSignature: false }));
      expect(session.signatureRequired()).toBe(false);

      session.demandSignature();
      expect(session.signatureRequired()).toBe(true);

      session.setHasSignature(true);
      expect(session.signatureRequired()).toBe(false);
    });

    it('does not gate a supervisor who already has a signature, even if demanded', () => {
      session.setSession('a', 'r', profile({ role: 'SUPERVISOR', hasSignature: true }));
      session.demandSignature();
      expect(session.signatureRequired()).toBe(false);
    });

    it('persists a flag change so it survives a reload', () => {
      session.setSession('a', 'r', profile({ hasSignature: false }));
      session.setHasSignature(true);

      expect(session.signatureRequired()).toBe(false);
      expect(JSON.parse(localStorage.getItem('session_profile') ?? '{}')).toMatchObject({
        hasSignature: true,
      });
    });
  });

  describe('SignatureService', () => {
    it('refreshStatus resolves an unknown flag from the API', async () => {
      session.setSession('a', 'r', profile());

      const done = signatures.refreshStatus();
      http
        .expectOne(`${environment.apiUrl}/me/signature`)
        .flush({ hasSignature: false, updatedAt: null });
      await done;

      expect(session.signatureRequired()).toBe(true);
    });

    it('refreshStatus does nothing offline or for roles without a signature', async () => {
      session.setSession('a', 'r', profile());
      online.set(false);
      await signatures.refreshStatus();

      online.set(true);
      session.profile.set(profile({ role: 'CUSTOMER' }));
      await signatures.refreshStatus();

      http.expectNone(`${environment.apiUrl}/me/signature`);
    });

    it('save uploads the PNG as multipart `file`, lifts the gate and bumps the version', async () => {
      session.setSession('a', 'r', profile({ hasSignature: false }));
      const before = signatures.version();

      const done = signatures.save(new Blob(['png'], { type: 'image/png' }));
      const req = http.expectOne(`${environment.apiUrl}/me/signature`);
      expect(req.request.method).toBe('PUT');
      expect((req.request.body as FormData).get('file')).toBeInstanceOf(Blob);
      req.flush({ hasSignature: true, updatedAt: '2026-10-01T00:00:00.000Z' });
      await done;

      expect(session.signatureRequired()).toBe(false);
      expect(signatures.version()).toBe(before + 1);
    });

    it('a failed save leaves the gate up', async () => {
      session.setSession('a', 'r', profile({ hasSignature: false }));

      const done = signatures.save(new Blob(['png']));
      http
        .expectOne(`${environment.apiUrl}/me/signature`)
        .flush({ message: 'Not a PNG' }, { status: 400, statusText: 'Bad Request' });

      await expect(done).rejects.toMatchObject({ message: 'Not a PNG' });
      expect(session.signatureRequired()).toBe(true);
    });
  });

  describe('apiErrorInterceptor', () => {
    const client = () => TestBed.inject(HttpClient);

    it('raises the gate on a 403 SIGNATURE_REQUIRED from the API', () => {
      session.setSession('a', 'r', profile({ hasSignature: true }));

      client().post(`${environment.apiUrl}/inspection-reports`, {}).subscribe({
        error: () => undefined,
      });
      http.expectOne(`${environment.apiUrl}/inspection-reports`).flush(
        { statusCode: 403, code: 'SIGNATURE_REQUIRED', message: 'Sign first' },
        { status: 403, statusText: 'Forbidden' },
      );

      expect(session.signatureRequired()).toBe(true);
    });

    it('leaves the gate alone on an ordinary 403 (RBAC denial)', () => {
      session.setSession('a', 'r', profile({ hasSignature: true }));

      client().post(`${environment.apiUrl}/templates`, {}).subscribe({
        error: () => undefined,
      });
      http.expectOne(`${environment.apiUrl}/templates`).flush(
        { statusCode: 403, message: 'Forbidden resource' },
        { status: 403, statusText: 'Forbidden' },
      );

      expect(session.signatureRequired()).toBe(false);
    });
  });
});
