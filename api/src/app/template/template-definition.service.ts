import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { buildDefinition } from './definition-builder';
import { validateDefinition } from './definition-validator';
import { DefineTemplateDto } from './definition-authoring.types';

/**
 * Phase D step 2a — write path for `PUT /templates/:id/definition`.
 *
 * Turns an untrusted ops description into a validated `definitionJson`, or refuses
 * it atomically. Sequence:
 *   1. Load the row (tenant-scoped: NotFound / Forbidden, mirroring deprecate).
 *   2. Re-extract the workbook's tokens (normalize .xls → .xlsx, then extract) —
 *      the ground truth to validate declared-against-actual.
 *   3. Build the engine-shaped candidate from the description.
 *   4. Validate (seven checks incl. the engine dry-run). Any failure → 400,
 *      nothing written.
 *   5. Write ONLY `definitionJson`, in a single Prisma update. `fileBlob`, `hash`,
 *      `templateVersion` are never touched. One update, or nothing — atomic.
 */
@Injectable()
export class TemplateDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: XlsNormalizerService,
    private readonly extractor: TokenExtractorService,
  ) {}

  async defineTemplate(
    tenantId: string,
    templateId: string,
    dto: DefineTemplateDto,
  ) {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        tenantId: true,
        templateKey: true,
        templateVersion: true,
        fileBlob: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.tenantId !== tenantId) {
      throw new ForbiddenException('Access denied');
    }

    // Ground truth: the tokens actually in the workbook (same read path as step 1).
    const normalized = this.normalizer.normalizeToXlsx(
      Buffer.from(template.fileBlob),
    );
    const extracted = await this.extractor.extractTokens(normalized);
    const extractedTokens = new Set(extracted.map((t) => t.token));

    // Build → validate. buildDefinition throws BadRequest on structurally-broken
    // input; validateDefinition returns a typed failure for semantic/engine failures.
    const candidate = buildDefinition(
      {
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
      },
      dto,
    );

    const outcome = validateDefinition(candidate, extractedTokens);
    if (!outcome.ok) {
      throw new BadRequestException({
        code: 'DEFINITION_INVALID',
        check: outcome.check,
        message: outcome.reason,
      });
    }

    // Atomic: a single update, touching only definitionJson.
    const updated = await this.prisma.template.update({
      where: { id: template.id },
      data: { definitionJson: candidate as never },
      select: {
        id: true,
        templateKey: true,
        templateVersion: true,
        status: true,
        definitionJson: true,
      },
    });
    return updated;
  }
}
