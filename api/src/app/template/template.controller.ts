import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TemplateService } from './template.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import 'multer'; // Ensure Express.Multer types are available

@Controller('templates')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async createTemplate(
    @Req() req: AuthenticatedRequest,
    @Body() body: { templateKey: string; changeNote: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    if (!body.templateKey) {
      throw new BadRequestException('templateKey is required');
    }
    if (!body.changeNote) {
      throw new BadRequestException('changeNote is required');
    }

    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    return this.templateService.createTemplate(
      tenantId,
      body.templateKey,
      file,
      body.changeNote,
      userId,
    );
  }

  @Get()
  async getTemplates(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId;
    return this.templateService.getTemplates(tenantId);
  }

  @Patch(':id/deprecate')
  async deprecateTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.templateService.deprecateTemplate(tenantId, id, userId);
  }
}
