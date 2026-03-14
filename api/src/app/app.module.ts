import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DefaultDenyGuard } from './common/guards/default-deny.guard';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'api/.env', // explicit path since monorepo root is CWD
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    WorkflowModule,
    TemplateModule,
    RevisionModule,
    ExportModule,
    InspectionReportsModule,
    SerialNumbersModule,
    ChildReportsModule,
  ],
  controllers: [AppController, HealthController, FilesController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: DefaultDenyGuard,
    },
  ],
})
export class AppModule {}
