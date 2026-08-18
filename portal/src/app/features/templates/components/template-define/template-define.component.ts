import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminTemplatesService,
  DefineTemplateDto,
  ExtractedToken,
  OpsFieldType,
  OpsTokenField,
} from '@portal/features/templates/services/admin-templates.service';

/**
 * Phase D step 2b — the describe screen.
 *
 * After a template is uploaded, an admin opens "Define" for it here: the screen fetches
 * the workbook's extracted tokens (`GET /templates/:id/tokens`), lets the admin describe
 * each one (label / type / required / options / header-vs-item scope), designate exactly
 * one token as the repeating serial marker, then submits the assembled description via
 * `PUT /templates/:id/definition`.
 *
 * SUBMIT-AND-SURFACE: there is NO client reimplementation of the server's seven checks.
 * The gate is the sole authority. The only client-side niceties are: pick a marker, name
 * the region, and don't submit an empty label. Everything else — select-without-options,
 * unknown tokens, unrenderable types — is left to the server, whose per-check reason is
 * rendered inline. Works for an ARBITRARY token set, not a drill-pipe-shaped one.
 */

const FIELD_TYPES: OpsFieldType[] = [
  'text',
  'number',
  'boolean',
  'select',
  'date',
];

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
  // report has repeating serial rows). A plain [(ngModel)] field, not a signal: it is
  // mutated by a DOM checkbox event, which already notifies the zoneless scheduler, so CD
  // re-runs and the @if branches re-evaluate (same rationale as the other ngModel fields).
  public hasRepeatingRows = false;

  // Region / marker declaration ([(ngModel)] two-way — plain, event-driven).
  public displayName = '';
  public regionId = 'serials';
  public regionLabel = '';
  /** The token literal chosen as the repeating serial marker (region.marker). */
  public markerToken = '';

  // UI state (signals — set after async work, read by the template).
  public readonly isLoading = signal(true);
  public readonly isSubmitting = signal(false);
  public readonly loadError = signal('');
  /** The gate's per-check reason (from a 4xx). */
  public readonly submitError = signal('');
  public readonly failedCheck = signal('');
  public readonly success = signal(false);

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

  /** Choosing a marker excludes that token from the described fields. */
  public onMarkerChange(): void {
    this.submitError.set('');
    this.failedCheck.set('');
  }

  public isMarker(row: DescribeRow): boolean {
    // Only a REGION template has a marker. In flat mode there is no repeating row, so no
    // token is the marker — every included row is a described field (even if a stale
    // markerToken lingered from a region-mode toggle).
    return this.hasRepeatingRows && row.token === this.markerToken;
  }

  /** The rows that will be sent as described fields (included, not the marker). */
  public describedRows(): DescribeRow[] {
    return this.rows().filter((r) => r.include && !this.isMarker(r));
  }

  /**
   * The client-checkable minimum for a Save — the SAME light niceties `submit()` enforces,
   * used to disable the button so an author never spends a click learning the form is
   * already invalid (mirrors the inspection form's `[disabled]="formGroup.invalid"`). The
   * SERVER gate stays the sole authority on the seven semantic checks; this only guards
   * what the client can already see is wrong. Mode-aware: region mode additionally needs a
   * marker and a region id; flat mode does not (marker is irrelevant when there are no
   * repeating rows).
   */
  public canSave(): boolean {
    const described = this.describedRows();
    if (described.length === 0) return false;
    if (described.some((r) => !r.label.trim())) return false;
    if (this.hasRepeatingRows) {
      if (!this.markerToken) return false;
      if (!this.regionId.trim()) return false;
    }
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
    // FLAT (toggle off): omit `region` entirely → the server builds `regions: []` and
    // every field resolves as record data. REGION (toggle on): today's region+marker.
    if (this.hasRepeatingRows) {
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

    // Light client-side niceties only — NOT a reimplementation of the server gate. The
    // marker/region checks apply ONLY in region mode; in flat mode there is no marker.
    if (this.hasRepeatingRows) {
      if (!this.markerToken) {
        this.submitError.set(
          'Choose which token marks a repeating serial row (the region marker).',
        );
        return;
      }
      if (!this.regionId.trim()) {
        this.submitError.set('Give the repeating region an id.');
        return;
      }
    }
    const described = this.describedRows();
    if (described.length === 0) {
      this.submitError.set('Describe at least one field before saving.');
      return;
    }
    if (described.some((r) => !r.label.trim())) {
      this.submitError.set('Every included field needs a label.');
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
