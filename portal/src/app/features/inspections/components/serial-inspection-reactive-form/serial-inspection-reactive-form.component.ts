import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  OnInit,
  SimpleChanges,
  OnChanges,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
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
import { sameContent } from '@portal/shared/utils/same-content';
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

/**
 * Safety-net pause while typing in a text/number field. The normal triggers are faster:
 * a select/date/boolean change and leaving a field both save immediately (`commitField`).
 */
const AUTOSAVE_DEBOUNCE_MS = 700;

@Component({
  selector: 'app-serial-inspection-reactive-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DefinitionFieldInputComponent],
  templateUrl: './serial-inspection-reactive-form.component.html',
})
export class SerialInspectionReactiveFormComponent
  implements OnInit, OnChanges, OnDestroy
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
  /** The record (serial) being edited — autosave writes go to THIS id, never "the current one". */
  @Input() recordId: string | null = null;
  /**
   * Autosave sink. When set (and the form is editable) the form saves its draft after a
   * short pause in typing, on switching record, and on destroy. The host owns persistence
   * and serialises calls; the form never closes or validates for an autosave, so partial
   * (draft) data is saved as-is.
   */
  @Input() autosaveFn:
    | ((recordId: string, data: Record<string, unknown>) => Promise<void>)
    | null = null;

  @Output() saveData = new EventEmitter<Record<string, unknown>>();
  @Output() formCancel = new EventEmitter<void>();

  public schema: FormSchema = EMPTY_SCHEMA;
  /** True when the report has no usable definition → render the explicit empty-state. */
  public schemaUnavailable = false;
  public formGroup!: FormGroup;

  private fb = inject(FormBuilder);

  public autosaveStatus = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosavePending = false;
  private lastSavedKey = '';
  private valueSub: Subscription | null = null;

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
    // A definition that ARRIVES or CHANGES after init (async hydration) must rebuild the
    // schema + form. resolveSchema/initForm otherwise run only in ngOnInit, so a definition
    // that lands late leaves `schemaUnavailable` stuck true and the empty-state showing —
    // "the template has no usable definition yet" — even though the report is fully defined
    // (#2, hydration). The sibling header components derive their schema from a computed
    // signal and so are already reactive; this @Input-driven form was the outlier. Rebuild
    // FIRST, before the initialData branch, so a data change in the same pass patches the
    // freshly-built form rather than the stale one.
    // Content-identical re-deliveries (window-focus hydration re-reads the report from
    // IndexedDB → a fresh `definitionJson` object) must NOT rebuild, or typed values vanish.
    const definitionChange = changes['definition'];
    if (
      definitionChange &&
      !definitionChange.firstChange &&
      !sameContent(definitionChange.previousValue, definitionChange.currentValue)
    ) {
      this.flushAutosave(this.recordId);
      this.schema = this.resolveSchema();
      this.initForm();
    }
    if (changes['initialData'] && !changes['initialData'].firstChange) {
      // Switching record: persist the OUTGOING record's pending edits (to its own id)
      // before the form is re-seeded with the next one.
      const previousId = changes['recordId']
        ? (changes['recordId'].previousValue as string | null)
        : this.recordId;
      this.flushAutosave(previousId);
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
    this.armAutosave();
  }

  /** (Re)baseline the autosave watcher on the current form. */
  private armAutosave() {
    this.valueSub?.unsubscribe();
    this.cancelAutosaveTimer();
    this.autosavePending = false;
    this.lastSavedKey = JSON.stringify(this.buildPayload());
    this.autosaveStatus.set('idle');
    this.valueSub = this.formGroup.valueChanges.subscribe(() => {
      if (!this.autosaveFn || this.isReadOnly) return;
      this.autosavePending = true;
      this.cancelAutosaveTimer();
      this.autosaveTimer = setTimeout(() => {
        this.autosaveTimer = null;
        void this.runAutosave(this.recordId);
      }, AUTOSAVE_DEBOUNCE_MS);
    });
  }

  private cancelAutosaveTimer() {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  /**
   * A field was committed (select/date/boolean `change`, or focus left a field): save the
   * draft now instead of waiting out the typing pause. Moving focus to the Save button is
   * skipped — the explicit save that follows persists everything itself.
   */
  public commitField(event?: Event) {
    const next = (event as FocusEvent | undefined)?.relatedTarget as
      | HTMLElement
      | null
      | undefined;
    if (next instanceof HTMLButtonElement && next.type === 'submit') return;
    this.flushAutosave(this.recordId);
  }

  /** Tab hidden / page closing: the user may not come back, so save what is pending. */
  @HostListener('document:visibilitychange')
  @HostListener('window:pagehide')
  public onPageHide() {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
      this.flushAutosave(this.recordId);
    }
  }

  /** Save any pending edits now, to `targetId` (the record they were typed against). */
  private flushAutosave(targetId: string | null) {
    this.cancelAutosaveTimer();
    if (this.autosavePending) void this.runAutosave(targetId);
  }

  private async runAutosave(targetId: string | null) {
    const save = this.autosaveFn;
    if (!save || !targetId || this.isReadOnly || !this.autosavePending) return;
    this.autosavePending = false;
    const payload = this.buildPayload();
    const key = JSON.stringify(payload);
    if (key === this.lastSavedKey) return;
    this.autosaveStatus.set('saving');
    try {
      await save(targetId, payload);
      this.lastSavedKey = key;
      this.autosaveStatus.set('saved');
    } catch {
      // Keep the draft marked unsaved so the next edit (or flush) retries.
      this.autosavePending = true;
      this.autosaveStatus.set('error');
    }
  }

  ngOnDestroy() {
    this.valueSub?.unsubscribe();
    this.flushAutosave(this.recordId);
  }

  /** The nested, definition-keyed inspection payload built from the current form. */
  private buildPayload(): Record<string, unknown> {
    const rawValues = this.formGroup.getRawValue();
    const finalResult: Record<string, unknown> = {};
    for (const key of Object.keys(rawValues)) {
      this.setNestedValue(finalResult, this.toDataKey(key), rawValues[key]);
    }
    return finalResult;
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
    this.formGroup.patchValue(patchValues, { emitEvent: false });
    this.armAutosave();
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

    // The explicit save persists everything; drop any queued autosave of the same edits.
    this.cancelAutosaveTimer();
    this.autosavePending = false;
    const finalResult = this.buildPayload();
    this.lastSavedKey = JSON.stringify(finalResult);

    this.saveData.emit(finalResult);
  }

  public onCancel() {
    this.flushAutosave(this.recordId);
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

  /**
   * Read-only display string for a field, formatted by type — the presentation
   * mirror of the editable control. Empty/absent → '' so the template can render a
   * neutral placeholder. Never mutates state.
   */
  public displayValue(field: {
    key: string;
    inputType?: string;
    options?: string[];
  }): string {
    const raw = this.getNestedValue(this.initialData, field.key);

    if (field.inputType === 'object-list') {
      const rows = Array.isArray(raw) ? raw : [];
      return rows
        .map((row) => {
          const r = (row ?? {}) as Record<string, unknown>;
          return [r['name'], r['number']]
            .filter((v) => v !== null && v !== undefined && v !== '')
            .join(' — ');
        })
        .filter((s) => s.length > 0)
        .join(', ');
    }

    if (field.inputType === 'boolean') {
      if (raw === true || raw === 'true') return 'Yes';
      if (raw === false || raw === 'false') return 'No';
      return '';
    }

    if (raw === null || raw === undefined || raw === '') return '';
    return String(raw);
  }
}
