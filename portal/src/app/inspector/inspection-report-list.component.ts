import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { InspectionReportsService } from './inspection-reports.service';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';
import { SyncOrchestratorService } from '../core/offline/sync-orchestrator.service';
import { FormsModule } from '@angular/forms';
import { LocalCustomer, LocalInspectionReport } from '../core/offline/types';

@Component({
  selector: 'app-inspection-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './inspection-report-list.component.html'
})
export class InspectionReportListComponent implements OnInit {
  private irService = inject(InspectionReportsService);
  private customerRepo = inject(CustomerLocalRepo);
  public syncOrchestrator = inject(SyncOrchestratorService);

  public reports$ = this.irService.reports$;
  private customersSubj = new BehaviorSubject<LocalCustomer[]>([]);
  public customers$ = this.customersSubj.asObservable();
  
  public statusFilter = '';
  public customerFilter = '';

  ngOnInit() {
    this.irService.refreshLocalCache();
    this.loadCustomers();
    this.customerRepo.changes$.subscribe(() => this.loadCustomers());
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customersSubj.next(list);
  }

  getFilteredReports(reports: LocalInspectionReport[]) {
    return reports.filter(r => {
      const matchStatus = this.statusFilter ? r.status === this.statusFilter : true;
      const matchCustomer = this.customerFilter ? r.customerId === this.customerFilter : true;
      return matchStatus && matchCustomer;
    });
  }
}
