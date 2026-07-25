import { Injectable } from '@angular/core';
import {
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';
import { DRILL_PIPE_V1_SCHEMA } from '@portal/features/templates/schemas/drill-pipe-v1.schema';

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

      if (report.templateKey === 'DRILL_PIPE_REPORT') {
        const missingFieldLabels: string[] = [];

        for (const section of DRILL_PIPE_V1_SCHEMA.sections) {
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
