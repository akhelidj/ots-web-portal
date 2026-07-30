import { Controller, Get, Param, Query, Res, Req } from '@nestjs/common';
import { ExportService } from './export.service';
import { Response } from 'express';
import { AuthenticatedRequest } from '../auth/authenticated-request';

@Controller('inspection-reports')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get(':id/export')
  async exportInspectionReport(
    @Req() req: AuthenticatedRequest, // Express Request with injected user
    @Param('id') reportId: string,
    @Query('revision') revision: string,
    @Res() res: Response,
  ) {
    const user = req.user;
    const revisionNumber = revision ? parseInt(revision, 10) : undefined;

    if (revisionNumber !== undefined && isNaN(revisionNumber)) {
      return res.status(400).send({ message: 'Invalid revision number' });
    }

    const { buffer, filename, mimetype } =
      await this.exportService.exportInspectionReport(
        user,
        reportId,
        revisionNumber,
      );

    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
