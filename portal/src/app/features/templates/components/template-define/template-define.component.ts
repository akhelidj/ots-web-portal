import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminTemplatesService,
  ChildReportTypeChoice,
  DefineTemplateDto,
  ExtractedToken,
  OpsFieldType,
  OpsTokenField,
} from '@portal/features/templates/services/admin-templates.service';

/**
 * Phase D step 2b — the describe screen, presented as a STEPPED WIZARD.
 *
 * After a template is uploaded, an admin opens "Define" for it here: the screen fetches
 * the workbook's extracted tokens (`GET /templates/:id/tokens`), lets the admin describe
 * each one (label / type / required / options / header-vs-item scope), designate exactly
 * one token as the repeating serial marker, then submits the assembled description via
 * `PUT /templates/:id/definition`.
 *
 * WIZARD: the same phases are now walked one step at a time — Layout → (Region & Marker,
 * only for repeating-row templates) → Describe Fields → Review & Save. The visible step
 * sequence is a `computed()` off `hasRepeatingRows` so a flat template shows the TRUE count
 * (3 steps, Region omitted entirely — never a dead/greyed step) and a region one shows 4.
 * Back/Next only navigate; all entered state lives on the component (signals + ngModel
 * fields), so nothing resets on navigation. A single terminal `submit()` — one `PUT`, no
 * incremental save.
 *
 * SUBMIT-AND-SURFACE: there is NO client reimplementation of the server's seven checks.
 * The gate is the sole authority. The only client-side niceties are: pick a marker, name
 * the region, and don't submit an empty label — now expressed as per-step validity
 * predicates (ONE source of truth) that gate "Next" and that `submit()` reuses. Everything
 * else — select-without-options, unknown tokens, unrenderable types, malformed rework rule
 * — is left to the server, whose per-check reason is rendered inline on the Review step.
 * Works for an ARBITRARY token set, not a drill-pipe-shaped one.
 */

const FIELD_TYPES: OpsFieldType[] = [
  'text',
  'number',
  'boolean',
  'select',
  'date',
];

/** The child report types a rework rule may upsert (mirrors the API's ChildReportType). */
const CHILD_REPORT_TYPES: ChildReportTypeChoice[] = ['REWORK', 'SCRAP', 'HOLD'];

/** One trigger-field choice for the rework rule: the derived key the interpreter matches
 *  on, shown by the author's label. */
export interface TriggerFieldOption {
  /** The value emitted as `reworkRule.field` — the token-derived key (single segment). */
  key: string;
  /** What the author sees (their label, falling back to the token). */
  label: string;
}

/** One row of the describe table — the editable per-token state. */
export interface DescribeRow {
  token: string;
  cell: string;
  /** Include this token as a described field. Off = ignore it (unreferenced). */
  include: boolean;
  label: string;
  type: OpsFieldType;
  required: boolean;
  scope: 'header' | 'item';
  section: string;
  /** Comma-separated choices; only meaningful when `type === 'select'`. */
  optionsText: string;
}

/** The wizard steps. `region` is present ONLY for repeating-row templates. */
export type WizardStepKey = 'layout' | 'region' | 'describe' | 'review';

export interface WizardStep {
  key: WizardStepKey;
  label: string;
}

@Component({
  selector: 'app-template-define',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './template-define.component.html',
})
export class TemplateDefineComponent implements OnInit {
  private templatesService = inject(AdminTemplatesService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  public readonly fieldTypes = FIELD_TYPES;
  public readonly childReportTypes = CHILD_REPORT_TYPES;

  public templateId = '';

  // The app is ZONELESS: no zone.js drives change detection. State the template
  // branches on and that is mutated AFTER an await (the token load, the submit result)
  // must be a signal, or the view never re-renders when the async work settles — the
  // exact bug that left this screen stuck on "Loading tokens…" after a 200. The
  // `[(ngModel)]` fields below stay plain: they change via DOM events, which already
  // notify the zoneless scheduler (and two-way binding needs a plain field, not a signal).
  public readonly rows = signal<DescribeRow[]>([]);

  // The explicit flat-vs-region discriminator. Ops DECLARES the layout — the app does
  // NOT infer it from tokens. OFF (default) = flat (a single record, no repeating rows →
  // the DTO omits `region`, which the server builds as `regions: []`); ON = region (the
  // report has repeating serial rows). A SIGNAL (not a plain field) because the wizard's
  // `visibleSteps` computed derives off it — flipping it must recompute the step sequence.
  // A signal can't be the target of `[(ngModel)]`, so the checkbox two-way-binds via
  // `[ngModel]` + `(ngModelChange)="onRepeatingRowsChange($event)"`.
  public readonly hasRepeatingRows = signal(false);

  // Region / marker declaration ([(ngModel)] two-way — plain, event-driven).
  public displayName = '';
  public regionId = 'serials';
  public regionLabel = '';
  /** The token literal chosen as the repeating serial marker (region.marker). */
  public markerToken = '';

  // Rework trigger (slice A) — OFF by default (no rule). All plain [(ngModel)] fields:
  // they change via DOM events, which already notify the zoneless scheduler. When OFF the
  // DTO omits `reworkRule` entirely; when ON the current values are shipped verbatim and
  // the SERVER gate is the sole authority on validity (an incomplete rule surfaces the
  // gate's rejection, exactly like every other check). The author picks only the shape the
  // interpreter consumes — trigger field, equality value, child type, optional suffix.
  public reworkEnabled = false;
  /** The derived key (reworkRule.field) of the field whose value triggers the rule. */
  public reworkField = '';
  public reworkEquals = '';
  public reworkChildType: ChildReportTypeChoice = 'REWORK';
  public reworkSuffix = '';

  // UI state (signals — set after async work, read by the template).
  public readonly isLoading = signal(true);
  public readonly isSubmitting = signal(false);
  public readonly loadError = signal('');
  /** The gate's per-check reason (from a 4xx). */
  public readonly submitError = signal('');
  public readonly failedCheck = signal('');
  public readonly success = signal(false);

  // ---------------------------------------------------------------------------
  // Wizard navigation
  // ---------------------------------------------------------------------------

  /** Index into `visibleSteps()`. A signal so the zoneless view re-renders on Back/Next. */
  public readonly currentStep = signal(0);

  /**
   * The visible step sequence — DYNAMIC: the `region` step exists only for repeating-row
   * templates. A `computed()` off the `hasRepeatingRows` signal so a flat template renders
   * the true 3-step count (Region omitted, not greyed) and a region one renders 4.
   */
  public readonly visibleSteps = computed<WizardStep[]>(() => {
    const steps: WizardStep[] = [{ key: 'layout', label: 'Layout' }];
    if (this.hasRepeatingRows()) {
      steps.push({ key: 'region', label: 'Region & Marker' });
    }
    steps.push({ key: 'describe', label: 'Describe Fields' });
    steps.push({ key: 'review', label: 'Review & Save' });
    return steps;
  });

  /** The current step descriptor. Clamped defensively; navigation keeps the index in range
   *  (the layout toggle — the only thing that resizes the sequence — lives on step 0). */
  public readonly activeStep = computed<WizardStep>(() => {
    const steps = this.visibleSteps();
    const i = Math.min(Math.max(this.currentStep(), 0), steps.length - 1);
    // `steps` always starts with `layout`, so the fallback is only for the type checker
    // (noUncheckedIndexedAccess) — the clamped index is always in range at runtime.
    return steps[i] ?? { key: 'layout', label: 'Layout' };
  });

  public readonly isFirstStep = computed(() => this.currentStep() === 0);
  public readonly isLastStep = computed(
    () => this.currentStep() >= this.visibleSteps().length - 1,
  );

  async ngOnInit(): Promise<void> {
    this.templateId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load();
  }

  public async load(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      const tokens = await this.templatesService.getTokens(this.templateId);
      this.rows.set(this.toRows(tokens));
    } catch (e: unknown) {
      this.loadError.set(
        this.errorMessage(e, 'Failed to load template tokens. Are you online?'),
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /** De-dupe the token list (a token can appear in multiple cells) into one row each. */
  private toRows(tokens: ExtractedToken[]): DescribeRow[] {
    const seen = new Set<string>();
    const rows: DescribeRow[] = [];
    for (const t of tokens) {
      if (seen.has(t.token)) continue;
      seen.add(t.token);
      rows.push({
        token: t.token,
        cell: t.cell,
        include: true,
        label: '',
        type: 'text',
        required: false,
        scope: 'header',
        section: '',
        optionsText: '',
      });
    }
    return rows;
  }

  /** Flat/region toggle handler — writes the signal (so `visibleSteps` recomputes) and
   *  clears any stale submit error. Only reachable on step 0, so `currentStep` stays valid. */
  public onRepeatingRowsChange(value: boolean): void {
    this.hasRepeatingRows.set(value);
    this.submitError.set('');
    this.failedCheck.set('');
  }

  /** Choosing a marker excludes that token from the described fields. */
  public onMarkerChange(): void {
    this.submitError.set('');
    this.failedCheck.set('');
  }

  public isMarker(row: DescribeRow): boolean {
    // Only a REGION template has a marker. In flat mode there is no repeating row, so no
    // token is the marker — every included row is a described field (even if a stale
    // markerToken lingered from a region-mode toggle).
    return this.hasRepeatingRows() && row.token === this.markerToken;
  }

  /** The rows that will be sent as described fields (included, not the marker). */
  public describedRows(): DescribeRow[] {
    return this.rows().filter((r) => r.include && !this.isMarker(r));
  }

  /** Token → data key: strip the `{{ }}`, matching the server builder's `strip`. This is
   *  the single-segment key the described field is stored under in a serial's
   *  inspectionData — exactly what the interpreter resolves `when.field` against. */
  private stripToken(token: string): string {
    return token.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
  }

  /**
   * The fields eligible as a rework trigger — those whose value lives on a SERIAL's
   * inspectionData (what the interpreter matches on). In region mode that is the item-scope
   * described fields; in flat mode the single record IS the serial, so every described
   * field qualifies. Presented by label, valued by the derived key. Template-agnostic — no
   * field name is special-cased.
   *
   * A METHOD, not a computed: it must reflect in-place edits to a row's label/scope made on
   * the Describe step (the described rows are mutated through ngModel, which does NOT
   * reassign the `rows` signal, so a `computed(() => …rows()…)` would miss them). Called
   * from the Review-step template, it re-evaluates on every change-detection pass — and the
   * zoneless scheduler runs one on the Back→edit and on the Next click — so the dropdown is
   * always rebuilt from the current row values when the author reaches Review.
   */
  public triggerFieldOptions(): TriggerFieldOption[] {
    const described = this.describedRows();
    const eligible = this.hasRepeatingRows()
      ? described.filter((r) => r.scope === 'item')
      : described;
    return eligible.map((r) => ({
      key: this.stripToken(r.token),
      label: r.label.trim() || r.token,
    }));
  }

  // ---------------------------------------------------------------------------
  // Per-step validity — ONE source of truth (gates "Next"; `submit()` reuses these)
  // ---------------------------------------------------------------------------

  /** Region step: a marker token and a region id are the only client-checkable minimums
   *  (Display Name and Region Label are optional). */
  public regionStepValid(): boolean {
    return !!this.markerToken && !!this.regionId.trim();
  }

  /** Describe step: at least one described field, and every included field has a label. */
  public describeStepValid(): boolean {
    const described = this.describedRows();
    if (described.length === 0) return false;
    return described.every((r) => !!r.label.trim());
  }

  /** Whether a step is complete enough to advance from / save on. Layout is always valid
   *  (just a toggle); Review's gate is the full `canSave()` composition. */
  public stepValid(key: WizardStepKey): boolean {
    switch (key) {
      case 'layout':
        return true;
      case 'region':
        return this.regionStepValid();
      case 'describe':
        return this.describeStepValid();
      case 'review':
        return this.canSave();
    }
  }

  /** "Next" gate for the active step. */
  public canGoNext(): boolean {
    return this.stepValid(this.activeStep().key);
  }

  public next(): void {
    if (!this.canGoNext()) return;
    const last = this.visibleSteps().length - 1;
    if (this.currentStep() < last) {
      this.currentStep.update((s) => s + 1);
    }
  }

  public prev(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update((s) => s - 1);
    }
  }

  /**
   * The client-checkable minimum for a Save — COMPOSED from the same per-step predicates
   * the wizard gates on (no third copy). The SERVER gate stays the sole authority on the
   * seven semantic checks; this only guards what the client can already see is wrong.
   * Mode-aware: region mode additionally needs a marker + region id.
   */
  public canSave(): boolean {
    if (!this.describeStepValid()) return false;
    if (this.hasRepeatingRows() && !this.regionStepValid()) return false;
    return true;
  }

  /** Assemble the request body from the current form state. Pure. */
  public buildDto(): DefineTemplateDto {
    const fields: OpsTokenField[] = this.describedRows().map((r) => {
      const field: OpsTokenField = {
        token: r.token,
        label: r.label.trim(),
        type: r.type,
        required: r.required,
        scope: r.scope,
      };
      if (r.section.trim()) {
        field.section = r.section.trim();
      }
      if (r.type === 'select') {
        field.options = r.optionsText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      return field;
    });

    const dto: DefineTemplateDto = { fields };
    if (this.displayName.trim()) {
      dto.displayName = this.displayName.trim();
    }
    // Rework rule: emitted ONLY when the author turned it on. OFF → omit entirely (never a
    // fabricated rule). When ON the current values ship verbatim, including an incomplete
    // one — the server gate is the sole authority and rejects a malformed rule (e.g. an
    // unpicked trigger field) with its `rework-rules` check, surfaced inline like any other.
    if (this.reworkEnabled) {
      dto.reworkRule = {
        field: this.reworkField,
        equals: this.reworkEquals.trim(),
        childType: this.reworkChildType,
      };
      if (this.reworkSuffix.trim()) {
        dto.reworkRule.reportNumberSuffix = this.reworkSuffix.trim();
      }
    }
    // FLAT (toggle off): omit `region` entirely → the server builds `regions: []` and
    // every field resolves as record data. REGION (toggle on): today's region+marker.
    if (this.hasRepeatingRows()) {
      dto.region = {
        id: this.regionId.trim(),
        marker: this.markerToken,
      };
      if (this.regionLabel.trim()) {
        dto.region.label = this.regionLabel.trim();
      }
    }
    return dto;
  }

  public async submit(): Promise<void> {
    this.submitError.set('');
    this.failedCheck.set('');
    this.success.set(false);

    // Final client-side guard — REUSES the same per-step predicates the wizard gates on,
    // with granular messages. NOT a reimplementation of the server gate. The marker/region
    // checks apply ONLY in region mode; in flat mode there is no marker.
    if (this.hasRepeatingRows() && !this.regionStepValid()) {
      this.submitError.set(
        !this.markerToken
          ? 'Choose which token marks a repeating serial row (the region marker).'
          : 'Give the repeating region an id.',
      );
      return;
    }
    if (!this.describeStepValid()) {
      this.submitError.set(
        this.describedRows().length === 0
          ? 'Describe at least one field before saving.'
          : 'Every included field needs a label.',
      );
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.templatesService.defineTemplate(this.templateId, this.buildDto());
      this.success.set(true);
    } catch (e: unknown) {
      const body = (e as { error?: { check?: string; message?: string } })?.error;
      this.failedCheck.set(body?.check ?? '');
      this.submitError.set(this.errorMessage(e, 'Failed to save the definition.'));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  public backToList(): void {
    this.router.navigate(['/admin/templates']);
  }

  /** Extract the server's message from either a structured gate body or a plain error. */
  private errorMessage(e: unknown, fallback: string): string {
    const err = e as { error?: { message?: string }; message?: string };
    return err?.error?.message || err?.message || fallback;
  }
}
