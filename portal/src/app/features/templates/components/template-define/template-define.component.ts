import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminTemplatesService,
  ChildReportTypeChoice,
  DefineTemplateDto,
  ExtractedToken,
  FieldRole,
  isTemplateDefined,
  OpsFieldType,
  OpsTokenField,
  StoredDefinition,
} from '@portal/features/templates/services/admin-templates.service';
import { ToastService } from '@portal/shared/toast/toast.service';

/**
 * Phase D — the Define-Template wizard, reshaped to a fixed FOUR-step flow that mirrors
 * how a workbook is actually structured:
 *
 *   Detect Tokens → Metadata → Serial → Review & Save.
 *
 * Every template now has a repeating serial region (there is no flat authoring here), so
 * the old Layout/Region steps and the `hasRepeatingRows` discriminator are gone. SCOPE is
 * DERIVED from which step claims a token: a token included on the Header step exports as a
 * `header` field; every other token is a `serial` (`item`) field. The serial's own token —
 * the one whose value is the serial NUMBER written into each repeating row — is designated
 * by a per-token ROLE (`serialNumber`) rather than a separate marker picker, exactly as the
 * three header roles (inspector/supervisor/inspectionDate) designate system-owned header
 * fields. `buildDto` reads the `serialNumber`-roled token and sends it as `region.marker`.
 *
 * SUBMIT-AND-SURFACE is unchanged: the server gate is the sole authority on the semantic
 * checks; the only client niceties are per-step validity predicates (ONE source of truth)
 * that gate "Next" and that `submit()` reuses.
 *
 * ZONELESS: async-set state (the token load, the submit result) is held in SIGNALS so the
 * scheduler re-renders when it settles. The `[(ngModel)]` row fields stay plain — they
 * change through DOM events, which already notify the zoneless scheduler; the derived row
 * lists are METHODS (not computeds) so they reflect in-place ngModel edits on every CD pass.
 */

/** The repeating region's id — an internal constant (the API ignores `region.id`). */
const REGION_ID = 'serials';

const FIELD_TYPES: OpsFieldType[] = ['text', 'number', 'boolean', 'select', 'date'];

/** The child report types a rework rule may upsert (mirrors the API's ChildReportType). */
const CHILD_REPORT_TYPES: ChildReportTypeChoice[] = ['REWORK', 'SCRAP', 'HOLD'];

/** The system roles a HEADER field may carry, shown in the Header step's Role select. */
export const HEADER_ROLE_OPTIONS: { value: FieldRole; label: string }[] = [
  { value: 'inspector', label: 'Inspector' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'inspectionDate', label: 'Inspection date' },
];

/** One trigger-field choice for the rework rule (see the region-mode dropdown). */
export interface TriggerFieldOption {
  key: string;
  label: string;
}

/**
 * One row of the describe state — one per extracted token. A token is claimed by AT MOST
 * one step: `header` true → a header field; otherwise it is a serial candidate and `serial`
 * governs inclusion. `role` is the per-token system role ('' = none).
 */
export interface DescribeRow {
  token: string;
  cell: string;
  /** The workbook row the token sits on (kept from detection; not rendered). */
  row: number;
  /** Included as a HEADER field. When true the token is not a serial candidate. */
  header: boolean;
  /** Included as a SERIAL (item) field. Meaningful only when `header` is false. */
  serial: boolean;
  label: string;
  type: OpsFieldType;
  required: boolean;
  section: string;
  /** Comma-separated choices; only meaningful when `type === 'select'`. */
  optionsText: string;
  /** '' = no role. A header role (Header step) or `serialNumber` (Serial step). */
  role: FieldRole | '';
}

export type WizardStepKey = 'detect' | 'header' | 'serial' | 'review';

export interface WizardStep {
  key: WizardStepKey;
  label: string;
}

/** The fixed four-step sequence — no dynamic/optional steps any more. */
const STEPS: WizardStep[] = [
  { key: 'detect', label: 'Detect Tokens' },
  { key: 'header', label: 'Metadata' },
  { key: 'serial', label: 'Serial' },
  { key: 'review', label: 'Review & Save' },
];

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
  private toast = inject(ToastService);
  private injector = inject(Injector);

  /**
   * The scroll region wrapping the active step body. Scroll now lives HERE (the bounded,
   * internally-scrolling step frame), not on `window`/`main`, so a step change resets THIS
   * element's scrollTop — see `scrollStepBodyToTop`.
   */
  private readonly stepBody =
    viewChild<ElementRef<HTMLElement>>('stepBody');

  public readonly fieldTypes = FIELD_TYPES;
  public readonly childReportTypes = CHILD_REPORT_TYPES;
  public readonly headerRoleOptions = HEADER_ROLE_OPTIONS;
  public readonly steps = STEPS;

  public templateId = '';

  // Async-set: a SIGNAL so the zoneless scheduler re-renders when the token load settles.
  public readonly rows = signal<DescribeRow[]>([]);

  // Save-time metadata + rework trigger — plain [(ngModel)] (event-driven; the scheduler is
  // already notified by the DOM event, and two-way binding needs a plain field).
  public displayName = '';
  public reworkEnabled = false;
  public reworkField = '';
  public reworkEquals = '';
  public reworkChildType: ChildReportTypeChoice = 'REWORK';
  public reworkSuffix = '';

  // Bulk-action inputs for the Serial step (apply Type / Section across the included rows).
  public bulkType: OpsFieldType = 'text';
  public bulkSection = '';

  // Once the author deliberately changes any serial row's role, the wizard stops
  // auto-defaulting the serialNumber marker (their choice wins).
  private markerTouched = false;

  // READ-ONLY recap mode. A defined template (definitionJson already saved) opens straight
  // to the recap with no route into the authoring steps — re-definition is a hard block
  // (#6). A signal because it is set after the async load settles (zoneless: the write
  // schedules the CD pass that renders the recap); the recap's data derives from the same
  // `rows()` signal + scalar fields that authoring uses, hydrated from the STORED definition.
  public readonly readOnly = signal(false);

  // UI state (signals — set after async work, read by the template).
  public readonly isLoading = signal(true);
  public readonly isSubmitting = signal(false);
  public readonly loadError = signal('');
  public readonly submitError = signal('');
  public readonly failedCheck = signal('');
  public readonly success = signal(false);

  // ---------------------------------------------------------------------------
  // Wizard navigation — a fixed four-step sequence.
  // ---------------------------------------------------------------------------

  public readonly currentStep = signal(0);

  public readonly activeStep = computed<WizardStep>(() => {
    const i = Math.min(Math.max(this.currentStep(), 0), STEPS.length - 1);
    // The clamped index is always in range; the fallback is only for the type checker
    // (noUncheckedIndexedAccess). STEPS always starts with `detect`.
    return STEPS[i] ?? { key: 'detect', label: 'Detect Tokens' };
  });

  public readonly isFirstStep = computed(() => this.currentStep() === 0);
  public readonly isLastStep = computed(
    () => this.currentStep() >= STEPS.length - 1,
  );

  async ngOnInit(): Promise<void> {
    this.templateId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load();
  }

  public async load(): Promise<void> {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      // #6 — decide defined-vs-undefined FIRST, from the authoritative stored definition
      // (server read), not from a re-extracted-token guess. A defined template becomes a
      // read-only recap hydrated from what was SAVED; an undefined one keeps today's full
      // authoring flow, unchanged.
      const detail = await this.templatesService.getDefinition(this.templateId);
      if (this.isDefined(detail.definitionJson)) {
        this.hydrateFromDefinition(detail.definitionJson);
        // Signal write LAST — flips the view to the recap and schedules the CD pass that
        // renders it (also flushing the scalar fields hydrateFromDefinition set).
        this.readOnly.set(true);
      } else {
        const tokens = await this.templatesService.getTokens(this.templateId);
        this.rows.set(this.toRows(tokens));
        this.markerTouched = false;
        this.ensureSerialMarkerDefault();
        this.readOnly.set(false);
      }
    } catch (e: unknown) {
      this.loadError.set(
        this.errorMessage(e, 'Failed to load template tokens. Are you online?'),
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * DEFINED-STATE detection (#6.1). The stored `definitionJson` is the API's built
   * CandidateDefinition; a real definition always carries at least one field (the engine
   * rejects an empty one at the gate). We test the actual shape — a non-empty `fields[]` —
   * rather than trusting a bare truthy check, so an empty/garbled `{}` still reads as
   * undefined and falls through to authoring.
   */
  private isDefined(def: StoredDefinition | null): def is StoredDefinition {
    return isTemplateDefined(def);
  }

  /**
   * Reverse-map a STORED definition into the wizard's describe rows + scalar state, so the
   * recap reflects exactly what was saved — roles, labels, marker, rework, scope — and never
   * re-infers from the workbook's current tokens (fidelity: if the file changed under a saved
   * definition, we show the saved definition). Scope is the source of truth for header-vs-
   * serial; the serial marker's EXACT token comes from `export.regions` (source `rowSerial`),
   * which is more precise than reconstructing it from the field key.
   */
  private hydrateFromDefinition(def: StoredDefinition): void {
    const markerToken = this.markerTokenFromExport(def);
    const rows: DescribeRow[] = (def.fields ?? []).map((f) => {
      const isMarker = f.role === 'serialNumber';
      return {
        token: isMarker && markerToken ? markerToken : `{{${f.key}}}`,
        cell: '',
        row: 0,
        header: f.scope === 'header',
        serial: f.scope === 'item',
        label: f.label ?? '',
        type: f.type ?? 'text',
        required: !!f.required,
        section: f.section ?? '',
        optionsText: Array.isArray(f.options) ? f.options.join(', ') : '',
        role: f.role ?? '',
      };
    });
    this.rows.set(rows);
    this.displayName = def.displayName ?? '';
    this.hydrateRework(def);
  }

  /** The serial marker's exact token, read back from the stored export (the `rowSerial`
   *  entry in the region's export list) — the marker's token is stored there, not on the
   *  field itself. Undefined if the definition carries no such entry. */
  private markerTokenFromExport(def: StoredDefinition): string | undefined {
    const regionId = def.regions?.[0]?.id ?? REGION_ID;
    const byRegion = def.export?.regions?.[regionId];
    const entry = byRegion?.find((e) => e.source === 'rowSerial') ?? byRegion?.[0];
    return entry?.token;
  }

  /** Reverse-map the stored rework rule (`rules[0]`, the interpreter's `when`/`then` shape)
   *  back onto the recap's scalar fields. Absent/malformed → no rule. */
  private hydrateRework(def: StoredDefinition): void {
    const rule = Array.isArray(def.rules) ? def.rules[0] : undefined;
    const r = (rule ?? {}) as {
      when?: { field?: string; value?: unknown };
      then?: { childType?: string; reportNumberSuffix?: string };
    };
    const field = r.when?.field;
    const childType = r.then?.childType;
    if (!field || !childType) {
      this.reworkEnabled = false;
      return;
    }
    this.reworkEnabled = true;
    this.reworkField = field;
    this.reworkEquals = r.when?.value == null ? '' : String(r.when.value);
    this.reworkChildType = CHILD_REPORT_TYPES.includes(
      childType as ChildReportTypeChoice,
    )
      ? (childType as ChildReportTypeChoice)
      : 'REWORK';
    this.reworkSuffix = r.then?.reportNumberSuffix ?? '';
  }

  /**
   * De-dupe the token list (a token can appear in multiple cells) into one row each. Every
   * token starts as a SERIAL candidate (pre-checked). The `serialNumber` marker default is
   * applied separately (ensureSerialMarkerDefault) so it always lands on the first token
   * still UNCLAIMED by Header, even after the author moves tokens into the header set.
   */
  private toRows(tokens: ExtractedToken[]): DescribeRow[] {
    const seen = new Set<string>();
    const rows: DescribeRow[] = [];
    for (const t of tokens) {
      if (seen.has(t.token)) continue;
      seen.add(t.token);
      rows.push({
        token: t.token,
        cell: t.cell,
        row: t.row,
        header: false,
        serial: true,
        label: '',
        type: 'text',
        required: false,
        section: '',
        optionsText: '',
        role: '',
      });
    }
    return rows;
  }

  /**
   * Default the `serialNumber` marker to the FIRST included serial field, unless the author
   * has already taken over (markerTouched) or a marker is already set. Run at load and on
   * entering the Serial step, so claiming the first token into Header re-homes the default
   * onto the next unclaimed token rather than silently leaving no marker.
   */
  private ensureSerialMarkerDefault(): void {
    if (this.markerTouched) return;
    const serials = this.serialRows();
    if (serials.length === 0) return;
    if (serials.some((r) => r.role === 'serialNumber')) return;
    const first = serials[0];
    if (!first) return;
    first.role = 'serialNumber';
    first.type = 'text';
    first.required = false;
  }

  private clearSubmitFeedback(): void {
    this.submitError.set('');
    this.failedCheck.set('');
  }

  // ---------------------------------------------------------------------------
  // Derived row lists — METHODS (reflect in-place ngModel edits every CD pass).
  // ---------------------------------------------------------------------------

  /** Every token — the Header step's grid iterates this. */
  public allRows(): DescribeRow[] {
    return this.rows();
  }

  /** Tokens claimed as HEADER fields. */
  public headerRows(): DescribeRow[] {
    return this.rows().filter((r) => r.header);
  }

  /** Tokens not claimed by Header — the Serial step's grid iterates this. */
  public serialCandidateRows(): DescribeRow[] {
    return this.rows().filter((r) => !r.header);
  }

  /** The included SERIAL (item) fields — what buildDto emits and validity checks. */
  public serialRows(): DescribeRow[] {
    return this.rows().filter((r) => !r.header && r.serial);
  }

  /** The serial row carrying the `serialNumber` role — its token is `region.marker`. */
  public serialMarkerRow(): DescribeRow | undefined {
    return this.serialRows().find((r) => r.role === 'serialNumber');
  }

  public allSerialSelected(): boolean {
    const candidates = this.serialCandidateRows();
    return candidates.length > 0 && candidates.every((r) => r.serial);
  }

  // ---------------------------------------------------------------------------
  // Include / role / bulk mutations.
  // ---------------------------------------------------------------------------

  /** Header-include toggle: claiming a token for Header removes it from the serial set and
   *  drops any role that no longer fits the new scope. Un-claiming returns it as a
   *  pre-checked serial candidate. */
  public onHeaderToggle(row: DescribeRow, checked: boolean): void {
    row.header = checked;
    if (checked) {
      row.serial = false;
      if (row.role === 'serialNumber') row.role = '';
    } else {
      row.serial = true;
      // Leaving Header: a header role no longer applies.
      if (row.role && row.role !== 'serialNumber') row.role = '';
    }
    this.clearSubmitFeedback();
  }

  /** Role select handler — enforces role UNIQUENESS in the UI (not just server-side) and
   *  forces the type a role implies (dates for inspectionDate, text otherwise); `required`
   *  is meaningless for a roled field. */
  public onRoleChange(row: DescribeRow): void {
    // A deliberate role change on a serial row means the author is managing the marker —
    // stop auto-defaulting it from here on.
    if (!row.header) {
      this.markerTouched = true;
    }
    if (row.role) {
      for (const other of this.rows()) {
        if (other !== row && other.role === row.role) other.role = '';
      }
      row.type = row.role === 'inspectionDate' ? 'date' : 'text';
      row.required = false;
    }
    this.clearSubmitFeedback();
  }

  public isRoled(row: DescribeRow): boolean {
    return row.role !== '';
  }

  public onSelectAllSerial(checked: boolean): void {
    for (const r of this.serialCandidateRows()) r.serial = checked;
    this.clearSubmitFeedback();
  }

  /** Bulk-set Type across the included serial rows (skips the roled marker — its type is
   *  forced). */
  public applyBulkType(): void {
    for (const r of this.serialRows()) {
      if (r.role) continue;
      r.type = this.bulkType;
    }
    this.clearSubmitFeedback();
  }

  /** Bulk-set Section across the included serial rows (skips the roled marker). */
  public applyBulkSection(): void {
    const section = this.bulkSection.trim();
    for (const r of this.serialRows()) {
      if (r.role) continue;
      r.section = section;
    }
    this.clearSubmitFeedback();
  }

  /** Token → data key: strip the `{{ }}`, matching the server builder's `strip`. */
  private stripToken(token: string): string {
    return token.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
  }

  /**
   * The fields eligible as a rework trigger — the included SERIAL fields (what the
   * interpreter matches on), minus the `serialNumber` marker (an identity, not a datum).
   * A METHOD so it reflects in-place row edits by the time the author reaches Review.
   */
  public triggerFieldOptions(): TriggerFieldOption[] {
    return this.serialRows()
      .filter((r) => r.role !== 'serialNumber')
      .map((r) => ({
        key: this.stripToken(r.token),
        label: r.label.trim() || r.token,
      }));
  }

  // ---------------------------------------------------------------------------
  // Per-step validity — ONE source of truth (gates "Next"; `submit()` reuses these).
  // ---------------------------------------------------------------------------

  /** Header step: zero header fields is allowed (an all-serial template); every INCLUDED
   *  header field needs a label. */
  public headerStepValid(): boolean {
    return this.headerRows().every((r) => !!r.label.trim());
  }

  /** Serial step: at least one included serial field, each with a label, and EXACTLY one
   *  `serialNumber` marker among them. */
  public serialStepValid(): boolean {
    const serial = this.serialRows();
    if (serial.length === 0) return false;
    if (!serial.every((r) => !!r.label.trim())) return false;
    return serial.filter((r) => r.role === 'serialNumber').length === 1;
  }

  public stepValid(key: WizardStepKey): boolean {
    switch (key) {
      case 'detect':
        return true;
      case 'header':
        return this.headerStepValid();
      case 'serial':
        return this.serialStepValid();
      case 'review':
        return this.canSave();
    }
  }

  public canGoNext(): boolean {
    return this.stepValid(this.activeStep().key);
  }

  public next(): void {
    if (!this.canGoNext()) return;
    if (this.currentStep() < STEPS.length - 1) {
      this.currentStep.update((s) => s + 1);
      this.onStepEntered();
    }
  }

  public prev(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update((s) => s - 1);
      this.onStepEntered();
    }
  }

  /** Per-step entry hook. Landing on Serial re-homes the serialNumber marker default onto
   *  the first still-unclaimed serial field (unless the author has taken it over); every
   *  step entry also returns the step body to the top so a new (often taller) step opens
   *  scrolled to its start rather than inheriting the previous step's offset. */
  private onStepEntered(): void {
    if (this.activeStep().key === 'serial') {
      this.ensureSerialMarkerDefault();
    }
    this.scrollStepBodyToTop();
  }

  /**
   * Reset the step body's internal scroll to the top on a step change. Scheduled as
   * POST-RENDER work (`afterNextRender`) rather than a synchronous DOM poke: the step swap is
   * signal-driven, so the new step's content only exists after the scheduler re-renders —
   * resetting scrollTop in that after-render hook lands on the fresh content and does not
   * fight the zoneless change-detection pass. The bound injector lets us call it from a plain
   * event handler (outside the constructor's injection context).
   */
  private scrollStepBodyToTop(): void {
    afterNextRender(
      () => {
        const el = this.stepBody()?.nativeElement;
        if (el) el.scrollTop = 0;
      },
      { injector: this.injector },
    );
  }

  /** The client-checkable minimum for a Save — composed from the same per-step predicates
   *  the wizard gates on. The SERVER gate stays the sole authority on the semantic checks. */
  public canSave(): boolean {
    return this.headerStepValid() && this.serialStepValid();
  }

  private toField(row: DescribeRow, scope: 'header' | 'item'): OpsTokenField {
    const field: OpsTokenField = {
      token: row.token,
      label: row.label.trim(),
      type: row.type,
      required: row.required,
      scope,
    };
    if (row.role) {
      field.role = row.role;
    }
    // Section only on plain (non-roled) serial fields — the marker has no section.
    if (scope === 'item' && !row.role && row.section.trim()) {
      field.section = row.section.trim();
    }
    if (row.type === 'select') {
      field.options = row.optionsText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return field;
  }

  /** Assemble the request body from the current form state. Pure. */
  public buildDto(): DefineTemplateDto {
    const fields: OpsTokenField[] = [
      ...this.headerRows().map((r) => this.toField(r, 'header')),
      ...this.serialRows().map((r) => this.toField(r, 'item')),
    ];

    const marker = this.serialMarkerRow();
    const dto: DefineTemplateDto = {
      fields,
      // Always a serial region now. `id` is an internal constant (the API ignores it);
      // `marker` is the `serialNumber`-roled token — the serial's own token → `rowSerial`.
      region: {
        id: REGION_ID,
        marker: marker ? marker.token : '',
      },
    };
    if (this.displayName.trim()) {
      dto.displayName = this.displayName.trim();
    }
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
    return dto;
  }

  public async submit(): Promise<void> {
    // #6.3 — a defined template is read-only: no save path exists in this mode. Defence in
    // depth behind the hidden nav (and the server's own PUT guard); re-shaping a form means
    // uploading a new template, not re-defining this one.
    if (this.readOnly()) return;

    this.clearSubmitFeedback();
    this.success.set(false);

    // Final client-side guard — REUSES the per-step predicates (not a reimplementation of
    // the server gate) with granular messages.
    if (!this.serialStepValid()) {
      const serial = this.serialRows();
      this.submitError.set(
        serial.length === 0
          ? 'Include at least one serial field before saving.'
          : serial.filter((r) => r.role === 'serialNumber').length !== 1
            ? 'Mark exactly one serial field as the Serial Number.'
            : 'Every included serial field needs a label.',
      );
      return;
    }
    if (!this.headerStepValid()) {
      this.submitError.set('Every included metadata field needs a label.');
      return;
    }

    this.isSubmitting.set(true);
    try {
      await this.templatesService.defineTemplate(this.templateId, this.buildDto());
      this.success.set(true);
      // Save landed — leave the wizard for the templates list and carry the confirmation
      // there as a toast (app-level, survives the navigation), rather than stranding the
      // author on the Review step behind an inline banner.
      this.toast.showSuccess(
        'Template form saved. It can now be used for reports.',
        'Saved',
      );
      await this.router.navigate(['/admin/templates']);
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

  private errorMessage(e: unknown, fallback: string): string {
    const err = e as { error?: { message?: string }; message?: string };
    return err?.error?.message || err?.message || fallback;
  }
}
