import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  APP_ROLES,
  SERIAL_DISPOSITIONS,
  SERIAL_STATUSES,
  SYNC_STATES,
} from '@portal/core/constants/app.constants';
import {
  LocalChildReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';
import { SectionSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';

/**
 * One rendered matrix column. Derived from the definition's section fields — never
 * hardcoded. A `range` column collapses an adjacent `<base>Min` / `<base>Max` field
 * pair into a single composed cell (schema-key driven, not a positional special-case);
 * every other field is its own `text` or `bool` column.
 */
interface SerialTableColumn {
  id: string;
  label: string;
  kind: 'text' | 'bool' | 'range';
  /** Dotted field key for text/bool cells (e.g. `box.minOD`, `remarks`). */
  fieldKey: string;
  /** Range-pair keys (set only when kind === 'range'). */
  minKey?: string;
  maxKey?: string;
  /** Last column of its section → draw the group divider on its right edge. */
  isSectionEnd: boolean;
}

/** A definition section rendered as a colspan group band + its columns. */
interface SerialTableColumnGroup {
  key: string;
  title: string;
  columns: SerialTableColumn[];
}

@Component({
  selector: 'app-inspection-report-serials-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspection-report-serials-table.component.html',
  host: {
    class: 'block w-full min-w-0',
  },
})
export class InspectionReportSerialsTableComponent {
  @Input() serials: LocalSerialNumber[] = [];
  @Input() childReports: LocalChildReport[] = [];
  @Input() userRole = '';
  @Input() searchQuery = '';
  @Input() selectedForApproval: ReadonlySet<string> = new Set<string>();
  @Input() isSubmittingBatch = false;
  @Input() canSubmitBatch = false;
  @Input() isLocked = false;
  @Input() isAllEligibleSelected = false;
  @Input() editingSnId: string | null = null;
  @Input() editingSnValue = '';
  @Input() canInspectInspectionData = false;
  @Input() canEditSerial = false;
  @Input() canRemoveSerial = false;
  @Input() historySerialIds: ReadonlySet<string> = new Set<string>();
  @Input() isCompactMode = false;
  /**
   * The report's item-scope form sections, as produced by `definitionToFormSchema`
   * (the SAME adapter the serial drawer form consumes). Drives every group band,
   * column header, and cell — the table is fully definition-driven, no template is
   * special-cased. Empty → no matrix columns render (identity columns only).
   */
  @Input() sections: SectionSchema[] = [];

  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() toggleAllEligible = new EventEmitter<void>();
  @Output() submitSelected = new EventEmitter<void>();
  @Output() toggleSelection = new EventEmitter<LocalSerialNumber>();
  @Output() openInspection = new EventEmitter<LocalSerialNumber>();
  @Output() startEdit = new EventEmitter<LocalSerialNumber>();
  @Output() editingSnValueChange = new EventEmitter<string>();
  @Output() saveEdit = new EventEmitter<LocalSerialNumber>();
  @Output() cancelEdit = new EventEmitter<void>();
  @Output() deleteSn = new EventEmitter<LocalSerialNumber>();
  @Output() openHistory = new EventEmitter<LocalSerialNumber>();

  protected readonly APP_ROLES = APP_ROLES;
  protected readonly SERIAL_DISPOSITIONS = SERIAL_DISPOSITIONS;
  protected readonly SERIAL_STATUSES = SERIAL_STATUSES;
  protected readonly SYNC_STATES = SYNC_STATES;

  // Column groups are derived once per distinct `sections` reference and cached, so
  // the template can read `columnGroups` freely (header twice + once per row) without
  // rebuilding the model on every change-detection pass.
  private cachedSectionsRef: SectionSchema[] | null = null;
  private cachedColumnGroups: SerialTableColumnGroup[] = [];

  protected get columnGroups(): SerialTableColumnGroup[] {
    if (this.cachedSectionsRef !== this.sections) {
      this.cachedSectionsRef = this.sections;
      this.cachedColumnGroups = this.buildColumnGroups(this.sections);
    }
    return this.cachedColumnGroups;
  }

  /** Total rendered columns — identity columns + (unless compact) every matrix column.
   *  Drives the empty-state colspan so it always spans the real table width. */
  protected get totalColumnCount(): number {
    const identity = 2; // serial + disposition/actions
    const sync =
      this.userRole !== APP_ROLES.CUSTOMER && !this.isCompactMode ? 1 : 0;
    const matrix = this.isCompactMode
      ? 0
      : this.columnGroups.reduce((sum, g) => sum + g.columns.length, 0);
    return identity + sync + matrix;
  }

  private buildColumnGroups(
    sections: SectionSchema[],
  ): SerialTableColumnGroup[] {
    const groups: SerialTableColumnGroup[] = [];

    for (const section of sections) {
      const columns: SerialTableColumn[] = [];
      const fields = section.fields;

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (!field) continue;

        const leaf = this.leafOf(field.key);
        // Adjacent `<base>Min` / `<base>Max` → one range column, consuming the Max.
        if (leaf.endsWith('Min')) {
          const base = leaf.slice(0, -3);
          const next = fields[i + 1];
          if (next && this.leafOf(next.key) === `${base}Max`) {
            columns.push({
              id: `${field.key}|${next.key}`,
              label: field.label.replace(/\s*Min$/i, ''),
              kind: 'range',
              fieldKey: field.key,
              minKey: field.key,
              maxKey: next.key,
              isSectionEnd: false,
            });
            i++;
            continue;
          }
        }

        columns.push({
          id: field.key,
          label: field.label,
          kind: field.inputType === 'boolean' ? 'bool' : 'text',
          fieldKey: field.key,
          isSectionEnd: false,
        });
      }

      const last = columns[columns.length - 1];
      if (last) {
        last.isSectionEnd = true;
        groups.push({ key: section.key, title: section.title, columns });
      }
    }

    return groups;
  }

  private leafOf(key: string): string {
    const idx = key.lastIndexOf('.');
    return idx === -1 ? key : key.slice(idx + 1);
  }

  /** Nested lookup by dotted field key (`box.minOD`) or bare key (`remarks`), matching
   *  how the drawer form stores values into `inspectionJson`. */
  private valueByKey(sn: LocalSerialNumber, key: string): unknown {
    if (!sn.inspectionJson) return undefined;
    let current: unknown = sn.inspectionJson;
    for (const part of key.split('.')) {
      if (typeof current !== 'object' || current === null) return undefined;
      current = (current as Record<string, unknown>)[part];
      if (current === undefined) return undefined;
    }
    return current;
  }

  /** Render one matrix cell, dispatching on the column kind derived from the schema
   *  (declared type / range-pair keys) — never on a hardcoded position. */
  protected getCellText(sn: LocalSerialNumber, col: SerialTableColumn): string {
    switch (col.kind) {
      case 'range':
        return this.getRangeByKey(
          sn,
          col.minKey ?? col.fieldKey,
          col.maxKey ?? col.fieldKey,
        );
      case 'bool':
        return this.getBooleanLabelByKey(sn, col.fieldKey);
      default:
        return this.getFieldTextByKey(sn, col.fieldKey);
    }
  }

  private getFieldTextByKey(sn: LocalSerialNumber, key: string): string {
    const value = this.valueByKey(sn, key);
    return value === undefined || value === null || value === ''
      ? '-'
      : String(value);
  }

  private getBooleanLabelByKey(
    sn: LocalSerialNumber,
    key: string,
    trueLabel = 'X',
    falseLabel = '-',
  ): string {
    const value = this.valueByKey(sn, key);
    if (value === undefined) return '-';
    return value ? trueLabel : falseLabel;
  }

  private getRangeByKey(
    sn: LocalSerialNumber,
    minKey: string,
    maxKey: string,
  ): string {
    const min = this.valueByKey(sn, minKey);
    const max = this.valueByKey(sn, maxKey);
    if (min === undefined || min === null || min === '') return '-';
    return `${String(min)} - ${String(max ?? '')}`.trim();
  }

  protected getDisposition(sn: LocalSerialNumber): string | null {
    if (!sn.inspectionJson) return null;
    const bodySection = sn.inspectionJson['body'] as
      | Record<string, unknown>
      | undefined;
    return (bodySection?.['emiResult'] as string) || null;
  }

  protected hasHistory(sn: LocalSerialNumber): boolean {
    return this.historySerialIds.has(sn.id);
  }
}
