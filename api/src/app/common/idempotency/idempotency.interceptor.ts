import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const MAX_KEY_LENGTH = 128;
/** A first request that never finished (crash) is considered abandoned after this long. */
const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_PROBABILITY = 0.02;

type Decision =
  { kind: 'proceed'; id: string } | { kind: 'replay'; body: unknown };

interface RequestLike {
  method: string;
  originalUrl?: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  user?: { id?: string; tenantId?: string };
}

/**
 * Makes retried mutations safe. The offline-sync client sends the same `Idempotency-Key`
 * on every retry of one queued operation; the first request runs, and any repeat — even
 * after a lost response or a 5xx that actually committed — gets the stored response back
 * instead of executing a second time (no duplicate creates, no phantom version conflicts).
 *
 * Requests without the header are untouched. Failed requests (any error) store nothing, so
 * a retry after a genuine failure executes normally. Keys are scoped to tenant + user.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<RequestLike>();
    if (!MUTATING.has(req.method)) return next.handle();

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) return next.handle();
    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
      );
    }
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId || !userId) return next.handle();

    const path = (req.originalUrl ?? req.url).split('?')[0] ?? '';

    return from(this.begin(tenantId, userId, key, req.method, path)).pipe(
      mergeMap((decision) => {
        if (decision.kind === 'replay') return of(decision.body);
        return next.handle().pipe(
          mergeMap((body) => this.complete(decision.id, body)),
          catchError((err: unknown) =>
            from(this.discard(decision.id)).pipe(
              mergeMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  private async begin(
    tenantId: string,
    userId: string,
    key: string,
    method: string,
    path: string,
  ): Promise<Decision> {
    this.maybePurge();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const row = await this.prisma.idempotencyKey.create({
          data: { tenantId, userId, key, method, path, state: 'IN_PROGRESS' },
        });
        return { kind: 'proceed', id: row.id };
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2002'
        ) {
          throw e;
        }
      }
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { tenantId_userId_key: { tenantId, userId, key } },
      });
      if (!existing) continue; // deleted between our insert and read: try again
      if (existing.method !== method || existing.path !== path) {
        throw new UnprocessableEntityException(
          'This Idempotency-Key was already used for a different request',
        );
      }
      if (existing.state === 'DONE') {
        return { kind: 'replay', body: existing.responseBody ?? undefined };
      }
      if (Date.now() - existing.createdAt.getTime() < STALE_IN_PROGRESS_MS) {
        throw new ConflictException(
          'A request with this Idempotency-Key is still being processed',
        );
      }
      await this.prisma.idempotencyKey.deleteMany({
        where: { id: existing.id },
      });
    }
    throw new ConflictException('Could not claim the Idempotency-Key');
  }

  private async complete(id: string, body: unknown): Promise<unknown> {
    if (body instanceof StreamableFile || Buffer.isBuffer(body)) {
      // Binary responses cannot be replayed from JSON; run-once is not guaranteed for them.
      await this.discard(id);
      return body;
    }
    await this.prisma.idempotencyKey.update({
      where: { id },
      data: {
        state: 'DONE',
        completedAt: new Date(),
        responseBody:
          body === undefined || body === null
            ? Prisma.JsonNull
            : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
      },
    });
    return body;
  }

  private async discard(id: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { id } });
  }

  /** Keeps the table small without a scheduler: occasionally drop expired keys. */
  private maybePurge(): void {
    if (Math.random() >= PURGE_PROBABILITY) return;
    this.prisma.idempotencyKey
      .deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      })
      .catch(() => undefined);
  }
}
