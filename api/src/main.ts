/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { ValidationPipe, ConsoleLogger, LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './app/common/filters/all-exceptions.filter';
import { AppModule } from './app/app.module';

/**
 * Nest's own bootstrap chatter (one line per module, per route mapping) buries the
 * logs that matter. Those lines are all emitted at `log` level under these contexts;
 * drop them and keep everything else (our logs, warnings, errors, the "started" line).
 */
const BOOTSTRAP_NOISE = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

class QuietLogger extends ConsoleLogger {
  log(message: unknown, ...rest: unknown[]) {
    const context = rest[rest.length - 1];
    if (typeof context === 'string' && BOOTSTRAP_NOISE.has(context)) return;
    super.log(message, ...rest);
  }
}

/** `LOG_LEVELS=error,warn` (comma-separated) overrides the default of everything. */
function logLevels(): LogLevel[] | undefined {
  const raw = process.env.LOG_LEVELS;
  return raw ? (raw.split(',').map((l) => l.trim()) as LogLevel[]) : undefined;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new QuietLogger('', { logLevels: logLevels() }),
  });

  // Behind a reverse proxy (Render, nginx, ...) set TRUST_PROXY=1 so rate limiting sees the
  // real client IP instead of the proxy's.
  if (process.env.TRUST_PROXY) {
    app.set(
      'trust proxy',
      Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY,
    );
  }
  // API-only: no HTML is served, so the strictest CSP is safe; cross-origin reads of files
  // are governed by CORS below.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3000;
  const origins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',')
    : [];

  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    exposedHeaders: 'Content-Disposition',
  });

  await app.listen(port);
  // console, not the Nest logger: it must show whatever LOG_LEVELS is set to.
  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}/`);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: failed to start the API', err);
  process.exit(1);
});
