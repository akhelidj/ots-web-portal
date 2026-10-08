/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import {
  ValidationPipe,
  ConsoleLogger,
  LogLevel,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    // Expected client errors (401/403/404/409/400…) are one line, not a stack dump;
    // only a genuine server fault (5xx) gets the full exception.
    if (status < 500) {
      const req = ctx.getRequest();
      console.warn(
        `[${status}] ${req?.method} ${req?.url} — ${
          exception instanceof Error ? exception.message : 'error'
        }`,
      );
    } else {
      console.error('===== FATAL SERVER ERROR =====');
      console.error(exception);
    }

    // NOTE: intentionally reads `.message`, NOT `.getResponse()` — the resulting
    // flattening of structured HttpException bodies is a known gap documented in
    // docs/KNOWN-ISSUES.md (#5), owned by a separate fix. Preserve it.
    response.status(status).json({
      statusCode: status,
      message:
        exception instanceof Error
          ? exception.message
          : 'Internal server error',
      stack: exception instanceof Error ? exception.stack : undefined,
    });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new QuietLogger('', { logLevels: logLevels() }),
  });

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
