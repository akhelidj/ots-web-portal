import { Component, inject, OnInit, Input, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Subscription, combineLatest, startWith } from 'rxjs';
import { InspectionReportsService } from './inspection-reports.service';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';
import { SyncOrchestratorService } from '../core/offline/sync-orchestrator.service';
import { FormsModule } from '@angular/forms';
import { LocalCustomer, LocalInspectionReport, LocalSerialNumber } from '../core/offline/types';
import { ReportValidationService, ValidationResult } from '../core/validation/report-validation.service';
import { SerialNumberLocalRepo } from '../core/offline/serial-number-local.repo';
import { ChildReportLocalRepo } from '../core/offline/child-report-local.repo';

@Component({
  selector: 'app-inspection-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './inspection-report-list.component.html'
})
export class InspectionReportListComponent implements OnInit, OnDestroy {
  private irService = inject(InspectionReportsService);
  private customerRepo = inject(CustomerLocalRepo);
  public syncOrchestrator = inject(SyncOrchestratorService);
  private validationService = inject(ReportValidationService);
  private snRepo = inject(SerialNumberLocalRepo);
  private childReportRepo = inject(ChildReportLocalRepo);

  public reports$ = this.irService.reports$;
  private customersSubj = new BehaviorSubject<LocalCustomer[]>([]);
  public customers$ = this.customersSubj.asObservable();
  
  public statusFilter = '';
  public customerFilter = '';
  public qFilter = '';

  public validationCache: Record<string, ValidationResult> = {};
  private subs = new Subscription();

  @Input() initialStatusFilter?: string;

  ngOnInit() {
    if (this.initialStatusFilter) {
      this.statusFilter = this.initialStatusFilter;
    }
    this.irService.refreshLocalCache();
    this.loadCustomers();
    
    this.subs.add(this.customerRepo.changes$.subscribe(() => this.loadCustomers()));
    
    this.subs.add(
      combineLatest([
        this.reports$, 
        this.snRepo.changes$.pipe(startWith(null)), 
        this.childReportRepo.changes$.pipe(startWith(null))
      ]).subscribe(([reports]) => {
        this.computeValidations(reports);
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customersSubj.next(list);
  }

  private async computeValidations(reports: LocalInspectionReport[]) {
    const allSerials = await this.snRepo.list();
    const allChildReports = await this.childReportRepo.list();
    
    const snByReport = allSerials.reduce((acc: Record<string, LocalSerialNumber[]>, sn: LocalSerialNumber) => {
       acc[sn.inspectionReportId] = acc[sn.inspectionReportId] || [];
       acc[sn.inspectionReportId].push(sn);
       return acc;
    }, {});

    const crByReport = allChildReports.reduce((acc: Record<string, typeof allChildReports>, cr: typeof allChildReports[0]) => {
       acc[cr.inspectionReportId] = acc[cr.inspectionReportId] || [];
       acc[cr.inspectionReportId].push(cr);
       return acc;
    }, {});

    const newCache: Record<string, ValidationResult> = {};
    for (const r of reports) {
       newCache[r.id] = this.validationService.validate(
         r, 
         snByReport[r.id] || [], 
         crByReport[r.id] || []
       );
    }
    this.validationCache = newCache;
  }

  getFilteredReports(reports: LocalInspectionReport[]) {
    return reports.filter(r => {
      const matchStatus = this.statusFilter ? r.status === this.statusFilter : true;
      const matchCustomer = this.customerFilter ? r.customerId === this.customerFilter : true;
      const matchQ = this.qFilter && this.qFilter.trim().length >= 2 
          ? r.poNumber.toLowerCase().includes(this.qFilter.trim().toLowerCase()) 
          : true;
      return matchStatus && matchCustomer && matchQ;
    });
  }
}
