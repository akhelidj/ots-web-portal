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
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const user = req.user;
    const revisionNumber = revision ? parseInt(revision, 10) : undefined;

    if (revisionNumber !== undefined && isNaN(revisionNumber)) {
      return res.status(400).send({ message: 'Invalid revision number' });
    }
    if (format !== undefined && format !== 'pdf' && format !== 'xlsx') {
      return res.status(400).send({ message: 'Invalid export format' });
    }

    const { buffer, filename, mimetype } =
      await this.exportService.exportInspectionReport(
        user,
        reportId,
        revisionNumber,
        format === 'pdf' ? 'pdf' : 'xlsx',
      );

    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** The blank template workbook this report is pinned to (tokens intact). */
  @Get(':id/export/template')
  async downloadTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') reportId: string,
    @Res() res: Response,
  ) {
    const { buffer, filename, mimetype } =
      await this.exportService.getReportTemplateFile(req.user, reportId);

    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
