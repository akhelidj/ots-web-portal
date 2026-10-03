import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';
import { SignatureSigner } from '@portal/features/templates/services/admin-templates.service';

/** One template signature field as the report currently stands. Mirrors the API's
 *  ReportSignatureStates (no shared DTO package — see ADR-0008). */
export interface ReportSignatureField {
  key: string;
  label: string;
  signer: SignatureSigner;
  required: boolean;
  signed: boolean;
  signedAt: string | null;
  signedByName: string | null;
}

export interface ReportSignatureStates {
  reportId: string;
  revisionNumber: number;
  /** True once the report is approved — the customer's window to sign. */
  signable: boolean;
  fields: ReportSignatureField[];
}

/** A report waiting on the customer's signature (the "Signature pending" area). */
export interface PendingSignatureReport {
  reportId: string;
  reportNumber: string | null;
  poNumber: string | null;
  status: string;
  fields: { key: string; label: string; required: boolean }[];
}

/**
 * Per-report template signatures (the `signature` field type). ONLINE-ONLY by design: the
 * state is authoritative on the server and a customer signs after approval, so none of it
 * goes through the offline outbox.
 */
@Injectable({ providedIn: 'root' })
export class ReportSignaturesService {
  private http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  public getStates(reportId: string): Promise<ReportSignatureStates> {
    return firstValueFrom(
      this.http.get<ReportSignatureStates>(
        `${this.base}/inspection-reports/${reportId}/signatures`,
      ),
    );
  }

  public listPending(): Promise<PendingSignatureReport[]> {
    return firstValueFrom(
      this.http.get<PendingSignatureReport[]>(
        `${this.base}/customer-signatures/pending`,
      ),
    );
  }

  /** A customer signs one CUSTOMER field of a report (a drawn PNG). */
  public sign(
    reportId: string,
    fieldKey: string,
    png: Blob,
  ): Promise<ReportSignatureStates> {
    const form = new FormData();
    form.append('file', png, 'signature.png');
    return firstValueFrom(
      this.http.put<ReportSignatureStates>(
        `${this.base}/inspection-reports/${reportId}/signatures/${encodeURIComponent(fieldKey)}`,
        form,
      ),
    );
  }
}
