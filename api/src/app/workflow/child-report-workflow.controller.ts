import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { ChildReportWorkflowService } from './child-report-workflow.service';
import { ChildReportStatus } from '@prisma/client';

interface TransitionRequestDto {
  toStatus: ChildReportStatus;
  reason?: string;
}

@Controller('child-reports')
export class ChildReportWorkflowController {
  constructor(private workflowService: ChildReportWorkflowService) {}

  @Post(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: TransitionRequestDto,
    @Req() req: { user: any },
  ) {
    const user = req.user;
    return this.workflowService.transition(
      user,
      id,
      body.toStatus,
      body.reason,
    );
  }

  @Get(':id/transitions/available')
  async getAvailableTransitions(
    @Param('id') id: string,
    @Req() req: { user: any },
  ) {
    const user = req.user;
    return this.workflowService.getAvailableTransitions(user, id);
  }
}
