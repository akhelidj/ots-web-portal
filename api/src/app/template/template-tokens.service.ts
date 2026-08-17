import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import {
  TokenExtractorService,
  ExtractedToken,
} from './token-extractor.service';

/**
 * Phase D step 1 — read-only orchestration for `GET /templates/:id/tokens`.
 *
 * Loads a stored template's `fileBlob`, normalizes it to `.xlsx` (legacy `.xls`
 * are converted at read time), and extracts its tokens. Kept as its OWN service
 * so the audited byte-storage / hash / versioning path in `TemplateService` is not
 * touched — this adds a new read path and nothing else. It NEVER writes:
 * no `definitionJson`, no `fileBlob`, no `hash`, no `version`.
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
  ) {}

  async getTokens(
    tenantId: string,
    templateId: string,
  ): Promise<ExtractedToken[]> {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: { tenantId: true, fileBlob: true },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.tenantId !== tenantId) {
      throw new ForbiddenException('Access denied');
    }

    const normalized = this.normalizer.normalizeToXlsx(
      Buffer.from(template.fileBlob),
    );
    return this.extractor.extractTokens(normalized);
  }
}
