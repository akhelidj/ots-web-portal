import {
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Delete,
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
@Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
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

    // The uploader's role decides the validation gate (ADMIN → APPROVED,
    // SUPERVISOR → PENDING_APPROVAL). Read off the JWT, never from the body.
    return this.templateService.createTemplate(
      tenantId,
      body.templateKey,
      file,
      body.changeNote,
      userId,
      req.user.role,
    );
  }

  // ADMIN-ONLY (overrides the class-level @Roles): clears the validation gate on a
  // supervisor's pending upload, releasing it for reports and retiring the version it
  // replaces. A supervisor cannot validate their own upload — that is the whole point.
  @Patch(':id/approve')
  @Roles(UserRole.ADMIN)
  async approveTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.templateService.approveTemplate(
      req.user.tenantId,
      id,
      req.user.userId,
    );
  }

  // ADMIN-ONLY (overrides the class-level @Roles): refuses a pending upload with a reason
  // the uploader sees. Terminal — retry is a new version upload.
  @Patch(':id/reject')
  @Roles(UserRole.ADMIN)
  async rejectTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    if (!body?.reason?.trim()) {
      throw new BadRequestException('reason is required to reject a template');
    }
    return this.templateService.rejectTemplate(
      req.user.tenantId,
      id,
      req.user.userId,
      body.reason,
    );
  }

  @Get()
  async getTemplates(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId;
    return this.templateService.getTemplates(tenantId);
  }

  // Read-only: loads the row's fileBlob, normalizes (.xls → .xlsx at read time),
  // extracts the workbook's {{tokens}}. Writes nothing. Admin/Supervisor (class guards).
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
  // hydrate the read-only recap. Light read (no fileBlob). Admin/Supervisor (class guards).
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
  // who/when/why; never the full blob). Admin/Supervisor (class guards).
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

  // ADMIN-ONLY: what deleting this version would take with it (reports, serials,
  // attachments, ...), for the confirmation dialog. Read-only.
  @Get(':id/delete-impact')
  @Roles(UserRole.ADMIN)
  async getDeleteImpact(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.templateService.getDeleteImpact(req.user.tenantId, id);
  }

  // Admin/Supervisor (class guards). A SUPERVISOR can only undo a mistaken upload — the
  // service refuses any template that has been defined or referenced. An ADMIN deletes
  // any version and everything bound to it (reports and their files); a reason is
  // required whenever that removes data, and lands in the audit log.
  @Delete(':id')
  async deleteTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ) {
    return this.templateService.deleteTemplate(
      req.user.tenantId,
      id,
      req.user.userId,
      { role: req.user.role, reason: body?.reason },
    );
  }

  // ADMIN-ONLY (overrides the class-level @Roles): deprecating retires a template ops are
  // using, so it stays an admin decision even though uploading and defining no longer are.
  @Patch(':id/deprecate')
  @Roles(UserRole.ADMIN)
  async deprecateTemplate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    return this.templateService.deprecateTemplate(tenantId, id, userId);
  }
}
