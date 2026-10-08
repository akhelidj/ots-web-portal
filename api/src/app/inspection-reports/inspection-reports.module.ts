import { Module } from '@nestjs/common';
import { InspectionReportsController } from './inspection-reports.controller';
import { InspectionReportsService } from './inspection-reports.service';
import { PrismaModule } from '../prisma/prisma.module';
import { FilesService } from '../files/files.service';
import { ReportDeletionService } from './report-deletion.service';

@Module({
  imports: [PrismaModule],
  controllers: [InspectionReportsController],
  providers: [InspectionReportsService, FilesService, ReportDeletionService],
  exports: [InspectionReportsService],
})
export class InspectionReportsModule {}
