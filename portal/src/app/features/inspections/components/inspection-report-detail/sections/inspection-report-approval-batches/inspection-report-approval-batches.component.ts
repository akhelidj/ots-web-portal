import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  APP_ROLES,
  BATCH_STATUSES,
} from '@portal/core/constants/app.constants';
import {
  LocalInspectionApprovalBatch,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';

type ApprovalBatchView = {
  batch: LocalInspectionApprovalBatch;
  serials: (LocalSerialNumber & { batchStatus?: string })[];
  submittedByName?: string;
};

@Component({
  selector: 'app-inspection-report-approval-batches',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './inspection-report-approval-batches.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportApprovalBatchesComponent {
  @Input() userRole = '';
  @Input() roleRoute = '';
  @Input() batches: ApprovalBatchView[] = [];
  @Input() selectedIds: ReadonlySet<string> = new Set<string>();
  @Input() isActioning = false;

  @Output() returnBatch = new EventEmitter<string>();
  @Output() approveBatch = new EventEmitter<string>();
  @Output() toggleSerialSelection = new EventEmitter<string>();

  protected readonly APP_ROLES = APP_ROLES;
  protected readonly BATCH_STATUSES = BATCH_STATUSES;

  protected isSelected(snId: string): boolean {
    return this.selectedIds.has(snId);
  }

  protected eligibleCount(batchId: string): number {
    const batch = this.batches.find((item) => item.batch.id === batchId);
    if (!batch) {
      return 0;
    }

    return batch.serials.filter((serial) => serial.batchStatus === 'PENDING')
      .length;
  }

  protected childRoute(childReportId: string): string[] {
    return ['/', this.roleRoute, 'reports', childReportId, 'child'];
  }
}
