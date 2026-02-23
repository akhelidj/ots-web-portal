import { Module } from '@nestjs/common';
import { ChildReportsController } from './child-reports.controller';
import { ChildReportsService } from './child-reports.service';

@Module({
  controllers: [ChildReportsController],
  providers: [ChildReportsService],
  exports: [ChildReportsService]
})
export class ChildReportsModule {}
