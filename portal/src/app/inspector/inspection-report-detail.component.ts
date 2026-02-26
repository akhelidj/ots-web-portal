import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
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
import { ReportValidationService, ValidationResult } from '../core/validation/report-validation.service';
import { OutboxLocalRepo } from '../core/offline/outbox-local.repo';
import { getInspectionReportUiState, InspectionReportUiState, UserRole, ReportStatus } from '../core/ui-policy/inspection-report-ui-policy';
import { SyncOrchestratorService } from '../core/offline/sync-orchestrator.service';
import { UserLocalRepo } from '../core/offline/user-local.repo';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';

@Component({
  selector: 'app-inspection-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SerialInspectionReactiveFormComponent],
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
  private syncOrchestrator = inject(SyncOrchestratorService);
  private userRepo = inject(UserLocalRepo);
  private customerRepo = inject(CustomerLocalRepo);
  private cdr = inject(ChangeDetectorRef);

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
  public isValidationModalOpen = false;
  
  // Meta Fields
  public formInspectorComment = '';
  public formInspectionAddress = '';
  public formStandardUsed = '';
  public formEquipmentUsed: Array<{ name: string, number: string, isOther: boolean }> = [];
  public formInspectionMethod: Array<{ name: string, isOther: boolean }> = [];
  
  // Pipe Details
  public formGrade = '';
  public formRange = '';
  public formWeight = '';
  public formNomWT = '';
  public formNomOD = '';
  public formNomID = '';
  public formConnection = '';

  public isEditingMeta = false;

  // Dropdown Options
  public readonly METHOD_OPTIONS = ['Wet', 'Dry', 'EAI', 'UT-EAI', 'VTI', 'TGI', 'Other'];
  public readonly EQUIPMENT_OPTIONS = ['UV Light', 'AC Yoke', 'DC Coil', 'EMI Unit', 'UT-EA', 'WT', 'Other'];

  public uiState: InspectionReportUiState | null = null;
  public userRole = '';
  public allowedTransitions: { toStatus: string; requiresReason: boolean; enabled: boolean; label?: string; disabledReason?: string; }[] = []; 
  public selectedTransition: { toStatus: string; requiresReason: boolean; label?: string } | null = null;

  public validationResult: ValidationResult | null = null;
  public reworkSerials: { sn: LocalSerialNumber, childLinked: LocalChildReport | null }[] = [];
  public hasMissingChildrenForRework = false;
  public hasUnresolvedChildren = false;

  // KPIs
  public kpiTotal = 0;
  public kpiPassed = 0;
  public kpiRework = 0;
  public kpiScrap = 0;
  public kpiHold = 0;
  public kpiPassRate = 0;

  public inspectedByName = 'N/A';
  public approvedByName = 'N/A';
  public customerAddress = 'N/A';

  // Modal State
  public activeModalStatus: 'PASS' | 'REWORK' | 'SCRAP' | 'HOLD' | null = null;
  public modalEquipmentList: LocalSerialNumber[] = [];

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

  public get isInspectorCapable(): boolean {
    return ['INSPECTOR', 'SUPERVISOR', 'ADMIN'].includes(this.userRole);
  }

  public getDisposition(sn: LocalSerialNumber): string | null {
    if (!sn.inspectionJson) return null;
    const finalSection = sn.inspectionJson['final'] as Record<string, unknown> | undefined;
    return (finalSection?.['disposition'] as string) || (sn.inspectionJson['disposition'] as string) || null;
  }

  async ngOnInit() {
    this.session.profile$.subscribe(p => {
      if (!p) return;
      this.userRole = p.role || '';
      this.isCustomer = p.role === 'CUSTOMER';
      this.isReceiver = p.role === 'RECEIVER';
      if (this.reportId) {
         this.refreshData();
      }
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

      if (!this.reportId.startsWith('local-ir-') && this.reportId !== 'create') {
        await this.irService.refreshAvailableTransitions(this.reportId);
        await this.irService.refreshTransitionLogs(this.reportId);
        await this.crService.pullForInspectionFromServer(this.reportId);
      }
    }
  }

  private async refreshData() {
    const list = await this.irService.irRepo.list(); 
    const r = list.find((x: LocalInspectionReport) => x.id === this.reportId) || null;
    this.reportSubj.next(r);

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

      let previousStatus: string | null = null;
      let onHoldReason: string | null = null;
      if (r.status === 'ON_HOLD' && logs.length > 0) {
         const sortedLogs = [...logs].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
         const toHold = sortedLogs.find(l => l.toStatus === 'ON_HOLD');
         if (toHold) {
            previousStatus = toHold.fromStatus;
            onHoldReason = toHold.reason || null;
         }
      }

      this.uiState = getInspectionReportUiState({
         role: this.userRole as UserRole,
         reportStatus: r.status as ReportStatus,
         isOffline: !this.isOnline,
         hasValidationIssues: !vResult.isReady,
         syncState: r.syncState as 'SYNCED' | 'PENDING' | 'CONFLICT',
         previousStatus: previousStatus,
         onHoldReason: onHoldReason,
         version: r.version
      });

      this.allowedTransitions = this.uiState.transitionChoices;

      // Meta Card Calcs
      this.customerAddress = 'N/A';
      if (r.customerId) {
         const cust = await this.customerRepo.getById(r.customerId);
         if (cust) {
             const parts = [cust.addressLine1, cust.addressLine2, cust.city, cust.country].filter(x => x && x.trim().length > 0);
             this.customerAddress = parts.length > 0 ? parts.join(', ') : 'N/A';
         }
      }

      this.inspectedByName = 'N/A';
      this.approvedByName = 'N/A';
      if (logs.length > 0) {
         const sortedAsc = [...logs].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
         // Inspected By: First user who transitioned to IN_INSPECTION or PENDING_APPROVAL
         const inspectLog = sortedAsc.find(l => l.toStatus === 'IN_INSPECTION' || l.toStatus === 'PENDING_APPROVAL');
         if (inspectLog && inspectLog.userId) {
             const u = await this.userRepo.getById(inspectLog.userId);
             this.inspectedByName = u?.name || u?.email || 'N/A';
         }

         // Approved By: Last user who transitioned to APPROVED
         const approveLog = [...sortedAsc].reverse().find(l => l.toStatus === 'APPROVED' || l.toStatus === 'CLOSED');
         if (approveLog && approveLog.userId) {
             const u = await this.userRepo.getById(approveLog.userId);
             this.approvedByName = u?.name || u?.email || 'N/A';
         }
      }

      // KPI Calcs
      const total = snList.length;
      let pass = 0;
      let rework = 0;
      let scrap = 0;
      let hold = 0;

      const reworkList: { sn: LocalSerialNumber, childLinked: LocalChildReport | null }[] = [];

      for (const sn of snList) {
         const rawDisp = this.getDisposition(sn);
         const disp = rawDisp ? rawDisp.toUpperCase() : null;
         
         if (disp === 'PASS') pass++;
         else if (disp === 'REWORK') {
             rework++;
             const child = childReports.find(cr => cr.serialNumberId === sn.id) || null;
             reworkList.push({sn, childLinked: child});
         }
         else if (disp === 'SCRAP') scrap++;
         else if (disp === 'HOLD') hold++;
      }

      this.reworkSerials = reworkList;
      this.hasMissingChildrenForRework = reworkList.some(r => !r.childLinked);
      this.hasUnresolvedChildren = reworkList.some(r => {
          if (!r.childLinked) return true;
          return !['APPROVED', 'CLOSED', 'COMPLETED'].includes(r.childLinked.status);
      });

      this.kpiTotal = total;
      this.kpiPassed = pass;
      this.kpiRework = rework;
      this.kpiScrap = scrap;
      this.kpiHold = hold;
      this.kpiPassRate = total > 0 ? Math.round((pass / total) * 100) : 0;

      if (!this.isEditingMeta) {
         this.formInspectorComment = r.inspectorComment || '';
         this.formInspectionAddress = r.inspectionAddress || '';
         this.formStandardUsed = r.standardUsed || '';

         const eqList: Array<{name?: string, number?: string}> = Array.isArray(r.equipmentUsed) ? (r.equipmentUsed as Array<{name?: string, number?: string}>) : [];
         this.formEquipmentUsed = eqList.map(e => ({
            name: e.name || '',
            number: e.number || '',
            isOther: !this.EQUIPMENT_OPTIONS.includes(e.name || '')
         }));

         const methodList: Array<{name?: string}> = Array.isArray(r.inspectionMethod) ? (r.inspectionMethod as Array<{name?: string}>) : (typeof r.inspectionMethod === 'string' ? [{ name: r.inspectionMethod }] : []);
         this.formInspectionMethod = methodList.map(m => {
            const mName = typeof m === 'string' ? m : (m.name || '');
            return {
               name: mName,
               isOther: mName !== '' && !this.METHOD_OPTIONS.includes(mName)
            };
         });

         this.formGrade = r.grade || '';
         this.formRange = r.range || '';
         this.formWeight = r.weight || '';
         this.formNomWT = r.nomWT || '';
         this.formNomOD = r.nomOD || '';
         this.formNomID = r.nomID || '';
         this.formConnection = r.connection || '';
      }

    } else {
      this.validationResult = null;
      this.uiState = null;
      this.allowedTransitions = [];
      this.kpiTotal = 0;
      this.kpiPassed = 0;
      this.kpiRework = 0;
      this.kpiScrap = 0;
      this.kpiHold = 0;
      this.kpiPassRate = 0;
      this.reworkSerials = [];
      this.hasMissingChildrenForRework = false;
      this.hasUnresolvedChildren = false;
    }
  }

  public async onAddSerials() {
    this.formError = '';
    const rawLines = this.formBulkSerials.split('\n').filter(l => l.trim().length > 0);
    if (rawLines.length === 0) return;

    const lines = rawLines.map(l => l.trim());
    const uniqueLines = [...new Set(lines)];
    if (uniqueLines.length !== lines.length) {
      this.formError = 'Duplicate serial numbers found in the input list.';
      return;
    }

    const existingSns = this.serialsSubj.value;
    const existingVals = new Set(existingSns.map(s => s.value.toLowerCase()));
    const duplicates = uniqueLines.filter(l => existingVals.has(l.toLowerCase()));
    
    if (duplicates.length > 0) {
      this.formError = `These serial numbers already exist in this report: ${duplicates.join(', ')}`;
      return;
    }

    try {
      await this.irService.addSerialNumberOffline(this.reportId, uniqueLines);
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
    const newValue = this.editingSnValue.trim();
    if (!newValue || newValue === sn.value) {
      this.cancelEditSn();
      return;
    }

    const existingSns = this.serialsSubj.value;
    const duplicateExists = existingSns.some(s => s.id !== sn.id && s.value.toLowerCase() === newValue.toLowerCase());
    if (duplicateExists) {
       this.formError = `Serial number '${newValue}' already exists in this report.`;
       return;
    }

    try {
      await this.irService.renameSerialNumberOffline(sn.id, newValue);
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

  public async saveInspectionForm(inspectionData: Record<string, unknown>): Promise<void> {
    if (!this.inspectingSn) return;

    try {
      await this.irService.saveSerialNumberInspectionOffline(this.inspectingSn.id, inspectionData as Record<string, unknown>);
      
      this.refreshData();
      this.closeInspectionForm();
      
      if (this.isOnline) {
         this.syncOrchestrator.runSyncSequence().catch(err => console.error('Auto-sync failed', err));
      }
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to save inspection data.';
    }
  }

  public addEquipmentFormRow(): void {
    this.formEquipmentUsed.push({ name: '', number: '', isOther: false });
  }

  public removeEquipmentFormRow(index: number): void {
    this.formEquipmentUsed.splice(index, 1);
  }

  public onEquipmentSelectChange(index: number): void {
     if (this.formEquipmentUsed[index].name === 'Other') {
        this.formEquipmentUsed[index].isOther = true;
        this.formEquipmentUsed[index].name = ''; // Clear for user to type
     } else {
         this.formEquipmentUsed[index].isOther = false;
     }
  }

  public addMethodFormRow(): void {
    this.formInspectionMethod.push({ name: '', isOther: false });
  }

  public removeMethodFormRow(index: number): void {
    this.formInspectionMethod.splice(index, 1);
  }

  public onMethodSelectChange(index: number): void {
     if (this.formInspectionMethod[index].name === 'Other') {
        this.formInspectionMethod[index].isOther = true;
        this.formInspectionMethod[index].name = ''; // Clear for user to type
     } else {
         this.formInspectionMethod[index].isOther = false;
     }
  }

  public async saveMeta(): Promise<void> {
    this.formError = '';
    try {
       // Filter out empty equipment rows before saving
       const cleanEquipment = this.formEquipmentUsed
          .filter(e => e.name.trim() !== '' || e.number.trim() !== '')
          .map(e => ({ name: e.name, number: e.number }));
       
       const cleanMethod = this.formInspectionMethod
          .filter(m => m.name.trim() !== '')
          .map(m => ({ name: m.name }));

       await this.irService.updateReportOffline(this.reportId, { 
          inspectorComment: this.formInspectorComment,
          inspectionAddress: this.formInspectionAddress,
          standardUsed: this.formStandardUsed,
          equipmentUsed: cleanEquipment.length > 0 ? cleanEquipment : null,
          inspectionMethod: cleanMethod.length > 0 ? cleanMethod : null,
          grade: this.formGrade,
          range: this.formRange,
          weight: this.formWeight,
          nomWT: this.formNomWT,
          nomOD: this.formNomOD,
          nomID: this.formNomID,
          connection: this.formConnection
       });
       this.isEditingMeta = false;
       this.refreshData();
    } catch (error) {
       const e = error as Error;
       this.formError = e.message || 'Failed to save details.';
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
    const type = this.getDisposition(this.creatingChildReportForSn);
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
         const currentReport = this.reportSubj.value;
         const displayId = currentReport?.reportNumber || this.reportId;
         filename = `inspection-report-${displayId}${ext}`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      // Defer click so Angular's change detection can process isExporting=false
      // before the browser download dialog takes focus
      setTimeout(() => {
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
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
      this.cdr.detectChanges();
    }
  }

  public openKpiModal(status: 'PASS' | 'REWORK' | 'SCRAP' | 'HOLD'): void {
      this.activeModalStatus = status;
      this.modalEquipmentList = this.serialsSubj.value.filter(sn => this.getDisposition(sn) === status);
  }

  public closeKpiModal(): void {
      this.activeModalStatus = null;
      this.modalEquipmentList = [];
  }
}
