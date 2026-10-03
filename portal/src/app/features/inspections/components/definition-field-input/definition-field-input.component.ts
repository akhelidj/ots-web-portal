import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { FieldSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import { toObjectListRow } from '@portal/features/templates/schemas/object-list-field';

/**
 * The ONE definition-field renderer — the single type-dispatch primitive shared by the
 * item form (`SerialInspectionReactiveFormComponent`) and the header edit
 * (`InspectionReportHeaderEditComponent`). Given a `FieldSchema` and its bound
 * `AbstractControl`, it renders the correct editor purely by declared TYPE, with no
 * field-name awareness:
 *
 *   - `object-list` (the generic array type) → a structured `{ name, number }` row
 *     editor with add/remove, backed by a `FormArray` — used by ANY array field;
 *   - `boolean` → a tri-state Yes/No/blank `<select>` (the reconciled boolean control:
 *     one control everywhere, tri-state so an unanswered boolean stays distinct from No);
 *   - `select` → an option `<select>` (options passed in, so each host applies its own
 *     filtering, e.g. the item form's excludedDispositions);
 *   - `date` / `number` / text → the matching native `<input>`.
 *
 * The control is bound by INSTANCE (`[formControl]` / `[formGroup]`), so the primitive
 * needs no parent form-group directive and both hosts keep their own form structure.
 * Every single-control editor is associated with a real `<label for>` + `id`; only the
 * object-list (which labels a GROUP, not one control) uses a caption `<span>` — the sole
 * legitimate exception.
 */
@Component({
  selector: 'app-definition-field-input',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './definition-field-input.component.html',
})
export class DefinitionFieldInputComponent {
  /** The field to render (type drives the editor). */
  @Input({ required: true }) field!: FieldSchema;
  /** The bound control: a `FormControl` for scalars, a `FormArray` for object-list. */
  @Input({ required: true }) control!: AbstractControl;
  /** Resolved option list for a `select` field (host applies any filtering). */
  @Input() options: string[] = [];
  /**
   * Optional data-testid prefix. When set (e.g. `header-edit`), the primitive emits the
   * testids the header-edit render spec drives (`<prefix>-input-<key>`,
   * `<prefix>-<key>-name-<i>`, …). When empty (the item form), no testids are emitted —
   * the item form's specs address inputs by `id`.
   */
  @Input() testidPrefix = '';

  private fb = inject(FormBuilder);

  /** DOM id / label `for`, matching the item form's dot→underscore internal key. */
  get inputId(): string {
    return this.field.key.replace(/\./g, '_');
  }

  /** The scalar control (non-object-list fields). */
  get scalarControl(): FormControl {
    return this.control as FormControl;
  }

  /** The backing FormArray (object-list fields). */
  get rows(): FormArray {
    return this.control as FormArray;
  }

  /** One array row as a FormGroup (for `[formGroup]` binding in the template). */
  asGroup(row: AbstractControl): FormGroup {
    return row as FormGroup;
  }

  addRow(): void {
    this.rows.push(this.fb.group(toObjectListRow(undefined)));
  }

  removeRow(index: number): void {
    this.rows.removeAt(index);
  }

  // --- testid helpers: null (attribute omitted) when no prefix is configured ---
  testid(suffix: string): string | null {
    return this.testidPrefix ? `${this.testidPrefix}-${suffix}` : null;
  }
}
