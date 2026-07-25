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
import {
  FormSchema,
  DRILL_PIPE_V1_SCHEMA,
} from '@portal/features/templates/schemas/drill-pipe-v1.schema';

@Component({
  selector: 'app-serial-inspection-reactive-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './serial-inspection-reactive-form.component.html',
})
export class SerialInspectionReactiveFormComponent
  implements OnInit, OnChanges
{
  @Input() initialData: Record<string, unknown> = {};
  @Input() schemaKey = 'DRILL_PIPE_REPORT';
  @Input() isReadOnly = false;
  @Input() excludedDispositions: string[] = [];

  @Output() saveData = new EventEmitter<Record<string, unknown>>();
  @Output() formCancel = new EventEmitter<void>();

  public schema: FormSchema = DRILL_PIPE_V1_SCHEMA; // For MVP, we hardcode to Drill Pipe V1
  public formGroup!: FormGroup;

  private fb = inject(FormBuilder);

  ngOnInit() {
    this.initForm();
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
        const validators = [];
        if (field.required) {
          validators.push(Validators.required);
        }

        const internalKey = this.toInternalKey(field.key);
        group[internalKey] = [
          this.getNestedValue(this.initialData, field.key) ?? '',
          validators,
        ];
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
    let current: unknown = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof current !== 'object' || current === null) return;
      if (!(current as Record<string, unknown>)[parts[i]]) {
        (current as Record<string, unknown>)[parts[i]] = {};
      }
      current = (current as Record<string, unknown>)[parts[i]];
    }
    if (typeof current !== 'object' || current === null) return;

    // Handle boolean conversion for boolean inputTypes
    const fieldDef = this.schema.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === path);
    if (fieldDef?.inputType === 'boolean' && typeof value === 'string') {
      (current as Record<string, unknown>)[parts[parts.length - 1]] =
        value === 'true';
    } else {
      (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
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
