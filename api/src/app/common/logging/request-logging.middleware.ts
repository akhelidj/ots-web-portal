import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Request as seen after the JWT guard: the authenticated user is attached by passport. */
export type LoggedRequest = Request & {
  id?: string;
  user?: { userId?: string; role?: string; tenantId?: string };
};

const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

/**
 * One JSON line per finished request, plus a correlation id.
 *
 * - The id is taken from an incoming `X-Request-Id` (e.g. set by the reverse proxy) when it
 *   looks sane, else generated. It is echoed in the `X-Request-Id` response header and
 *   attached to `req.id`, so the exception filter can put it in error bodies and logs.
 * - The line carries method, path (query string dropped — it can hold tokens), status,
 *   duration, and who made the call. It never logs headers, bodies or the query string.
 * - 5xx → stderr, 4xx → warn, everything else → stdout. `/health` is skipped.
 */
export function requestLogger(
  req: LoggedRequest,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);

  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
  if (path === '/health') {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: 'http',
      reqId: id,
      method: req.method,
      path,
      status,
      ms: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
      userId: req.user?.userId,
      role: req.user?.role,
      tenantId: req.user?.tenantId,
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  });
  next();
}
