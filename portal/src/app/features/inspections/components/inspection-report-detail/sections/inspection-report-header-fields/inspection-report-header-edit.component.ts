import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  FieldSchema,
  FormSchema,
} from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  TemplateFormDefinition,
  definitionToHeaderFormSchema,
} from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * Editable counterpart to `InspectionReportHeaderFieldsComponent` — the generic,
 * definition-driven header edit form (the Specs tab). It renders EVERY header-scope
 * field from the definition, dispatching purely on the declared field TYPE — no
 * field-name awareness, no hardcoded drill-pipe markup:
 *
 *   - scalar types (text/number/select/date/boolean) → a single form control;
 *   - `object-list` (the generic array type) → a structured `{ name, number }`
 *     row editor that ANY array field uses (equipment, methods, or a future
 *     template's array field alike).
 *
 * On save it emits ONE definition-keyed header map (fieldKey → value); the parent
 * persists it to the report's generic `headerData` store (never per-named-column).
 * Fallback discipline mirrors the read-only view and the item form EXACTLY: a
 * null/undefined/malformed definition, or one with no header fields, drives the
 * explicit empty-state — NEVER a drill-pipe fallback.
 */
@Component({
  selector: 'app-inspection-report-header-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './inspection-report-header-edit.component.html',
})
export class InspectionReportHeaderEditComponent {
  /** The report's template definition (report.definitionJson), or null pre-cutover. */
  @Input() set definition(value: TemplateFormDefinition | null) {
    this._definition.set(value ?? null);
  }
  /** The report row — header field VALUES seed the form by field key. */
  @Input() set data(value: Record<string, unknown> | null) {
    this._data.set(value ?? {});
  }

  /** Emits the definition-keyed header map (fieldKey → value) on save. */
  @Output() save = new EventEmitter<Record<string, unknown>>();
  /** Emits when the user cancels the edit. */
  @Output() cancelEdit = new EventEmitter<void>();

  private _definition = signal<TemplateFormDefinition | null>(null);
  private _data = signal<Record<string, unknown>>({});
  private fb = inject(FormBuilder);

  /** The header schema, or null when there is no usable definition. Soft-null. */
  public schema = computed<FormSchema | null>(() => {
    const def = this._definition();
    if (!def) return null;
    try {
      return definitionToHeaderFormSchema(def);
    } catch {
      return null;
    }
  });

  /** True → render the explicit empty-state (no usable definition, or zero fields). */
  public schemaUnavailable = computed(() => {
    const s = this.schema();
    if (!s) return true;
    return s.sections.every((sec) => sec.fields.length === 0);
  });

  /** The reactive form, rebuilt whenever the schema or seed data changes. */
  public form = signal<FormGroup>(this.fb.group({}));

  constructor() {
    // Rebuild the form when the definition (→ schema) or the seed data changes.
    // Scheduler-driven; a re-point of either input reactively re-renders the form.
    effect(() => {
      const schema = this.schema();
      const data = this._data();
      this.form.set(this.buildForm(schema, data));
    });
  }

  private buildForm(
    schema: FormSchema | null,
    data: Record<string, unknown>,
  ): FormGroup {
    const group: Record<string, unknown> = {};
    if (!schema) return this.fb.group(group);
    for (const section of schema.sections) {
      for (const field of section.fields) {
        const raw = data[field.key];
        if (field.inputType === 'object-list') {
          const rows = Array.isArray(raw) ? raw : [];
          group[field.key] = this.fb.array(
            rows.map((row) => this.newObjectRow(row)),
          );
        } else if (field.inputType === 'boolean') {
          group[field.key] = this.fb.control(Boolean(raw));
        } else {
          const validators = field.required ? [Validators.required] : [];
          group[field.key] = this.fb.control(raw ?? '', validators);
        }
      }
    }
    return this.fb.group(group);
  }

  /** One `{ name, number }` row for an object-list field. */
  private newObjectRow(row?: unknown): FormGroup {
    const rec = (row && typeof row === 'object' ? row : {}) as Record<
      string,
      unknown
    >;
    return this.fb.group({
      name: [rec['name'] ?? ''],
      number: [rec['number'] ?? ''],
    });
  }

  /** The FormArray backing an object-list field (for the template). */
  public arrayFor(key: string): FormArray {
    return this.form().get(key) as FormArray;
  }

  public addObjectRow(key: string): void {
    this.arrayFor(key).push(this.newObjectRow());
  }

  public removeObjectRow(key: string, index: number): void {
    this.arrayFor(key).removeAt(index);
  }

  public getFieldOptions(field: FieldSchema): string[] {
    return field.options ?? [];
  }

  public onSave(): void {
    const form = this.form();
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const schema = this.schema();
    const raw = form.getRawValue() as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const section of schema?.sections ?? []) {
      for (const field of section.fields) {
        const value = raw[field.key];
        if (field.inputType === 'object-list') {
          const rows = (Array.isArray(value) ? value : []) as Record<
            string,
            unknown
          >[];
          // Drop fully-empty rows; keep the generic `{ name, number }` shape the
          // export transforms consume. No field-name coupling.
          out[field.key] = rows
            .map((r) => ({ name: r['name'] ?? '', number: r['number'] ?? '' }))
            .filter(
              (r) =>
                String(r.name).trim() !== '' || String(r.number).trim() !== '',
            );
        } else if (field.inputType === 'boolean') {
          out[field.key] = Boolean(value);
        } else {
          out[field.key] = value;
        }
      }
    }
    this.save.emit(out);
  }

  public onCancel(): void {
    this.cancelEdit.emit();
  }
}
