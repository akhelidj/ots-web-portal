import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import {
  TokenExtractorService,
  ExtractedToken,
} from './token-extractor.service';
import {
  ATTACHMENT_STORAGE,
  AttachmentStorage,
} from '../storage/attachment-storage.types';

/**
 * Phase D step 1 — read-only orchestration for `GET /templates/:id/tokens`.
 *
 * Loads a stored template's workbook bytes from the storage abstraction by the
 * row's `fileKey`, normalizes it to `.xlsx` (legacy `.xls` are converted at read
 * time), and extracts its tokens. Kept as its OWN service so the audited storage /
 * hash / versioning path in `TemplateService` is not touched — this adds a new read
 * path and nothing else. It NEVER writes: no `definitionJson`, no workbook bytes,
 * no `hash`, no `version`.
 *
 * Tenant scoping mirrors `TemplateService.deprecateTemplate` (find-by-id, then
 * NotFound / Forbidden), so an admin cannot read another tenant's template.
 */
@Injectable()
export class TemplateTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizer: XlsNormalizerService,
    private readonly extractor: TokenExtractorService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
  ) {}

  async getTokens(
    tenantId: string,
    templateId: string,
  ): Promise<ExtractedToken[]> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: { tenantId: true, fileKey: true },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.tenantId !== tenantId) {
      throw new ForbiddenException('Access denied');
    }

    const buffer = await this.storage.getTemplate(template.fileKey);
    if (!buffer) {
      throw new NotFoundException('Template file not found');
    }

    const normalized = this.normalizer.normalizeToXlsx(buffer);
    return this.extractor.extractTokens(normalized);
  }
}
