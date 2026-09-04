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
  ConflictException,
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

  // Read-only: the template's CURRENT definitionJson (or null for a never-defined
  // template), for the admin Define page to decide defined-vs-undefined on open and
  // hydrate the read-only recap. Light read (no fileBlob). Admin-only (class guards).
  @Get(':id/definition')
  async getTemplateDefinition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.templateDefinitionService.getDefinition(tenantId, id);
  }

  // Writes definitionJson from an ops-authored description IF it passes the
  // write-time validation gate (seven checks incl. an engine dry-run). Rejects the
  // whole definition atomically otherwise. Never touches fileBlob/hash/version. In the
  // same transaction, captures the PRIOR definition as an immutable revision (durable
  // edit history — an overwrite can no longer destroy the previous state).
  //
  // READ-ONLY BLOCK: a defined template is read-only in the product — once definitionJson
  // is set, this ops-facing endpoint refuses to overwrite it (409). Ops re-shape a form by
  // uploading a NEW template version, not by re-defining. This is the server-side half of
  // the read-only recap (a direct PUT can't bypass the UI block). The guard lives HERE, not
  // in the service, on purpose: `service.defineTemplate` stays a re-appliable overwrite so
  // the definition-edit-history/revisions mechanism and `restoreDefinitionRevision` (which
  // re-applies a prior definition through the same write core) keep working untouched.
  @Put(':id/definition')
  async defineTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DefineTemplateDto,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const existing = await this.templateDefinitionService.getDefinition(
      tenantId,
      id,
    );
    if (existing.definitionJson != null) {
      throw new ConflictException({
        code: 'DEFINITION_ALREADY_SET',
        message:
          'This template already has a saved definition and is read-only. ' +
          'Upload a new template version to change the form.',
      });
    }

    return this.templateDefinitionService.defineTemplate(
      tenantId,
      id,
      dto,
      userId,
    );
  }

  // Durable definition-edit history (metadata only — revisionNumber, tokensChanged,
  // who/when/why; never the full blob). Admin-only (class guards).
  @Get(':id/definition/revisions')
  async listDefinitionRevisions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.templateDefinitionService.listDefinitionRevisions(tenantId, id);
  }

  // Re-apply a prior revision's definition as a new define write — re-validated through
  // the SAME gate, and itself snapshotting the current-before-restore, so restore is just
  // another edit and is fully reversible.
  @Post(':id/definition/revisions/:revisionNumber/restore')
  async restoreDefinitionRevision(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('revisionNumber') revisionNumber: string,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const parsed = Number(revisionNumber);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('revisionNumber must be a positive integer');
    }
    return this.templateDefinitionService.restoreDefinitionRevision(
      tenantId,
      id,
      parsed,
      userId,
    );
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
