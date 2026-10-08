import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DefaultDenyGuard } from './common/guards/default-deny.guard';
import { SignatureRequiredGuard } from './common/guards/signature-required.guard';
import { SignaturesModule } from './signatures/signatures.module';
import { HealthController } from './health/health.controller';

import { PrismaModule } from './prisma/prisma.module';

import { TemplateModule } from './template/template.module';
import { RevisionModule } from './revision/revision.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowModule } from './workflow/workflow.module';
import { ExportModule } from './export/export.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { InspectionReportsModule } from './inspection-reports/inspection-reports.module';
import { SerialNumbersModule } from './serial-numbers/serial-numbers.module';
import { ChildReportsModule } from './child-reports/child-reports.module';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { StorageModule } from './storage/storage.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'api/.env', // explicit path since monorepo root is CWD
    }),
    StorageModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    SignaturesModule,
    CustomersModule,
    WorkflowModule,
    TemplateModule,
    RevisionModule,
    ExportModule,
    InspectionReportsModule,
    SerialNumbersModule,
    ChildReportsModule,
    MetricsModule,
  ],
  controllers: [AppController, HealthController, FilesController],
  providers: [
    AppService,
    FilesService,
    {
      provide: APP_GUARD,
      useClass: DefaultDenyGuard,
    },
    // Order matters: APP_GUARDs run in registration order, and this one relies on
    // DefaultDenyGuard having populated `req.user` first.
    {
      provide: APP_GUARD,
      useClass: SignatureRequiredGuard,
    },
  ],
})
export class AppModule {}
