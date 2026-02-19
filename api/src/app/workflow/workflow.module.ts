
import { Module } from '@nestjs/common';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { ChildReportWorkflowService } from './child-report-workflow.service';
import { InspectionReportWorkflowController } from './inspection-report-workflow.controller';
import { ChildReportWorkflowController } from './child-report-workflow.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RevisionModule } from '../revision/revision.module';

@Module({
  imports: [PrismaModule, RevisionModule],
  controllers: [
    InspectionReportWorkflowController,
    ChildReportWorkflowController,
  ],
  providers: [
    InspectionReportWorkflowService,
    ChildReportWorkflowService,
  ],
  exports: [
    InspectionReportWorkflowService,
    ChildReportWorkflowService,
  ],
})
export class WorkflowModule {}
