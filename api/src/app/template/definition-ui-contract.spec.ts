/**
 * Phase D step 2b — the describe-screen ⇄ gate contract (deliverable 1 gate proof).
 *
 * The portal describe screen assembles a DefineTemplateDto and submits it to the 2a gate.
 * This proves the EXACT body the UI emits is ACCEPTED by the real write-time gate, and
 * that a bad variant is REJECTED with the gate's per-check reason — driven against the
 * REAL fixture workbook's real tokens, through the real builder + validator. No DB, no
 * mocks: `TokenExtractorService` and the gate functions are pure.
 *
 * The `UI_DTO` here is byte-identical to the portal spec's EXPECTED_DTO
 * (template-define.component.spec.ts). That spec proves the UI emits this body; this one
 * proves the gate accepts it. Together: the describe screen assembles a body the gate
 * accepts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { XlsNormalizerService } from './xls-normalizer.service';
import { TokenExtractorService } from './token-extractor.service';
import { buildDefinition } from './definition-builder';
import { validateDefinition } from './definition-validator';
import { DefineTemplateDto } from './definition-authoring.types';

const REAL_TEMPLATE_BYTES = readFileSync(
  resolve(__dirname, '../../../scripts/valid-template.xlsx'),
);

const META = { templateKey: 'FIXTURE_REPORT', templateVersion: 1 };

/** The exact body the describe screen emits (portal EXPECTED_DTO). */
function uiDto(): DefineTemplateDto {
  return {
    displayName: 'Casing Report',
    region: { id: 'serials', marker: '{{sn}}', label: 'Inspected Serials' },
    fields: [
      { token: '{{poNumber}}', label: 'PO Number', type: 'text', required: false, scope: 'header' },
      { token: '{{reportDate}}', label: 'Report Date', type: 'date', required: false, scope: 'header' },
      { token: '{{b_od}}', label: 'Box Min OD', type: 'text', required: true, scope: 'item', section: 'Box' },
      {
        token: '{{emi}}',
        label: 'EMI Result',
        type: 'select',
        required: true,
        scope: 'item',
        section: 'Body',
        options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'],
      },
    ],
  };
}

describe('describe-screen DTO ⇄ 2a gate contract', () => {
  let extractedTokens: Set<string>;

  beforeAll(async () => {
    const normalized = new XlsNormalizerService().normalizeToXlsx(
      REAL_TEMPLATE_BYTES,
    );
    const extracted = await new TokenExtractorService().extractTokens(normalized);
    extractedTokens = new Set(extracted.map((t) => t.token));
  });

  it('the fixture really contains every token the UI DTO references', () => {
    for (const t of ['{{sn}}', '{{poNumber}}', '{{reportDate}}', '{{b_od}}', '{{emi}}']) {
      expect(extractedTokens.has(t)).toBe(true);
    }
  });

  it('ACCEPTS the exact body the describe screen emits', () => {
    const candidate = buildDefinition(META, uiDto());
    expect(validateDefinition(candidate, extractedTokens)).toEqual({ ok: true });
  });

  it('REJECTS a select-without-options variant with the gate’s per-check reason', () => {
    const dto = uiDto();
    // Same edit a mistaken admin would make; the UI leaves this check to the server.
    delete (dto.fields[3] as { options?: string[] }).options;

    const candidate = buildDefinition(META, dto);
    const outcome = validateDefinition(candidate, extractedTokens);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected rejection');
    expect(outcome.check).toBe('select-options');
    expect(outcome.reason).toContain('must declare non-empty options');
  });
});
