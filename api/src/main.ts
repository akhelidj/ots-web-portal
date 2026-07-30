/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import {
  ValidationPipe,
  Logger,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    console.error('===== FATAL SERVER ERROR =====');
    console.error(exception);

    // NOTE: intentionally reads `.message`, NOT `.getResponse()` — the resulting
    // flattening of structured HttpException bodies is a known gap logged in
    // docs/internal/sync-risks.md ("Block 3h"), owned by a separate fix. Preserve it.
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

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
  const app = await NestFactory.create(AppModule);

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
  Logger.log(`🚀 Application is running on: http://localhost:${port}/`);
}

bootstrap();
