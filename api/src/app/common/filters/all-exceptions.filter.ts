import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

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

    // `message` stays the exception's message string (what the portal already reads);
    // the structured fields of an HttpException body (e.g. the approval gate's `code`,
    // `missingDispositionSerials`, `missingRequiredFields`) ride alongside it.
    const structured =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const extra: Record<string, unknown> = {};
    if (structured && typeof structured === 'object') {
      for (const [key, value] of Object.entries(structured)) {
        if (key !== 'message' && key !== 'statusCode') extra[key] = value;
      }
    }
    // Never leak internals to clients in production: a non-HTTP (5xx) fault gets a
    // generic message, and stack traces are development-only.
    const isProd = process.env.NODE_ENV === 'production';
    const expose = !isProd || exception instanceof HttpException;
    response.status(status).json({
      ...extra,
      statusCode: status,
      message:
        exception instanceof Error && expose
          ? exception.message
          : 'Internal server error',
      stack:
        !isProd && exception instanceof Error ? exception.stack : undefined,
    });
  }
}
