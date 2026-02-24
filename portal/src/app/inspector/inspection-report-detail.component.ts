import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { HttpClient, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { InspectionReportsService } from './inspection-reports.service';
import { ChildReportsService } from './child-reports.service';
import { environment } from '../../environments/environment';
import { SessionService } from '../core/auth/session.service';
import { LocalInspectionReport, LocalSerialNumber, LocalTransitionLog, LocalChildReport } from '../core/offline/types';
import { DRILL_PIPE_FIELDS } from './config/drill-pipe-fields';
import { ReportValidationService, ValidationResult } from '../core/validation/report-validation.service';
import { OutboxLocalRepo } from '../core/offline/outbox-local.repo';

@Component({
  selector: 'app-inspection-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './inspection-report-detail.component.html'
})
export class InspectionReportDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private irService = inject(InspectionReportsService);
  private crService = inject(ChildReportsService);
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private validationService = inject(ReportValidationService);
  private outboxRepo = inject(OutboxLocalRepo);

  public reportId = '';
  public reportSubj = new BehaviorSubject<LocalInspectionReport | null>(null);
  public report$ = this.reportSubj.asObservable();
  public serialsSubj = new BehaviorSubject<LocalSerialNumber[]>([]);
  public serials$ = this.serialsSubj.asObservable();
  public transitionLogsSubj = new BehaviorSubject<LocalTransitionLog[]>([]);
  public transitionLogs$ = this.transitionLogsSubj.asObservable();
  public childReportsSubj = new BehaviorSubject<LocalChildReport[]>([]);
  public childReports$ = this.childReportsSubj.asObservable();
  
  public formBulkSerials = '';
  public formReason = '';
  public formError = '';
  public editingSnId: string | null = null;
  public editingSnValue = '';

  public allowedTransitions: { toStatus: string; requiresReason: boolean }[] = []; 
  public selectedTransition: { toStatus: string; requiresReason: boolean } | null = null;

  public validationResult: ValidationResult | null = null;

  public drillPipeFields = DRILL_PIPE_FIELDS;
  public inspectingSn: LocalSerialNumber | null = null;
  public inspectionFormData: Record<string, unknown> = {};

  public creatingChildReportForSn: LocalSerialNumber | null = null;
  public childReportNotes = '';
  public isExporting = false;
  public isCustomer = false;
  public isReceiver = false;

  public get isOnline(): boolean {
    return navigator.onLine;
  }

  async ngOnInit() {
    this.session.profile$.subscribe(p => {
      this.isCustomer = p?.role === 'CUSTOMER';
      this.isReceiver = p?.role === 'RECEIVER';
    });
    this.reportId = this.route.snapshot.paramMap.get('id') || '';
    if (this.reportId) {
      this.refreshData();
      
      this.irService.reports$.subscribe(() => {
        this.refreshData();
      });

      this.crService.changes$.subscribe(() => {
        this.refreshData();
      });

      await this.irService.refreshAvailableTransitions(this.reportId);
      await this.irService.refreshTransitionLogs(this.reportId);
      await this.crService.pullForInspectionFromServer(this.reportId);
    }
  }

  private async refreshData() {
    const list = await this.irService.irRepo.list(); 
    const r = list.find((x: LocalInspectionReport) => x.id === this.reportId) || null;
    this.reportSubj.next(r);

    if (r?.availableTransitions) {
       try {
         const parsed = JSON.parse(r.availableTransitions);
         this.allowedTransitions = parsed.transitions || [];
       } catch {
         this.allowedTransitions = [];
       }
    } else {
       this.allowedTransitions = [];
    }

    const snList = await this.irService.getSnForReport(this.reportId);
    this.serialsSubj.next(snList);

    const logs = await this.irService.getTransitionLogsLocally(this.reportId);
    this.transitionLogsSubj.next(logs);

    const childReports = await this.crService.getChildReportsForInspection(this.reportId);
    this.childReportsSubj.next(childReports);

    if (r) {
      const vResult = this.validationService.validate(r, snList, childReports);
      
      const pending = await this.outboxRepo.getPendingItems();
      const conflicts = await this.outboxRepo.getConflictItems();
      const transitionOutbox = [...pending, ...conflicts].filter(
         i => i.entityType === 'INSPECTION_REPORT' && i.entityId === this.reportId && i.operation === 'TRANSITION' && i.lastError
      );

      for (const t of transitionOutbox) {
         vResult.issues.push({
            code: 'BACKEND_REJECTION',
            level: 'BLOCKER',
            message: `Server Rejected Transition: ${t.lastError}`,
            scope: 'REPORT'
         });
         vResult.isReady = false;
      }
      this.validationResult = vResult;
    } else {
      this.validationResult = null;
    }
  }

  public async onAddSerials() {
    this.formError = '';
    const lines = this.formBulkSerials.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    try {
      await this.irService.addSerialNumberOffline(this.reportId, lines);
      this.formBulkSerials = '';
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to add serials.';
    }
  }

  public openReasonSelect(transition: { toStatus: string; requiresReason: boolean }): void {
    this.selectedTransition = transition;
    this.formReason = '';
    this.formError = '';
  }

  public async onTransition() {
    this.formError = '';
    if (!this.selectedTransition) return;

    try {
      await this.irService.transitionOffline(this.reportId, this.selectedTransition.toStatus, this.formReason);
      this.selectedTransition = null;
      this.formReason = '';
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to transition report.';
    }
  }

  public onEditSn(sn: LocalSerialNumber): void {
    this.editingSnId = sn.id;
    this.editingSnValue = sn.value;
  }

  public cancelEditSn(): void {
    this.editingSnId = null;
    this.editingSnValue = '';
  }

  public async saveEditSn(sn: LocalSerialNumber): Promise<void> {
    if (!this.editingSnValue.trim() || this.editingSnValue === sn.value) {
      this.cancelEditSn();
      return;
    }

    try {
      await this.irService.renameSerialNumberOffline(sn.id, this.editingSnValue);
      this.cancelEditSn();
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to rename serial number.';
    }
  }

  public async onDeleteSn(sn: LocalSerialNumber): Promise<void> {
    if (!confirm(`Are you sure you want to delete ${sn.value}? This cannot be undone.`)) return;
    
    try {
      await this.irService.deleteSerialNumberOffline(sn.id);
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to delete serial number.';
    }
  }

  public openInspectionForm(sn: LocalSerialNumber): void {
    this.inspectingSn = sn;
    this.inspectionFormData = sn.inspectionJson ? JSON.parse(JSON.stringify(sn.inspectionJson)) : {};
    
    this.formError = '';
  }

  public closeInspectionForm(): void {
    this.inspectingSn = null;
    this.inspectionFormData = {};
  }

  public goToNextSn(): void {
    const snList = this.serialsSubj.value;
    const currentSn = this.inspectingSn;
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex(s => s.id === currentSn.id);
    if (index >= 0 && index < snList.length - 1) {
       this.openInspectionForm(snList[index + 1]);
    }
  }

  public goToPrevSn(): void {
    const snList = this.serialsSubj.value;
    const currentSn = this.inspectingSn;
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex(s => s.id === currentSn.id);
    if (index > 0) {
       this.openInspectionForm(snList[index - 1]);
    }
  }
  
  public get hasNextSn(): boolean {
    const snList = this.serialsSubj.value;
    const currentSn = this.inspectingSn;
    if (!currentSn) return false;
    const index = snList.findIndex(s => s.id === currentSn.id);
    return index >= 0 && index < snList.length - 1;
  }
  
  public get hasPrevSn(): boolean {
    const snList = this.serialsSubj.value;
    const currentSn = this.inspectingSn;
    if (!currentSn) return false;
    const index = snList.findIndex(s => s.id === currentSn.id);
    return index > 0;
  }

  public async saveInspectionForm(): Promise<void> {
    if (!this.inspectingSn) return;

    // Validate required fields
    for (const field of this.drillPipeFields) {
      if (field.required && !this.inspectionFormData[field.key]) {
        this.formError = `Field ${field.label} is required.`;
        return;
      }
    }

    try {
      await this.irService.saveSerialNumberInspectionOffline(this.inspectingSn.id, this.inspectionFormData);
      this.closeInspectionForm();
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to save inspection data.';
    }
  }

  public openChildReportForm(sn: LocalSerialNumber): void {
    this.creatingChildReportForSn = sn;
    this.childReportNotes = '';
    this.formError = '';
  }

  public cancelChildReportForm(): void {
    this.creatingChildReportForSn = null;
    this.childReportNotes = '';
    this.formError = '';
  }

  public async submitChildReport(): Promise<void> {
    if (!this.creatingChildReportForSn) return;
    const type = this.creatingChildReportForSn.inspectionJson?.disposition;
    if (!type || type === 'PASS') {
      this.formError = 'Cannot create Child Report: Invalid disposition source.';
      return;
    }

    try {
      await this.crService.createOffline({
        inspectionReportId: this.reportId,
        serialNumberId: this.creatingChildReportForSn.id,
        type: type as 'REWORK' | 'SCRAP' | 'HOLD',
        notes: this.childReportNotes.trim() || undefined
      });
      this.cancelChildReportForm();
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to create child report.';
    }
  }

  public async exportReport(): Promise<void> {
    if (!navigator.onLine) {
      this.formError = 'Export requires internet connection.';
      return;
    }

    this.isExporting = true;
    this.formError = '';

    try {
      const observer = this.http.get(`${environment.apiUrl}/inspection-reports/${this.reportId}/export`, {
        responseType: 'blob',
        observe: 'response'
      });
      
      const response = await new Promise<HttpResponse<Blob>>((resolve, reject) => {
         observer.subscribe({
            next: (res) => resolve(res as HttpResponse<Blob>),
            error: (err) => reject(err as HttpErrorResponse)
         });
      });

      const blob = response.body;
      if (!blob) throw new Error('No blob data received');
      const contentDisposition = response.headers.get('Content-Disposition');
      
      let filename = '';
      if (contentDisposition) {
        const parts = contentDisposition.split(';');
        const filenameStar = parts.find((p: string) => p.trim().startsWith('filename*='));
        const filenameNormal = parts.find((p: string) => p.trim().startsWith('filename='));

        if (filenameStar) {
          filename = decodeURIComponent(filenameStar.split("''")[1]);
        } else if (filenameNormal) {
          filename = filenameNormal.split('=')[1].replace(/["']/g, '');
        }
      }
      
      if (!filename) {
         const ext = blob.type === 'application/zip' ? '.zip' : '.xlsx';
         filename = `inspection-report-${this.reportId}${ext}`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const error = err as HttpErrorResponse;
      if (error.status === 0) {
        this.formError = 'Export requires internet connection.';
      } else if (error.status === 400) {
        this.formError = 'Report mapping validation failed or template mismatch.';
      } else if (error.status === 403) {
        this.formError = 'Not allowed.';
      } else if (error.status === 404) {
        this.formError = 'Report not found.';
      } else {
        this.formError = 'Failed to export report.';
      }
    } finally {
      this.isExporting = false;
    }
  }
}
