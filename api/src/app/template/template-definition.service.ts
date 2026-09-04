import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { buildDefinition } from './definition-builder';
import { validateDefinition, referencedTokens } from './definition-validator';
import {
  DefineTemplateDto,
  CandidateDefinition,
} from './definition-authoring.types';

/**
 * Phase D — write path for `PUT /templates/:id/definition`, now with durable edit
 * history (option b).
 *
 * Turns an untrusted ops description into a validated `definitionJson`, or refuses it
 * atomically — AND, in the same transaction as the overwrite, appends a
 * TemplateDefinitionRevision capturing the PRIOR definition (the state being replaced),
 * so an edit can never silently destroy the previous definition (the clobber gap).
 *
 * Sequence (`applyDefinition`, shared by define + restore):
 *   1. Load the row (tenant-scoped: NotFound / Forbidden, mirroring deprecate).
 *   2. Re-extract the workbook's tokens — the ground truth to validate against.
 *   3. Validate the candidate (seven checks + rework dry-run). Any failure → 400,
 *      nothing written. A RESTORED definition runs the SAME gate — never trusted blindly.
 *   4. In ONE transaction: re-read the current definition, and if it is non-null append a
 *      revision preserving it (with a token-set signature + a cosmetic-vs-structural
 *      flag), then overwrite `definitionJson`. `Template.definitionJson` stays the
 *      authoritative CURRENT — no consumer read path touches the revision table.
 *
 * First-ever define (prior is NULL) records NO revision: there is no prior state to lose,
 * so every stored revision holds a real, non-null prior definition.
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
    userId: string,
  ) {
    const template = await this.loadTemplate(tenantId, templateId);

    // Build → validate happens inside applyDefinition; buildDefinition throws BadRequest
    // on structurally-broken input up front here.
    const candidate = buildDefinition(
      {
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
      },
      dto,
    );

    return this.applyDefinition(template, candidate, userId, 'define');
  }

  /**
   * Restore a prior revision's definition as a NEW define write. The stored blob is a
   * built candidate, so build is skipped, but it runs the SAME validation gate as a normal
   * define (re-validated against the workbook's current tokens — never trusted blindly).
   * Because restore is just another write, it snapshots the current-before-restore as a
   * fresh revision — restore is fully reversible.
   */
  async restoreDefinitionRevision(
    tenantId: string,
    templateId: string,
    revisionNumber: number,
    userId: string,
  ) {
    const template = await this.loadTemplate(tenantId, templateId);

    const revision = await this.prisma.templateDefinitionRevision.findUnique({
      where: { templateId_revisionNumber: { templateId, revisionNumber } },
    });
    if (!revision || revision.tenantId !== tenantId) {
      throw new NotFoundException('Definition revision not found');
    }

    const candidate = revision.definitionJson as unknown as CandidateDefinition;
    return this.applyDefinition(
      template,
      candidate,
      userId,
      `restore of revision ${revisionNumber}`,
    );
  }

  /**
   * Read the template's CURRENT definition (the authoritative `Template.definitionJson`) for
   * the admin define surface. Tenant-scoped (NotFound / Forbidden, mirroring the write path),
   * and deliberately does NOT load `fileBlob` — this is a light read the Define page hits on
   * open to decide defined-vs-undefined and hydrate the read-only recap. `definitionJson` is
   * null for a never-defined template (today's full authoring flow) and the stored
   * CandidateDefinition once defined (the read-only recap source).
   */
  async getDefinition(tenantId: string, templateId: string) {
    const template = await this.prisma.template.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        tenantId: true,
        templateKey: true,
        templateVersion: true,
        status: true,
        definitionJson: true,
      },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.tenantId !== tenantId) {
      throw new ForbiddenException('Access denied');
    }
    return {
      templateKey: template.templateKey,
      templateVersion: template.templateVersion,
      status: template.status,
      definitionJson: template.definitionJson,
    };
  }

  /**
   * History listing for the admin restore/browse surface: metadata + revisionNumber +
   * tokensChanged + who/when/why, NEWEST first. Deliberately NOT the full definitionJson
   * blob (the list stays light; the blob is fetched only by restore).
   */
  async listDefinitionRevisions(tenantId: string, templateId: string) {
    await this.loadTemplate(tenantId, templateId); // tenant-scoped existence check
    return this.prisma.templateDefinitionRevision.findMany({
      where: { templateId, tenantId },
      orderBy: { revisionNumber: 'desc' },
      select: {
        revisionNumber: true,
        tokensChanged: true,
        tokenSetHash: true,
        revisedAt: true,
        revisedById: true,
        revisionReason: true,
      },
    });
  }

  // -- internals ------------------------------------------------------------------------

  private async loadTemplate(tenantId: string, templateId: string) {
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
    return template;
  }

  /**
   * The shared write core: validate the candidate against the workbook's tokens, then —
   * atomically — capture the prior definition as a revision and overwrite the current one.
   */
  private async applyDefinition(
    template: {
      id: string;
      tenantId: string;
      templateKey: string;
      templateVersion: number;
      fileBlob: Uint8Array;
    },
    candidate: CandidateDefinition,
    userId: string,
    reason: string,
  ) {
    // Ground truth: the tokens actually in the workbook.
    const normalized = this.normalizer.normalizeToXlsx(
      Buffer.from(template.fileBlob),
    );
    const extracted = await this.extractor.extractTokens(normalized);
    const extractedTokens = new Set(extracted.map((t) => t.token));

    const outcome = validateDefinition(candidate, extractedTokens);
    if (!outcome.ok) {
      throw new BadRequestException({
        code: 'DEFINITION_INVALID',
        check: outcome.check,
        message: outcome.reason,
      });
    }

    // The incoming definition's token signature — reuses the validator's own
    // token-collection helper (no reimplemented token parsing).
    const newTokens = tokenSignature(candidate);

    return this.prisma.$transaction(async (tx) => {
      // Re-read the CURRENT definition inside the txn so the captured prior is exactly the
      // state we are replacing (correct even under a concurrent write).
      const current = await tx.template.findUnique({
        where: { id: template.id },
        select: { definitionJson: true },
      });
      const prior = current?.definitionJson ?? null;

      // First-ever define (prior NULL) → nothing to preserve, no revision. Otherwise
      // append a revision holding the prior, with a token-set signature + whether THIS
      // edit changed the token set (structural) vs left it intact (cosmetic).
      if (prior != null) {
        const priorTokens = tokenSignature(prior as unknown as CandidateDefinition);
        const tokensChanged = priorTokens.hash !== newTokens.hash;
        const last = await tx.templateDefinitionRevision.findFirst({
          where: { templateId: template.id },
          orderBy: { revisionNumber: 'desc' },
          select: { revisionNumber: true },
        });
        const revisionNumber = (last?.revisionNumber ?? 0) + 1;
        await tx.templateDefinitionRevision.create({
          data: {
            templateId: template.id,
            revisionNumber,
            definitionJson: prior as Prisma.InputJsonValue,
            tokenSetHash: priorTokens.hash,
            tokensChanged,
            revisedById: userId,
            revisionReason: reason,
            tenantId: template.tenantId,
          },
        });
      }

      return tx.template.update({
        where: { id: template.id },
        data: { definitionJson: candidate as unknown as Prisma.InputJsonValue },
        select: {
          id: true,
          templateKey: true,
          templateVersion: true,
          status: true,
          definitionJson: true,
        },
      });
    });
  }
}

/**
 * Stable signature of a definition's referenced-token set. Sorts + dedupes the token
 * literals the validator's `referencedTokens` already collects (export entries, which
 * include the serial's own token) and hashes them, so two definitions with the same
 * tokens in any order share a
 * hash. A missing/garbled blob degrades to an empty set rather than throwing — history
 * capture must never block a write.
 */
function tokenSignature(def: CandidateDefinition): {
  tokens: string[];
  hash: string;
} {
  let tokens: string[] = [];
  try {
    tokens = [...new Set(referencedTokens(def))].sort();
  } catch {
    tokens = [];
  }
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(tokens))
    .digest('hex');
  return { tokens, hash };
}
