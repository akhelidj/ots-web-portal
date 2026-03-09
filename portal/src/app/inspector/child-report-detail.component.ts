import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ChildReportsService } from './child-reports.service';
import { InspectionReportsService } from './inspection-reports.service';
import { SessionService } from '../core/auth/session.service';
import { LocalChildReport, LocalInspectionReport } from '../core/offline/types';
import { getChildReportUiState, ChildReportUiState, UserRole, ChildReportStatus } from '../core/ui-policy/child-report-ui-policy';
import { environment } from '../../environments/environment';
import { SerialInspectionReactiveFormComponent } from './serial-inspection-reactive-form.component';

@Component({
  selector: 'app-child-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SerialInspectionReactiveFormComponent],
  templateUrl: './child-report-detail.component.html'
})
export class ChildReportDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private crService = inject(ChildReportsService);
  private irService = inject(InspectionReportsService);
  private session = inject(SessionService);

  public reportId = '';
  public crSubj = new BehaviorSubject<LocalChildReport | null>(null);
  public cr$ = this.crSubj.asObservable();
  
  public parentReportSubj = new BehaviorSubject<LocalInspectionReport | null>(null);
  public parentReport$ = this.parentReportSubj.asObservable();
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public serialsSubj = new BehaviorSubject<{id: string; serial: string; inspectionData?: any; disposition?: string}[]>([]);
  public serials$ = this.serialsSubj.asObservable();

  public inspectingSnId: string | null = null;
  public inspectingSnValue = '';
  public inspectionFormData: Record<string, unknown> = {};

  public uiState: ChildReportUiState | null = null;
  public userRole = '';
  public allowedTransitions: { toStatus: string; requiresReason: boolean; enabled: boolean; label?: string; disabledReason?: string; }[] = []; 
  public selectedTransition: { toStatus: string; requiresReason: boolean; label?: string } | null = null;
  public formReason = '';
  public formError = '';
  
  public notes = '';
  public isEditingNotes = false;
  private isRefreshing = false;

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
      
      // Skip reactive refreshes while a server pull is already in progress
      // to avoid the loop: pullSingleFromServer → crRepo.upsert → changes$ → refreshData loop
      this.crService.changes$.subscribe(() => {
        if (!this.isRefreshing) this.refreshData();
      });
      this.irService.reports$.subscribe(() => {
        if (!this.isRefreshing) this.refreshData();
      });
    }
  }

  private async refreshData() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    try {
    // Always pull from server first when online — this keeps local cache fresh
    // and solves the private/incognito window case where local DB is empty.
    if (this.isOnline) {
      await this.crService.pullSingleFromServer(this.reportId);
    }

    const cr = await this.crService['crRepo'].getById(this.reportId) as LocalChildReport | null;
    this.crSubj.next(cr);

    if (cr) {
      if (!this.isEditingNotes) {
         this.notes = cr.notes || '';
      }

      // Fetch parent report — pull from server if not found locally (private window case)
      let parent = await this.irService.irRepo.getById(cr.inspectionReportId) as LocalInspectionReport | null;
      if (!parent && this.isOnline) {
        try {
          const serverParent = await firstValueFrom(
            this.http.get<LocalInspectionReport>(`${environment.apiUrl}/inspection-reports/${cr.inspectionReportId}`)
          );
          await this.irService.irRepo.upsert({ ...serverParent, syncState: 'SYNCED' });
          parent = serverParent;
        } catch (e) {
          console.error('Failed to fetch parent report from server', e);
        }
      }
      this.parentReportSubj.next(parent);

      this.serialsSubj.next(cr.serialNumbers || []);

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
  } finally {
    this.isRefreshing = false;
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
        await this.crService.updateNotes(this.reportId, this.notes);
      }
      await this.crService.transition(
        this.reportId, 
        this.selectedTransition.toStatus as LocalChildReport['status'],
        this.formReason
      );
      this.selectedTransition = null;
      this.formReason = '';
      this.isEditingNotes = false;
      await this.refreshData();
    } catch (error) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError = e?.error?.message || (e as Error)?.message || 'Failed to transition report.';
    }
  }

  public async saveNotes() {
    this.formError = '';
    try {
      await this.crService.updateNotes(this.reportId, this.notes);
      this.isEditingNotes = false;
      await this.refreshData();
    } catch (error) {
       const e = error as { error?: { message?: string }; message?: string };
       this.formError = e?.error?.message || (e as Error)?.message || 'Failed to save notes.';
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

  public openInspectionForm(id: string) {
    const target = this.serialsSubj.value.find(s => s.id === id);
    if (!target) return;
    this.inspectingSnId = id;
    this.inspectingSnValue = target.serial;
    this.inspectionFormData = target.inspectionData || {};
  }

  public closeInspectionForm() {
    this.inspectingSnId = null;
    this.inspectingSnValue = '';
    this.inspectionFormData = {};
  }

  public async saveInspectionForm(data: Record<string, unknown>) {
    if (!this.inspectingSnId) return;
    const cr = this.crSubj.value;
    if (!cr) return;

    const target = this.serialsSubj.value.find(s => s.id === this.inspectingSnId);
    
    // Extract the new disposition from the emitted form data
    const finalData = data['final'] as Record<string, unknown> | undefined;
    const newDisposition = (finalData?.['disposition'] || data['disposition'] || target?.disposition) as any;

    try {
      await this.crService.updateSerialNumberInspection(
        this.reportId,
        this.inspectingSnId,
        data,
        newDisposition
      );
      this.closeInspectionForm();
      await this.refreshData();
    } catch (e) {
      const err = e as { error?: { message?: string }; message?: string };
      this.formError = err?.error?.message || (err as Error)?.message || 'Failed to save inspection data.';
    }
  }

  public get hasPrevSn(): boolean {
    if (!this.inspectingSnId) return false;
    const all = this.serialsSubj.value;
    const idx = all.findIndex(s => s.id === this.inspectingSnId);
    return idx > 0;
  }

  public get hasNextSn(): boolean {
    if (!this.inspectingSnId) return false;
    const all = this.serialsSubj.value;
    const idx = all.findIndex(s => s.id === this.inspectingSnId);
    return idx >= 0 && idx < all.length - 1;
  }

  public goToPrevSn() {
    if (!this.inspectingSnId) return;
    const all = this.serialsSubj.value;
    const idx = all.findIndex(s => s.id === this.inspectingSnId);
    if (idx > 0) {
      this.openInspectionForm(all[idx - 1].id);
    }
  }

  public goToNextSn() {
    if (!this.inspectingSnId) return;
    const all = this.serialsSubj.value;
    const idx = all.findIndex(s => s.id === this.inspectingSnId);
    if (idx >= 0 && idx < all.length - 1) {
      this.openInspectionForm(all[idx + 1].id);
    }
  }
}
