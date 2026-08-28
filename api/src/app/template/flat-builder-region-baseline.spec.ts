/**
 * Region authoring byte-unchanged proof (unit, no DB) — Phase D flat step 2.
 *
 * Relaxing the authoring layer to allow region-less (flat) definitions must NOT change
 * what the builder emits for a REGION (drill-pipe-shaped) description. Same discipline
 * as step 1's export baseline: a representative region DTO's built CandidateDefinition
 * is frozen from the PRE-change builder and committed; every later run asserts the
 * post-change builder produces the identical object. "The existing specs pass" is not
 * enough — this pins the exact structure.
 *
 * FREEZE PROTOCOL: written once by running this spec against the un-edited builder
 * (write-if-missing). Delete the fixture and re-run on known-good code to re-baseline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildDefinition } from './definition-builder';
import { DefineTemplateDto } from './definition-authoring.types';

const BASELINE_PATH = resolve(
  __dirname,
  '__fixtures__/region-definition.builder.baseline.json',
);

const META = { templateKey: 'DRILL_PIPE_REPORT', templateVersion: 1 };

/** A rich region description: header + item fields, a select, a computed, a disposition. */
function regionDto(): DefineTemplateDto {
  return {
    displayName: 'Casing Report',
    region: {
      id: 'serials',
      marker: '{{sn}}',
      label: 'Inspected Serials',
      chunkSize: 10,
    },
    disposition: { field: 'emi', requiredForApproval: true },
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
    computed: [{ token: '{{customer}}', computed: 'customerName' }],
  };
}

describe('Region builder output — frozen structural baseline', () => {
  it('the region description builds the identical definition as before the flat change', () => {
    const built = buildDefinition(META, regionDto());

    if (!existsSync(BASELINE_PATH)) {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, JSON.stringify(built, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.warn(`[baseline] wrote frozen region builder output → ${BASELINE_PATH}`);
      return;
    }

    const frozen = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(built).toEqual(frozen);
  });

  it('non-vacuity: a changed region description diverges from the frozen baseline', () => {
    if (!existsSync(BASELINE_PATH)) return;
    const frozen = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    const dto = regionDto();
    // The region id is now an internal constant (ignored from the DTO), so mutate a
    // field that still flows to the output — the serial token — to prove non-vacuity.
    dto.region.marker = '{{different_sn}}';
    expect(buildDefinition(META, dto)).not.toEqual(frozen);
  });
});
