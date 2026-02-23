
import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { InspectionReportWorkflowService } from './inspection-report-workflow.service';
import { InspectionReportStatus } from '@prisma/client';

interface TransitionRequestDto {
  toStatus: InspectionReportStatus;
  version: number;
  reason?: string;
}

interface CreateInspectionReportDto {
  templateKey: string;
  poNumber: string;
  customerId?: string;
}

@Controller('inspection-reports')
export class InspectionReportWorkflowController {
  constructor(private workflowService: InspectionReportWorkflowService) {}

  @Post()
  async create(
    @Body() body: CreateInspectionReportDto,
    @Req() req: any,
  ) {
    const user = req.user;
    return this.workflowService.create(user, body);
  }

  @Post(':id/transitions')
  async transition(
    @Param('id') id: string,
    @Body() body: TransitionRequestDto,
    @Req() req: any,
  ) {
    // req.user is populated by AuthGuard (JWT)
    const user = req.user;
    return this.workflowService.transition(user, id, body.toStatus, body.version, body.reason);
  }

  @Get(':id/available-transitions')
  async getAvailableTransitions(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const user = req.user;
    return this.workflowService.getAvailableTransitions(user, id);
  }

  @Get(':id/transitions')
  async getTransitions(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const user = req.user;
    return this.workflowService.getTransitions(user, id);
  }
}
