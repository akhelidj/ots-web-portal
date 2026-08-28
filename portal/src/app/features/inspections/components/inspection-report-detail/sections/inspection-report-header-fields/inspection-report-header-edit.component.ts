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
  AbstractControl,
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
  definitionToFormSchema,
  SystemRoleValues,
} from '@portal/features/templates/schemas/definition-to-form-schema';
import {
  isObjectListRowEmpty,
  toObjectListRow,
} from '@portal/features/templates/schemas/object-list-field';
import { DefinitionFieldInputComponent } from '@portal/features/inspections/components/definition-field-input/definition-field-input.component';
import { SystemFieldRowComponent } from './system-field-row.component';

/**
 * Editable counterpart to `InspectionReportHeaderFieldsComponent` — the generic,
 * definition-driven header edit form (the Specs tab). It renders EVERY header-scope
 * field from the definition through the shared `DefinitionFieldInputComponent`
 * primitive, which dispatches purely on the declared field TYPE — no field-name
 * awareness, no hardcoded drill-pipe markup (scalars → a single control, `object-list`
 * → the generic `{ name, number }` array editor that ANY array field uses).
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
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DefinitionFieldInputComponent,
    SystemFieldRowComponent,
  ],
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
  /**
   * Derived values for roled (system-owned) fields. A roled field builds NO control and
   * emits nothing on save — it renders the read-only System row from these values instead.
   */
  @Input() systemValues: SystemRoleValues = {};

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
      return definitionToFormSchema(def, { scope: 'header' });
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
        // Roled (system-owned) fields are not user-writable: build NO control, add NO
        // required validator. They render as read-only System rows in the template.
        if (field.role) continue;
        const raw = data[field.key];
        if (field.inputType === 'object-list') {
          const rows = Array.isArray(raw) ? raw : [];
          group[field.key] = this.fb.array(
            rows.map((row) => this.fb.group(toObjectListRow(row))),
          );
        } else {
          // Scalars (incl. boolean, now a tri-state select) — seed the raw value or ''.
          const validators = field.required ? [Validators.required] : [];
          group[field.key] = this.fb.control(raw ?? '', validators);
        }
      }
    }
    return this.fb.group(group);
  }

  /** The control backing a field, handed to the shared input primitive. */
  public controlFor(key: string): AbstractControl {
    return this.form().get(key)!;
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
        // Roled fields have no control and are never emitted — their value is derived.
        if (field.role) continue;
        const value = raw[field.key];
        if (field.inputType === 'object-list') {
          // Normalize to the shared `{ name, number }` row shape and drop empty rows —
          // the shape the export transforms consume. No field-name coupling.
          const rows = (Array.isArray(value) ? value : []).map(toObjectListRow);
          out[field.key] = rows.filter((r) => !isObjectListRowEmpty(r));
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
