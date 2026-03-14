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

  protected getDisposition(sn: LocalSerialNumber): string | null {
    if (!sn.inspectionJson) return null;
    const bodySection = sn.inspectionJson['body'] as
      | Record<string, unknown>
      | undefined;
    return (bodySection?.['emiResult'] as string) || null;
  }

  protected getInspectionField(
    sn: LocalSerialNumber,
    section: string,
    key: string,
  ): unknown {
    if (!sn.inspectionJson) {
      return undefined;
    }

    const sectionData = sn.inspectionJson[section] as
      | Record<string, unknown>
      | undefined;
    return sectionData?.[key];
  }

  protected getInspectionFieldText(
    sn: LocalSerialNumber,
    section: string,
    key: string,
  ): string {
    const value = this.getInspectionField(sn, section, key);
    return value === undefined || value === null || value === ''
      ? '-'
      : String(value);
  }

  protected hasInspectionField(
    sn: LocalSerialNumber,
    section: string,
    key: string,
  ): boolean {
    return this.getInspectionField(sn, section, key) !== undefined;
  }

  protected getInspectionBooleanLabel(
    sn: LocalSerialNumber,
    section: string,
    key: string,
    trueLabel = 'Yes',
    falseLabel = 'No',
  ): string {
    const value = this.getInspectionField(sn, section, key);
    if (value === undefined) {
      return '-';
    }

    return value ? trueLabel : falseLabel;
  }

  protected getInspectionRange(
    sn: LocalSerialNumber,
    section: string,
    minKey: string,
    maxKey: string,
  ): string {
    const min = this.getInspectionField(sn, section, minKey);
    const max = this.getInspectionField(sn, section, maxKey);

    if (min === undefined || min === null || min === '') {
      return '-';
    }

    return `${String(min)} - ${String(max ?? '')}`.trim();
  }

  protected getInspectionRemarks(sn: LocalSerialNumber): string {
    if (!sn.inspectionJson) {
      return '-';
    }

    const remarks = sn.inspectionJson['remarks'];
    return remarks ? String(remarks) : '-';
  }

  protected hasHistory(sn: LocalSerialNumber): boolean {
    return this.historySerialIds.has(sn.id);
  }
}
