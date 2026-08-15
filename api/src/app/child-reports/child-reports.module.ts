import { Module } from '@nestjs/common';
import { ChildReportsController } from './child-reports.controller';
import { ChildReportsService } from './child-reports.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';
import { FilesService } from '../files/files.service';

@Module({
  controllers: [ChildReportsController],
  providers: [ChildReportsService, FilesService, ReworkRulesInterpreter],
  exports: [ChildReportsService],
})
export class ChildReportsModule {}
