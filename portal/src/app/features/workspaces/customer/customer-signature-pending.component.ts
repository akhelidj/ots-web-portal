import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SignatureDialogComponent } from '@portal/shared/components/signature-dialog/signature-dialog.component';
import {
  PendingSignatureReport,
  ReportSignaturesService,
} from '@portal/features/inspections/services/report-signatures.service';
import { ToastService } from '@portal/shared/toast/toast.service';

interface SigningTarget {
  reportId: string;
  reportNumber: string | null;
  fieldKey: string;
  label: string;
  /** Built ONCE per open: a stable reference, so the dialog input never churns. */
  uploader: (png: Blob) => Promise<unknown>;
}

/**
 * "Signature pending" — approved reports of the customer's organization that still need a
 * customer signature. Each unsigned field has its own Sign action: the customer draws it per
 * report (it is never saved to an account) and it is recorded against the report's current
 * revision. Renders nothing when nothing is pending or the list cannot be loaded (offline).
 */
@Component({
  selector: 'app-customer-signature-pending',
  standalone: true,
  imports: [RouterLink, SignatureDialogComponent],
  templateUrl: './customer-signature-pending.component.html',
})
export class CustomerSignaturePendingComponent implements OnInit {
  private signatures = inject(ReportSignaturesService);
  private toast = inject(ToastService);

  public readonly pending = signal<PendingSignatureReport[]>([]);
  public readonly target = signal<SigningTarget | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  public async load(): Promise<void> {
    try {
      this.pending.set(await this.signatures.listPending());
    } catch {
      // Online-only convenience: offline or a transient error just hides the panel.
      this.pending.set([]);
    }
  }

  public openSigning(
    report: PendingSignatureReport,
    field: { key: string; label: string },
  ): void {
    this.target.set({
      reportId: report.reportId,
      reportNumber: report.reportNumber,
      fieldKey: field.key,
      label: field.label,
      uploader: (png) => this.signatures.sign(report.reportId, field.key, png),
    });
  }

  public closeSigning(): void {
    this.target.set(null);
  }

  public async onSigned(): Promise<void> {
    this.target.set(null);
    this.toast.showSuccess('Signature recorded.', 'Signed');
    await this.load();
  }
}
