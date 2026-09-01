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
import {
  SerialTableColumn,
  SerialTableColumnGroup,
  buildSerialColumnGroups,
  getSerialCellText,
  getSerialDisposition,
} from '../serial-matrix';

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
      this.cachedColumnGroups = buildSerialColumnGroups(this.sections);
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

  /** Render one matrix cell — delegates to the shared definition-driven
   *  derivation so the ops and customer tables can never drift. */
  protected getCellText(sn: LocalSerialNumber, col: SerialTableColumn): string {
    return getSerialCellText(sn, col);
  }

  protected getDisposition(sn: LocalSerialNumber): string | null {
    return getSerialDisposition(sn);
  }

  protected hasHistory(sn: LocalSerialNumber): boolean {
    return this.historySerialIds.has(sn.id);
  }
}
