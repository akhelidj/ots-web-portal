import { Injectable } from '@angular/core';
import {
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';
import { FormSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  definitionToFormSchema,
  TemplateFormDefinition,
} from '@portal/features/templates/schemas/definition-to-form-schema';

export interface ValidationIssue {
  code: string;
  level: 'BLOCKER' | 'WARNING';
  message: string;
  scope: 'REPORT' | 'SERIAL' | 'CHILD_REPORT';
  serialId?: string;
  serialLabel?: string;
}

export interface ValidationResult {
  isReady: boolean;
  issues: ValidationIssue[];
  serialCount: number;
  dispositionCounts: Record<string, number>;
}

@Injectable({
  providedIn: 'root',
})
export class ReportValidationService {
  validate(
    report: LocalInspectionReport,
    serials: LocalSerialNumber[],
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const dispositionCounts: Record<string, number> = {
      PASS: 0,
      REWORK: 0,
      SCRAP: 0,
      HOLD: 0,
    };

    if (serials.length === 0) {
      issues.push({
        code: 'NO_SERIALS',
        level: 'BLOCKER',
        message: 'No serial numbers attached.',
        scope: 'REPORT',
      });
    }

    // The required-field set that gates MISSING_FIELDS readiness is derived from the
    // report's template definitionJson through the SAME definitionToFormSchema transform
    // the inspection form uses — so validation and the form agree on what is required.
    // Resolved once per report (identical for every serial). Soft-NULL: a null/undefined/
    // malformed definition resolves to `null` (no required-field enforcement), NEVER the
    // drill-pipe schema — enforcing another tool's required fields on a definition-less
    // report is a correctness bug (mirrors the form's empty-state). templateKey guard
    // unchanged; a drill-pipe report carries a non-null definition and is unaffected.
    const requiredSchema =
      report.templateKey === 'DRILL_PIPE_REPORT'
        ? this.resolveRequiredSchema(report)
        : null;

    for (const sn of serials) {
      const data = sn.inspectionJson || {};
      const disposition = this.getNestedValue(data, 'body.emiResult') as string;

      if (!disposition) {
        issues.push({
          code: 'MISSING_DISPOSITION',
          level: 'BLOCKER',
          message: `Missing EMI Result on Serial ${sn.value}.`,
          scope: 'SERIAL',
          serialId: sn.id,
          serialLabel: sn.value,
        });
      } else {
        if (dispositionCounts[disposition] !== undefined) {
          dispositionCounts[disposition]++;
        } else {
          dispositionCounts[disposition] = 1;
        }
      }

      if (requiredSchema) {
        const missingFieldLabels: string[] = [];

        for (const section of requiredSchema.sections) {
          for (const field of section.fields) {
            if (field.required) {
              const val = this.getNestedValue(data, field.key);
              if (val === undefined || val === null || val === '') {
                missingFieldLabels.push(field.label);
              }
            }
          }
        }

        if (missingFieldLabels.length > 0) {
          const fieldLabels = missingFieldLabels.join(', ');
          issues.push({
            code: 'MISSING_FIELDS',
            level: 'BLOCKER',
            message: `Missing required fields on Serial ${sn.value}: ${fieldLabels}.`,
            scope: 'SERIAL',
            serialId: sn.id,
            serialLabel: sn.value,
          });
        }
      }
    }

    const isReady = issues.filter((i) => i.level === 'BLOCKER').length === 0;

    return {
      isReady,
      issues,
      serialCount: serials.length,
      dispositionCounts,
    };
  }

  /**
   * Resolve the schema whose `required` fields gate MISSING_FIELDS readiness. When the
   * report carries a template definitionJson, derive the schema through the SAME
   * definitionToFormSchema transform the inspection form consumes, so the required set
   * validation enforces is identical to what the form's Validators.required enforces
   * (false-present is valid, ''-missing is a blocker — coherent on both sides).
   *
   * Soft-NULL, never throw: this runs in an offline-first field tool where a throw would
   * silently break readiness or blank the UI. A null/undefined definition, or a malformed
   * one that trips definitionToFormSchema, resolves to `null` — NO required-field
   * enforcement — never the drill-pipe schema. The caller skips the MISSING_FIELDS walk
   * when this is null, mirroring the form's empty-state for a definition-less report.
   */
  private resolveRequiredSchema(report: LocalInspectionReport): FormSchema | null {
    const definition = report.definitionJson;
    if (definition == null) {
      return null;
    }
    try {
      return definitionToFormSchema(definition as TemplateFormDefinition);
    } catch {
      return null;
    }
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
}
