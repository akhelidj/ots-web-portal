import { Module } from '@nestjs/common';
import { ChildReportsController } from './child-reports.controller';
import { ChildReportsService } from './child-reports.service';
import { ReworkRulesInterpreter } from './rework-rules.interpreter';

@Module({
  controllers: [ChildReportsController],
  providers: [ChildReportsService, ReworkRulesInterpreter],
  exports: [ChildReportsService],
})
export class ChildReportsModule {}
