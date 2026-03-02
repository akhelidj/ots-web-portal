import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ChildReportsService } from './child-reports.service';
import { InspectionReportsService } from './inspection-reports.service';
import { SessionService } from '../core/auth/session.service';
import { LocalChildReport, LocalInspectionReport, LocalSerialNumber } from '../core/offline/types';
import { getChildReportUiState, ChildReportUiState, UserRole, ChildReportStatus } from '../core/ui-policy/child-report-ui-policy';

@Component({
  selector: 'app-child-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './child-report-detail.component.html'
})
export class ChildReportDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private crService = inject(ChildReportsService);
  private irService = inject(InspectionReportsService);
  private session = inject(SessionService);

  public reportId = '';
  public crSubj = new BehaviorSubject<LocalChildReport | null>(null);
  public cr$ = this.crSubj.asObservable();
  
  public parentReportSubj = new BehaviorSubject<LocalInspectionReport | null>(null);
  public parentReport$ = this.parentReportSubj.asObservable();
  
  public serialSubj = new BehaviorSubject<LocalSerialNumber | null>(null);
  public serial$ = this.serialSubj.asObservable();

  public uiState: ChildReportUiState | null = null;
  public userRole = '';
  public allowedTransitions: { toStatus: string; requiresReason: boolean; enabled: boolean; label?: string; disabledReason?: string; }[] = []; 
  public selectedTransition: { toStatus: string; requiresReason: boolean; label?: string } | null = null;
  public formReason = '';
  public formError = '';
  
  public notes = '';
  public isEditingNotes = false;

  public get isOnline(): boolean {
    return navigator.onLine;
  }

  ngOnInit() {
    this.session.profile$.subscribe(p => {
      if (!p) return;
      this.userRole = p.role || '';
      if (this.reportId) {
         this.refreshData();
      }
    });
    
    this.reportId = this.route.snapshot.paramMap.get('id') || '';
    if (this.reportId) {
      this.refreshData();
      
      this.crService.changes$.subscribe(() => {
        this.refreshData();
      });
      this.irService.reports$.subscribe(() => {
        this.refreshData();
      });
    }
  }

  private async refreshData() {
    const list = await (this.crService as unknown as { crRepo: { list: () => Promise<LocalChildReport[]> } }).crRepo.list(); 
    const cr = list.find((x: LocalChildReport) => x.id === this.reportId) || null;
    this.crSubj.next(cr);

    if (cr) {
      if (!this.isEditingNotes) {
         this.notes = cr.notes || '';
      }

      const allIR = await this.irService.irRepo.list();
      const parent = allIR.find((x: LocalInspectionReport) => x.id === cr.inspectionReportId) || null;
      this.parentReportSubj.next(parent);

      const allSn = await (this.irService as unknown as { snRepo: { listByReportId: (id: string) => Promise<LocalSerialNumber[]> } }).snRepo.listByReportId(cr.inspectionReportId);
      const sn = allSn.find((x: LocalSerialNumber) => x.id === cr.serialNumberId) || null;
      this.serialSubj.next(sn);

      this.uiState = getChildReportUiState({
         role: this.userRole as UserRole,
         reportStatus: cr.status as ChildReportStatus,
         parentReportStatus: parent?.status || 'UNKNOWN',
         isOffline: !this.isOnline,
         syncState: cr.syncState as 'SYNCED' | 'PENDING' | 'CONFLICT'
      });

      this.allowedTransitions = this.uiState.transitionChoices;
    } else {
      this.uiState = null;
      this.allowedTransitions = [];
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
      if (this.notes !== this.crSubj.value?.notes) {
        await this.crService.updateOffline(this.reportId, { notes: this.notes });
      }
      await this.crService.transitionOffline(
        this.reportId, 
        this.selectedTransition.toStatus as LocalChildReport['status'],
        this.formReason
      );
      this.selectedTransition = null;
      this.formReason = '';
      this.isEditingNotes = false;
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to transition report.';
    }
  }

  public async saveNotes() {
    this.formError = '';
    try {
      await this.crService.updateOffline(this.reportId, { notes: this.notes });
      this.isEditingNotes = false;
      this.refreshData();
    } catch (error) {
       const e = error as Error;
       this.formError = e.message || 'Failed to save notes.';
    }
  }

  public getParentReportLink(parentId: string): string[] {
    const role = this.userRole.toLowerCase();
    if (role === 'admin' || role === 'inspector') {
       return ['/', role, 'reports', parentId];
    }
    return ['/', role, parentId];
  }

  public goBack() {
    const parentId = this.parentReportSubj.value?.id;
    if (parentId) {
      this.router.navigate(this.getParentReportLink(parentId));
    } else {
      const role = this.userRole.toLowerCase();
      if (role === 'admin' || role === 'inspector') {
        this.router.navigate(['/', role, 'reports']);
      } else {
        this.router.navigate(['/', role]);
      }
    }
  }

  public formFile: File | null = null;
  public isUploading = false;
  public uploadSuccess = false;

  public onFileSelected(event: Event) {
    const el = event.target as HTMLInputElement;
    if (el.files && el.files.length > 0) {
      this.formFile = el.files[0];
      this.uploadSuccess = false;
    } else {
      this.formFile = null;
    }
  }

  public async uploadAttachment() {
    this.formError = '';
    this.uploadSuccess = false;
    if (!this.formFile) {
      this.formError = 'Please select a file to upload.';
      return;
    }
    
    this.isUploading = true;
    try {
      await this.crService.uploadAttachment(this.reportId, this.formFile);
      this.formFile = null;
      this.uploadSuccess = true;
      
      // Auto-hide success message after 3 seconds
      setTimeout(() => this.uploadSuccess = false, 3000);
      
      // In a full implementation, you'd refresh the attachments list here.
      // But since attachments are currently only checked for length > 0 on transition 
      // by pulling from DB directly, a successful API upload will satisfy the backend.
      // We'll just show a success message or clear the form.

      this.refreshData();
    } catch (error: unknown) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError = e?.error?.message || e?.message || 'Failed to upload attachment.';
    } finally {
      this.isUploading = false;
    }
  }
}
