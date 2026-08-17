import { Component, inject, OnInit } from '@angular/core';
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
  public rows: DescribeRow[] = [];

  // Region / marker declaration.
  public displayName = '';
  public regionId = 'serials';
  public regionLabel = '';
  /** The token literal chosen as the repeating serial marker (region.marker). */
  public markerToken = '';

  // UI state.
  public isLoading = true;
  public isSubmitting = false;
  public loadError = '';
  /** The gate's per-check reason (from a 4xx). */
  public submitError = '';
  public failedCheck = '';
  public success = false;

  async ngOnInit(): Promise<void> {
    this.templateId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.load();
  }

  public async load(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const tokens = await this.templatesService.getTokens(this.templateId);
      this.rows = this.toRows(tokens);
    } catch (e: unknown) {
      this.loadError = this.errorMessage(
        e,
        'Failed to load template tokens. Are you online?',
      );
    } finally {
      this.isLoading = false;
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
    this.submitError = '';
    this.failedCheck = '';
  }

  public isMarker(row: DescribeRow): boolean {
    return row.token === this.markerToken;
  }

  /** The rows that will be sent as described fields (included, not the marker). */
  public describedRows(): DescribeRow[] {
    return this.rows.filter((r) => r.include && !this.isMarker(r));
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

    const dto: DefineTemplateDto = {
      region: {
        id: this.regionId.trim(),
        marker: this.markerToken,
      },
      fields,
    };
    if (this.displayName.trim()) {
      dto.displayName = this.displayName.trim();
    }
    if (this.regionLabel.trim()) {
      dto.region.label = this.regionLabel.trim();
    }
    return dto;
  }

  public async submit(): Promise<void> {
    this.submitError = '';
    this.failedCheck = '';
    this.success = false;

    // Light client-side niceties only — NOT a reimplementation of the server gate.
    if (!this.markerToken) {
      this.submitError =
        'Choose which token marks a repeating serial row (the region marker).';
      return;
    }
    if (!this.regionId.trim()) {
      this.submitError = 'Give the repeating region an id.';
      return;
    }
    const described = this.describedRows();
    if (described.length === 0) {
      this.submitError = 'Describe at least one field before saving.';
      return;
    }
    if (described.some((r) => !r.label.trim())) {
      this.submitError = 'Every included field needs a label.';
      return;
    }

    this.isSubmitting = true;
    try {
      await this.templatesService.defineTemplate(this.templateId, this.buildDto());
      this.success = true;
    } catch (e: unknown) {
      const body = (e as { error?: { check?: string; message?: string } })?.error;
      this.failedCheck = body?.check ?? '';
      this.submitError = this.errorMessage(e, 'Failed to save the definition.');
    } finally {
      this.isSubmitting = false;
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
