import { Module } from '@nestjs/common';
import { ChildReportsController } from './child-reports.controller';
import { ChildReportsService } from './child-reports.service';
import { FilesService } from '../files/files.service';

@Module({
  controllers: [ChildReportsController],
  providers: [ChildReportsService, FilesService],
  exports: [ChildReportsService],
})
export class ChildReportsModule {}
