
import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { InspectionReportStatus } from '@prisma/client';

interface TransitionRequestDto {
  toStatus: InspectionReportStatus;
  reason?: string;
}

@Controller('inspection-reports')
export class InspectionReportWorkflowController {
  constructor(private workflowService: InspectionReportWorkflowService) {}

  @Post(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: TransitionRequestDto,
    @Req() req: any,
  ) {
    // req.user is populated by AuthGuard (JWT)
    const user = req.user;
    return this.workflowService.transition(user, id, body.toStatus, body.reason);
  }

  @Get(':id/transitions/available')
  async getAvailableTransitions(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const user = req.user;
    return this.workflowService.getAvailableTransitions(user, id);
  }
}
