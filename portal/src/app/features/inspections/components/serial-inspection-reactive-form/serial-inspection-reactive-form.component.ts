import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  SimpleChanges,
  OnChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FormSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  TemplateFormDefinition,
  definitionToFormSchema,
} from '@portal/features/templates/schemas/definition-to-form-schema';
import { toObjectListRow } from '@portal/features/templates/schemas/object-list-field';
import { DefinitionFieldInputComponent } from '@portal/features/inspections/components/definition-field-input/definition-field-input.component';

/**
 * An inert schema for a report whose template has NO usable definition. It carries
 * no sections, so the form renders nothing and `schemaUnavailable` drives an explicit
 * empty-state — never the drill-pipe schema (that would render the wrong tool's form
 * for a non-drill-pipe report). See the fallback switch in ngOnInit.
 */
const EMPTY_SCHEMA: FormSchema = {
  templateKey: '',
  templateVersion: 0,
  sections: [],
};

@Component({
  selector: 'app-serial-inspection-reactive-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DefinitionFieldInputComponent],
  templateUrl: './serial-inspection-reactive-form.component.html',
})
export class SerialInspectionReactiveFormComponent
  implements OnInit, OnChanges
{
  @Input() initialData: Record<string, unknown> = {};
  @Input() schemaKey = 'DRILL_PIPE_REPORT';
  @Input() isReadOnly = false;
  @Input() excludedDispositions: string[] = [];
  // Phase B3: the report's template definition (from report.definitionJson).
  // Present → build the form from it; null/undefined → legacy hardcoded schema.
  @Input() definition: TemplateFormDefinition | null = null;
  /** Host-driven save-in-flight flag → Save button shows a disabled busy state. */
  @Input() isSaving = false;
  /** Host-driven save error → rendered in-drawer, next to the Save button. */
  @Input() saveError = '';

  @Output() saveData = new EventEmitter<Record<string, unknown>>();
  @Output() formCancel = new EventEmitter<void>();

  public schema: FormSchema = EMPTY_SCHEMA;
  /** True when the report has no usable definition → render the explicit empty-state. */
  public schemaUnavailable = false;
  public formGroup!: FormGroup;

  private fb = inject(FormBuilder);

  ngOnInit() {
    // Phase D step 2b fallback switch: a present, well-formed definition → the
    // engine-built schema; a null/undefined/malformed definition → the inert
    // EMPTY_SCHEMA + an explicit empty-state. It NEVER falls back to the drill-pipe
    // schema: doing so would render the wrong tool's form for a definition-less
    // report. Soft-NULL, never throws (a throw here would blank a field inspector's
    // form). A drill-pipe report carries a non-null definition, so it takes the
    // engine path and is unaffected.
    this.schema = this.resolveSchema();
    this.initForm();
  }

  private resolveSchema(): FormSchema {
    if (!this.definition) {
      this.schemaUnavailable = true;
      return EMPTY_SCHEMA;
    }
    try {
      const schema = definitionToFormSchema(this.definition);
      this.schemaUnavailable = false;
      return schema;
    } catch {
      this.schemaUnavailable = true;
      return EMPTY_SCHEMA;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['initialData'] && !changes['initialData'].firstChange) {
      this.updateFormValues();
    }
    if (changes['isReadOnly'] && this.formGroup) {
      if (this.isReadOnly) {
        this.formGroup.disable();
      } else {
        this.formGroup.enable();
      }
    }
  }

  private initForm() {
    const group: Record<string, unknown> = {};

    // Build form properly mapping fields
    for (const section of this.schema.sections) {
      for (const field of section.fields) {
        const internalKey = this.toInternalKey(field.key);
        if (field.inputType === 'object-list') {
          // Generic array field (via the shared primitive) — a FormArray of
          // `{ name, number }` groups. No item-scope field is object-list today, so
          // this is dormant capability; it exists so the shared primitive renders an
          // array item field in a future flat template exactly as it does in the header.
          const raw = this.getNestedValue(this.initialData, field.key);
          const rows = Array.isArray(raw) ? raw : [];
          group[internalKey] = this.fb.array(
            rows.map((row) => this.fb.group(toObjectListRow(row))),
          );
        } else {
          const validators = [];
          if (field.required) {
            validators.push(Validators.required);
          }
          group[internalKey] = [
            this.getNestedValue(this.initialData, field.key) ?? '',
            validators,
          ];
        }
      }
    }

    this.formGroup = this.fb.group(group);

    if (this.isReadOnly) {
      this.formGroup.disable();
    }
  }

  private updateFormValues() {
    const patchValues: Record<string, unknown> = {};
    for (const section of this.schema.sections) {
      for (const field of section.fields) {
        // Object-list fields are FormArrays; a scalar patch would not fit them. No
        // item-scope object-list field exists today, so skip rather than mis-patch.
        if (field.inputType === 'object-list') continue;
        patchValues[this.toInternalKey(field.key)] =
          this.getNestedValue(this.initialData, field.key) ?? '';
      }
    }
    this.formGroup.patchValue(patchValues);
  }

  private toInternalKey(key: string): string {
    return key.replace(/\./g, '_');
  }

  private toDataKey(internalKey: string): string {
    // In our specific schema, body.emiResult -> body_emiResult
    // We can't just replace all underscores if data keys have underscores
    // But our schema keys are section.field (single dot)
    // So we can find the matching field in schema
    const field = this.schema.sections
      .flatMap((s) => s.fields)
      .find((f) => this.toInternalKey(f.key) === internalKey);
    return field ? field.key : internalKey;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    if (!obj) return undefined;
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (
        typeof current !== 'object' ||
        current === null ||
        (current as Record<string, unknown>)[part] === undefined
      )
        return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    const parts = path.split('.');
    // split('.') always yields >= 1 element, so lastKey is always defined; the
    // guard only narrows for the compiler and never returns at runtime.
    const lastKey = parts[parts.length - 1];
    if (lastKey === undefined) return;
    let current: unknown = obj;
    for (const key of parts.slice(0, -1)) {
      if (typeof current !== 'object' || current === null) return;
      const rec = current as Record<string, unknown>;
      if (!rec[key]) {
        rec[key] = {};
      }
      current = rec[key];
    }
    if (typeof current !== 'object' || current === null) return;

    // Handle boolean conversion for boolean inputTypes
    const fieldDef = this.schema.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === path);
    const target = current as Record<string, unknown>;
    if (fieldDef?.inputType === 'boolean' && typeof value === 'string') {
      target[lastKey] = value === 'true';
    } else {
      target[lastKey] = value;
    }
  }

  public onSubmit() {
    if (this.formGroup.invalid) {
      this.formGroup.markAllAsTouched();
      return;
    }

    const rawValues = this.formGroup.getRawValue();
    const finalResult: Record<string, unknown> = {};

    for (const key of Object.keys(rawValues)) {
      this.setNestedValue(finalResult, this.toDataKey(key), rawValues[key]);
    }

    this.saveData.emit(finalResult);
  }

  public onCancel() {
    this.formCancel.emit();
  }

  public getFieldOptions(field: { options?: string[] }): string[] {
    if (!field.options) return [];
    if (this.excludedDispositions.length > 0) {
      return field.options.filter(
        (o: string) => !this.excludedDispositions.includes(o),
      );
    }
    return field.options;
  }

  public getInternalKey(key: string): string {
    return this.toInternalKey(key);
  }
}
