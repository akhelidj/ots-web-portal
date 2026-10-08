import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ConfirmService } from '@portal/shared/confirm/confirm.service';
import { ToastService } from '@portal/shared/toast/toast.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import {
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';
import {
  InspectionReportsService,
  ReportDeleteImpact,
} from './inspection-reports.service';

/**
 * The admin "delete report" flow, shared by the report detail page and the report list:
 * offline/unsynced guard → impact read → confirm with a required reason → version-guarded delete.
 * The API is the authority (ADMIN-only, version check); this only keeps the UI honest.
 */
@Injectable({ providedIn: 'root' })
export class ReportDeleteFlowService {
  private irService = inject(InspectionReportsService);
  private confirmService = inject(ConfirmService);
  private toast = inject(ToastService);
  private connectivity = inject(ConnectivityService);

  /** Why the report cannot be deleted right now, or null when it can. */
  public blockedReason(
    report: LocalInspectionReport,
    serials: LocalSerialNumber[] = [],
  ): string | null {
    if (!this.connectivity.isOnline()) {
      return 'Deleting a report needs a connection to the server.';
    }
    const unsynced =
      report.syncState !== 'SYNCED' ||
      report.id.startsWith('local-') ||
      serials.some((sn) => sn.syncState && sn.syncState !== 'SYNCED');
    return unsynced
      ? 'This report has changes that are not synced yet. Sync first, then delete.'
      : null;
  }

  /**
   * Runs the whole flow. Resolves true when the report was deleted, false when the admin
   * cancelled; throws an Error with a user-facing message on failure.
   */
  public async run(
    report: LocalInspectionReport,
    serials: LocalSerialNumber[] = [],
  ): Promise<boolean> {
    const blocked = this.blockedReason(report, serials);
    if (blocked) throw new Error(blocked);

    let impact: ReportDeleteImpact;
    try {
      impact = await this.irService.getDeleteImpact(report.id);
    } catch (error) {
      throw new Error(
        this.httpMessage(error, 'Could not check what this report contains.'),
      );
    }

    const plural = (n: number, word: string) =>
      `${n} ${word}${n === 1 ? '' : 's'}`;
    const label = impact.reportNumber || report.id.substring(0, 8).toUpperCase();
    const reason = await this.confirmService.confirmWithReason({
      title: `Delete report ${label}?`,
      message:
        `This permanently deletes report ${label} (PO ${impact.poNumber}) with ` +
        `${plural(impact.serialNumbers, 'serial')}, ${plural(impact.childReports, 'child report')}, ` +
        `${plural(impact.attachments, 'attachment')} and ${plural(impact.signatures, 'signature')}. ` +
        'It cannot be undone. Audit history is kept.',
      confirmLabel: 'Delete permanently',
      tone: 'danger',
      reason: {
        label: 'Reason (required, recorded in the audit log)',
        placeholder: 'Why is this report being deleted?',
      },
    });
    if (reason == null) return false;

    try {
      // The version the impact was read at: a report changed since then is not deleted blind.
      await this.irService.deleteReport(report.id, impact.version, reason);
    } catch (error) {
      throw new Error(
        error instanceof HttpErrorResponse && error.status === 409
          ? 'This report changed while you were looking at it. Reload and try again.'
          : this.httpMessage(error, 'The report could not be deleted.'),
      );
    }
    this.toast.showSuccess(`Report ${label} was deleted.`, 'Report deleted');
    return true;
  }

  private httpMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'Deleting a report needs a connection to the server.';
      }
      const message = (error.error as { message?: string | string[] } | null)
        ?.message;
      if (message) return Array.isArray(message) ? message.join(' ') : message;
    }
    return fallback;
  }
}
