import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SERIAL_DISPOSITIONS } from '@portal/core/constants/app.constants';
import { LocalSerialNumber } from '@portal/core/offline/models/types';
import { SectionSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import {
  BadgeSeverity,
  StatusBadgeComponent,
} from '@portal/shared/components/status-badge/status-badge.component';
import {
  SerialTableColumn,
  SerialTableColumnGroup,
  buildSerialColumnGroups,
  getSerialCellText,
  getSerialDisposition,
} from '../serial-matrix';

/**
 * Read-only, document-style serials matrix for the customer report view. Same
 * definition-driven extraction as the ops table (dotted-key lookup, range-pair
 * collapse, boolean labels) but presented as an engineered read surface — sticky
 * header, quiet seams, tabular numerals — with no editing, selection, or approval
 * affordances. A row click opens the shared read-only serial drawer via
 * `openInspection`.
 */
@Component({
  selector: 'app-customer-serials-table',
  standalone: true,
  imports: [CommonModule, StatusBadgeComponent],
  templateUrl: './customer-serials-table.component.html',
  host: {
    class: 'block w-full min-w-0',
  },
})
export class CustomerSerialsTableComponent {
  @Input() serials: LocalSerialNumber[] = [];
  /**
   * The report's item-scope form sections (`definitionToFormSchema`) — the SAME
   * adapter the drawer form and ops table consume. Drives every group band,
   * column header, and cell. Empty → only the identity + result columns render.
   */
  @Input() sections: SectionSchema[] = [];

  @Output() openInspection = new EventEmitter<LocalSerialNumber>();

  // Column groups are derived once per distinct `sections` reference and cached,
  // so the template can read `columnGroups` freely across header + every row
  // without rebuilding the model on each change-detection pass.
  private cachedSectionsRef: SectionSchema[] | null = null;
  private cachedColumnGroups: SerialTableColumnGroup[] = [];

  protected get columnGroups(): SerialTableColumnGroup[] {
    if (this.cachedSectionsRef !== this.sections) {
      this.cachedSectionsRef = this.sections;
      this.cachedColumnGroups = buildSerialColumnGroups(this.sections);
    }
    return this.cachedColumnGroups;
  }

  /** Total rendered columns — serial + every matrix column + result. Drives the
   *  empty-state colspan so it always spans the real table width. */
  protected get totalColumnCount(): number {
    const matrix = this.columnGroups.reduce(
      (sum, g) => sum + g.columns.length,
      0,
    );
    return 2 + matrix; // serial + matrix + result
  }

  /** Render one matrix cell — delegates to the shared definition-driven
   *  derivation so the customer and ops tables can never drift. */
  protected getCellText(sn: LocalSerialNumber, col: SerialTableColumn): string {
    return getSerialCellText(sn, col);
  }

  protected getDisposition(sn: LocalSerialNumber): string | null {
    return getSerialDisposition(sn);
  }

  /** Human-facing disposition label; '—' when a serial has no recorded result. */
  protected dispositionLabel(sn: LocalSerialNumber): string {
    return this.getDisposition(sn) ?? '—';
  }

  /** Map a disposition to a badge severity for the result column. */
  protected dispositionSeverity(sn: LocalSerialNumber): BadgeSeverity {
    const disp = this.getDisposition(sn)?.toUpperCase();
    switch (disp) {
      case SERIAL_DISPOSITIONS.PASS:
        return 'success';
      case SERIAL_DISPOSITIONS.REWORK:
        return 'warning';
      case SERIAL_DISPOSITIONS.SCRAP:
        return 'error';
      case SERIAL_DISPOSITIONS.HOLD:
        return 'info';
      default:
        return 'neutral';
    }
  }

  protected trackBySerial(_index: number, sn: LocalSerialNumber): string {
    return sn.id;
  }
}
