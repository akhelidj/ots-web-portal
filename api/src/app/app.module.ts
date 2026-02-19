import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DefaultDenyGuard } from './common/guards/default-deny.guard';
import { HealthController } from './health/health.controller';

import { PrismaModule } from './prisma/prisma.module';

import { AuthModule } from './auth/auth.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TemplateModule } from './template/template.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'api/.env', // explicit path since monorepo root is CWD
    }),
    PrismaModule,
    AuthModule,
    AuthModule,
    WorkflowModule,
    TemplateModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: DefaultDenyGuard,
    },
  ],
})
export class AppModule {}
