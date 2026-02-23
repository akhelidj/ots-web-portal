import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { InspectionReportsService } from './inspection-reports.service';
import { LocalInspectionReport, LocalSerialNumber, LocalTransitionLog } from '../core/offline/types';

@Component({
  selector: 'app-inspection-report-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './inspection-report-detail.component.html'
})
export class InspectionReportDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private irService = inject(InspectionReportsService);

  public reportId = '';
  public reportSubj = new BehaviorSubject<LocalInspectionReport | null>(null);
  public report$ = this.reportSubj.asObservable();
  public serialsSubj = new BehaviorSubject<LocalSerialNumber[]>([]);
  public serials$ = this.serialsSubj.asObservable();
  public transitionLogsSubj = new BehaviorSubject<LocalTransitionLog[]>([]);
  public transitionLogs$ = this.transitionLogsSubj.asObservable();
  
  public formBulkSerials = '';
  public formReason = '';
  public formError = '';
  public editingSnId: string | null = null;
  public editingSnValue = '';

  public allowedTransitions: { toStatus: string; requiresReason: boolean }[] = []; 
  public selectedTransition: { toStatus: string; requiresReason: boolean } | null = null;

  async ngOnInit() {
    this.reportId = this.route.snapshot.paramMap.get('id') || '';
    if (this.reportId) {
      this.refreshData();
      
      this.irService.reports$.subscribe(() => {
        this.refreshData();
      });

      await this.irService.refreshAvailableTransitions(this.reportId);
      await this.irService.refreshTransitionLogs(this.reportId);
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
       } catch (e) {
         this.allowedTransitions = [];
       }
    } else {
       this.allowedTransitions = [];
    }

    const snList = await this.irService.getSnForReport(this.reportId);
    this.serialsSubj.next(snList);

    const logs = await this.irService.getTransitionLogsLocally(this.reportId);
    this.transitionLogsSubj.next(logs);
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
}
