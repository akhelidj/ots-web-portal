import { Controller, Get, Param, Request, Res } from '@nestjs/common';
import { Response } from 'express';
import { FilesService } from './files.service';
import { AuthenticatedRequest } from '../auth/authenticated-request';

@Controller('api/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get('attachments/:id')
  async downloadAttachment(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const file = await this.filesService.resolveAttachmentForDownload(
      req.user,
      id,
    );

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
      'Content-Length': file.buffer.length.toString(),
      'Cache-Control': 'private, no-store',
    });

    res.send(file.buffer);
  }
}
