import { Module } from '@nestjs/common';
import { InspectionReportsController } from './inspection-reports.controller';
import { InspectionReportsService } from './inspection-reports.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InspectionReportsController],
  providers: [InspectionReportsService],
  exports: [InspectionReportsService],
})
export class InspectionReportsModule {}
