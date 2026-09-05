import { Component, Input, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  TemplateFormDefinition,
  definitionToFormSchema,
  SystemRoleValues,
} from '@portal/features/templates/schemas/definition-to-form-schema';
import { formatObjectListRow } from '@portal/features/templates/schemas/object-list-field';
import { SystemFieldRowComponent } from './system-field-row.component';

/**
 * Read-only view of a report's HEADER-scope fields (the Specs tab), rendered generically
 * from the template definition — the counterpart to `SerialInspectionReactiveFormComponent`,
 * which renders the ITEM-scope fields into the serial drawer. Both are driven by the same
 * definition adapter (`definitionToFormSchema` with `{ scope: 'header' }` here, the
 * default item scope there),
 * so the Specs tab is no longer hardcoded to drill pipe: any defined template's header
 * fields render here.
 *
 * Presentational only — the read half of the Specs tab. Its editable counterpart
 * is `InspectionReportHeaderEditComponent`, which writes the generic `headerData`
 * store (Phase D step 2 retired the hardcoded `saveMeta` scaffold).
 *
 * Fallback discipline mirrors the item form EXACTLY: a null/undefined/malformed definition,
 * or one with no header fields, drives an explicit empty-state — NEVER a drill-pipe
 * fallback (that would show the wrong tool's fields for a non-drill-pipe report).
 */
@Component({
  selector: 'app-inspection-report-header-fields',
  standalone: true,
  imports: [CommonModule, SystemFieldRowComponent],
  templateUrl: './inspection-report-header-fields.component.html',
})
export class InspectionReportHeaderFieldsComponent {
  /** The report's template definition (report.definitionJson), or null pre-cutover. */
  @Input() set definition(value: TemplateFormDefinition | null) {
    this._definition.set(value ?? null);
  }
  /** The report row — header field VALUES are read from it by field key. */
  @Input() set data(value: Record<string, unknown> | null) {
    this._data.set(value ?? {});
  }
  /**
   * Derived values for roled (system-owned) fields, from the detail component's single
   * derivation. A roled field renders its value from here — never from `data` (its key is
   * stripped on save server-side and never user-entered).
   */
  @Input() systemValues: SystemRoleValues = {};

  /**
   * Customer document surface flag. Default `false` keeps every existing (ops)
   * call site byte-identical — Barlow Condensed section titles, condensed
   * "System" badge. When the customer detail passes `true`, the labels drop to
   * IBM Plex to match that surface's typeface discipline; nothing else changes.
   */
  isCustomer = input<boolean>(false);

  private _definition = signal<TemplateFormDefinition | null>(null);
  private _data = signal<Record<string, unknown>>({});

  /**
   * The header schema, or null when there is no usable definition. Soft-null (never
   * throws) so a malformed definition degrades to the empty-state rather than blanking
   * the whole detail screen.
   */
  public schema = computed<FormSchema | null>(() => {
    const def = this._definition();
    if (!def) return null;
    try {
      return definitionToFormSchema(def, { scope: 'header' });
    } catch {
      return null;
    }
  });

  /**
   * True ONLY when there is no usable definition at all (null/malformed) — the single
   * genuine error state. This is the only case that tells the viewer the template isn't
   * defined. A hydrated customer report always carries its `definitionJson`, so this
   * should never fire falsely there (see the detail component's hydration).
   */
  public definitionMissing = computed(() => this.schema() === null);

  /**
   * True when a definition EXISTS but declares no header-scope fields (e.g. a flat
   * template, or one whose fields are all item-scope). This is NOT an error — the
   * template is fully defined, it simply has no header specs — so the surface renders
   * nothing rather than falsely claiming an administrator failed to define it.
   */
  public noHeaderFields = computed(() => {
    const s = this.schema();
    return !!s && s.sections.every((sec) => sec.fields.length === 0);
  });

  /**
   * Display string for a field's value, coerced generically (no field-name coupling):
   * an object-list (e.g. equipment/methods) joins its `name` (with `#number` when present),
   * a scalar renders as-is, and anything empty falls back to an em dash.
   */
  public displayValue(key: string): string {
    const raw = (this._data() ?? {})[key];
    if (raw === null || raw === undefined || raw === '') return '—';
    if (Array.isArray(raw)) {
      const parts = raw.map((item) =>
        item && typeof item === 'object'
          ? formatObjectListRow(item)
          : String(item),
      );
      const joined = parts.filter((p) => p.trim() !== '').join(', ');
      return joined === '' ? '—' : joined;
    }
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    return String(raw);
  }
}
