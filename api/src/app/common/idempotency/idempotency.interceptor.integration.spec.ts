/**
 * Integration — IdempotencyInterceptor against the real test Postgres.
 * Proves a retried mutation runs once and the repeat gets the stored response.
 */
import {
  CallHandler,
  ServiceUnavailableException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

type Req = {
  method: string;
  url: string;
  headers: Record<string, string>;
  user?: { id: string; tenantId: string };
};

const ctx = (req: Req): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const handler = (impl: () => unknown): CallHandler & { calls: number } => {
  const h = {
    calls: 0,
    handle: () => {
      h.calls++;
      try {
        const out = impl();
        return out instanceof Error ? throwError(() => out) : of(out);
      } catch (e) {
        return throwError(() => e);
      }
    },
  };
  return h as CallHandler & { calls: number };
};

const post = (key: string | undefined, over: Partial<Req> = {}): Req => ({
  method: 'POST',
  url: '/inspection-reports',
  headers: key ? { 'idempotency-key': key } : {},
  user: { id: 'u1', tenantId: 't1' },
  ...over,
});

describe('IdempotencyInterceptor [integration]', () => {
  let prisma: PrismaService;
  let interceptor: IdempotencyInterceptor;
  const run = (req: Req, h: CallHandler) =>
    lastValueFrom(interceptor.intercept(ctx(req), h) as ReturnType<typeof of>);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
    interceptor = new IdempotencyInterceptor(prisma);
  });
  afterAll(() => prisma.onModuleDestroy());
  beforeEach(() => prisma.idempotencyKey.deleteMany());

  it('runs the handler once and replays the stored response for a repeat', async () => {
    const h = handler(() => ({
      id: 'r1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }));
    const first = await run(post('k1'), h);
    const second = await run(post('k1'), h);
    expect(h.calls).toBe(1);
    // The replay is exactly what the client received over the wire (JSON round-trip).
    expect(second).toEqual({ id: 'r1', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(first).toEqual({
      id: 'r1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('replays an empty response too', async () => {
    const h = handler(() => undefined);
    await run(post('k-empty'), h);
    await run(post('k-empty'), h);
    expect(h.calls).toBe(1);
  });

  it('stores nothing when the handler fails, so a retry executes again', async () => {
    const failing = handler(() => new Error('boom'));
    await expect(run(post('k2'), failing)).rejects.toThrow('boom');
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = handler(() => ({ ok: true }));
    expect(await run(post('k2'), ok)).toEqual({ ok: true });
    expect(ok.calls).toBe(1);
  });

  it('rejects the same key reused for a different request', async () => {
    await run(
      post('k3'),
      handler(() => ({})),
    );
    await expect(
      run(
        post('k3', { url: '/customers' }),
        handler(() => ({})),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('answers a retryable 503 (not a 409 conflict) while the first request is still in progress', async () => {
    await prisma.idempotencyKey.create({
      data: {
        tenantId: 't1',
        userId: 'u1',
        key: 'k4',
        method: 'POST',
        path: '/inspection-reports',
        state: 'IN_PROGRESS',
      },
    });
    const h = handler(() => ({}));
    await expect(run(post('k4'), h)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(h.calls).toBe(0);
  });

  it('takes over an abandoned in-progress key (older than 2 minutes)', async () => {
    await prisma.idempotencyKey.create({
      data: {
        tenantId: 't1',
        userId: 'u1',
        key: 'k5',
        method: 'POST',
        path: '/inspection-reports',
        state: 'IN_PROGRESS',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    const h = handler(() => ({ ok: 1 }));
    expect(await run(post('k5'), h)).toEqual({ ok: 1 });
    expect(h.calls).toBe(1);
  });

  it('scopes keys per user and tenant', async () => {
    const h = handler(() => ({ n: 1 }));
    await run(post('same'), h);
    await run(post('same', { user: { id: 'u2', tenantId: 't1' } }), h);
    await run(post('same', { user: { id: 'u1', tenantId: 't2' } }), h);
    expect(h.calls).toBe(3);
  });

  it('passes through without a key, on GET, and for unauthenticated requests', async () => {
    const h = handler(() => ({}));
    await run(post(undefined), h);
    await run(post('k6', { method: 'GET' }), h);
    await run(post('k6', { user: undefined }), h);
    expect(h.calls).toBe(3);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it('also protects PATCH (a committed edit retried is not a version conflict)', async () => {
    const h = handler(() => ({ version: 5 }));
    const req = post('k7', { method: 'PATCH', url: '/inspection-reports/abc' });
    await run(req, h);
    expect(await run(req, h)).toEqual({ version: 5 });
    expect(h.calls).toBe(1);
  });

  it('rejects an oversized key', () => {
    expect(() =>
      interceptor.intercept(
        ctx(post('x'.repeat(200))),
        handler(() => ({})),
      ),
    ).toThrow(/at most 128/);
  });
});
