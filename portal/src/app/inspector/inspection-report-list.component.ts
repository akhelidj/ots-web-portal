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
import { SessionService } from '../core/auth/session.service';

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
  private sessionService = inject(SessionService);

  public reports$ = this.irService.reports$;
  private customersSubj = new BehaviorSubject<LocalCustomer[]>([]);
  public customers$ = this.customersSubj.asObservable();
  
  public statusFilter = '';
  public customerFilter = '';
  public qFilter = '';
  public snFilter = '';
  public sortBy: 'updatedAt' | 'poNumber' | 'status' = 'updatedAt';

  public isCustomer = false;
  public isReceiver = false;
  public isAdmin = false;
  
  public reportStatsCache: Record<string, { serialCount: number, serialValues: string[] }> = {};
  public validationCache: Record<string, ValidationResult> = {};
  private subs = new Subscription();

  @Input() initialStatusFilter?: string;

  ngOnInit() {
    if (this.initialStatusFilter) {
      this.statusFilter = this.initialStatusFilter;
    }
    this.irService.refreshLocalCache();
    this.loadCustomers();
    
    this.subs.add(this.sessionService.profile$.subscribe(p => {
       this.isCustomer = p?.role === 'CUSTOMER';
       this.isReceiver = p?.role === 'RECEIVER';
       this.isAdmin = p?.role === 'ADMIN';
    }));

    this.subs.add(this.customerRepo.changes$.subscribe(() => this.loadCustomers()));
    
    this.subs.add(
      combineLatest([
        this.reports$, 
        this.snRepo.changes$.pipe(startWith(null)), 
        this.childReportRepo.changes$.pipe(startWith(null))
      ]).subscribe(([reports]) => {
        this.computeStats(reports);
        if (!this.isCustomer) {
           this.computeValidations(reports);
        }
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

  private async computeStats(reports: LocalInspectionReport[]) {
    const newStats: Record<string, { serialCount: number, serialValues: string[] }> = {};
    for (const r of reports) {
       // Only fetch serials for reports in the current scope
       const serials = await this.snRepo.listByReportId(r.id);
       newStats[r.id] = {
         serialCount: serials.length,
         serialValues: serials.map(s => s.value.toLowerCase())
       };
    }
    this.reportStatsCache = newStats;
  }

  private async computeValidations(reports: LocalInspectionReport[]) {
    // Left existing bulk fetch specifically for supervisor/inspector workflows
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
    const filtered = reports.filter(r => {
      const matchStatus = this.statusFilter ? r.status === this.statusFilter : true;
      const matchCustomer = this.customerFilter ? r.customerId === this.customerFilter : true;
      const matchQ = this.qFilter && this.qFilter.trim().length >= 2 
          ? r.poNumber.toLowerCase().includes(this.qFilter.trim().toLowerCase()) 
          : true;
      
      let matchSn = true;
      if (this.snFilter && this.snFilter.trim().length >= 2) {
          const stats = this.reportStatsCache[r.id];
          const query = this.snFilter.trim().toLowerCase();
          matchSn = stats ? stats.serialValues.some(val => val.includes(query)) : false;
      }
      return matchStatus && matchCustomer && matchQ && matchSn;
    });

    return filtered.sort((a, b) => {
       const valA = a[this.sortBy as keyof LocalInspectionReport] as string | number | undefined;
       const valB = b[this.sortBy as keyof LocalInspectionReport] as string | number | undefined;

       if (this.sortBy === 'updatedAt') {
          const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          if (timeA !== timeB) return timeB - timeA; // Descending
       } else {
          const strA = (valA || '').toString().toLowerCase();
          const strB = (valB || '').toString().toLowerCase();
          if (strA < strB) return -1;
          if (strA > strB) return 1;
       }

       // Tie-breakers
       if (a.poNumber !== b.poNumber) return a.poNumber.localeCompare(b.poNumber);
       return a.id.localeCompare(b.id);
    });
  }
}
