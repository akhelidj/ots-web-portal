import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
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
import { TemplateTokensService } from './template-tokens.service';
import { TemplateDefinitionService } from './template-definition.service';
import { DefineTemplateDto } from './definition-authoring.types';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from '../auth/authenticated-request';
import 'multer'; // Ensure Express.Multer types are available

@Controller('templates')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class TemplateController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly templateTokensService: TemplateTokensService,
    private readonly templateDefinitionService: TemplateDefinitionService,
  ) {}

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

  // Read-only: loads the row's fileBlob, normalizes (.xls → .xlsx at read time),
  // extracts the workbook's {{tokens}}. Writes nothing. Admin-only (class guards).
  @Get(':id/tokens')
  async getTemplateTokens(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.templateTokensService.getTokens(tenantId, id);
  }

  // Writes definitionJson from an ops-authored description IF it passes the
  // write-time validation gate (seven checks incl. an engine dry-run). Rejects the
  // whole definition atomically otherwise. Never touches fileBlob/hash/version.
  @Put(':id/definition')
  async defineTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DefineTemplateDto,
  ) {
    const tenantId = req.user.tenantId;
    return this.templateDefinitionService.defineTemplate(tenantId, id, dto);
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
