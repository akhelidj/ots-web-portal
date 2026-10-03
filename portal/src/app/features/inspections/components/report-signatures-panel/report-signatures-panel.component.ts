import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SignatureDialogComponent } from '@portal/shared/components/signature-dialog/signature-dialog.component';
import {
  ReportSignatureField,
  ReportSignatureStates,
  ReportSignaturesService,
} from '@portal/features/inspections/services/report-signatures.service';
import { ToastService } from '@portal/shared/toast/toast.service';

/**
 * Where each template `signature` field stands on one report: who has signed, when, and what
 * is still outstanding. A customer can sign their own pending fields here once the report is
 * approved. Online-only: renders nothing when the state cannot be loaded or the template has
 * no signature fields.
 *
 * `status` is an input purely as a reload trigger — a workflow transition (approve, reopen)
 * changes which signatures are current.
 */
@Component({
  selector: 'app-report-signatures-panel',
  standalone: true,
  imports: [DatePipe, SignatureDialogComponent],
  templateUrl: './report-signatures-panel.component.html',
})
export class ReportSignaturesPanelComponent {
  private signatures = inject(ReportSignaturesService);
  private toast = inject(ToastService);

  public readonly reportId = input.required<string>();
  public readonly status = input<string>('');
  public readonly isCustomer = input<boolean>(false);

  /** Emits whenever the loaded state changes, so the page can gate Export on it. */
  public readonly statesChange = output<ReportSignatureStates | null>();

  public readonly states = signal<ReportSignatureStates | null>(null);
  public readonly signing = signal<ReportSignatureField | null>(null);

  public readonly fields = computed(() => this.states()?.fields ?? []);

  /** The dialog uploader, rebuilt only when the field being signed changes. */
  public readonly uploader = computed(() => {
    const field = this.signing();
    if (!field) return null;
    const id = this.reportId();
    return (png: Blob) => this.signatures.sign(id, field.key, png);
  });

  constructor() {
    effect(() => {
      // Both are reload triggers.
      this.reportId();
      this.status();
      void this.load();
    });
  }

  public canSign(field: ReportSignatureField): boolean {
    return (
      this.isCustomer() &&
      field.signer === 'CUSTOMER' &&
      !field.signed &&
      !!this.states()?.signable
    );
  }

  public signerLabel(field: ReportSignatureField): string {
    return field.signer === 'CUSTOMER' ? 'Customer' : 'Supervisor';
  }

  public async load(): Promise<void> {
    try {
      this.states.set(await this.signatures.getStates(this.reportId()));
    } catch {
      this.states.set(null);
    }
    this.statesChange.emit(this.states());
  }

  public openSigning(field: ReportSignatureField): void {
    this.signing.set(field);
  }

  public closeSigning(): void {
    this.signing.set(null);
  }

  public async onSigned(): Promise<void> {
    this.signing.set(null);
    this.toast.showSuccess('Signature recorded.', 'Signed');
    await this.load();
  }
}
