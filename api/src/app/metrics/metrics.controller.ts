import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import { MetricsService } from './metrics.service';

/** Admin-only operational metrics. */
@UseGuards(RolesGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Roles(UserRole.ADMIN)
  @Get('reports')
  async listReportTimelines(@Req() req: AuthenticatedRequest) {
    return this.metricsService.listReportTimelines(req.user.tenantId);
  }
}
