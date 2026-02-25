import { Component, inject, OnInit, Input, OnDestroy, ChangeDetectorRef } from '@angular/core';
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
  private cdr = inject(ChangeDetectorRef);

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

  public kpiTotalReports = 0;
  public kpiOpenReports = 0;
  public kpiClosedReports = 0;
  
  public reportStatsCache: Record<string, { serialCount: number, passCount: number, serialValues: string[] }> = {};
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
        this.computeCustomerKpis(reports);
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
    const newStats: Record<string, { serialCount: number, passCount: number, serialValues: string[] }> = {};
    for (const r of reports) {
       // Only fetch serials for reports in the current scope
       const serials = await this.snRepo.listByReportId(r.id);
       newStats[r.id] = {
         serialCount: serials.length,
         passCount: serials.filter(s => {
            const finalSection = s.inspectionJson?.['final'] as Record<string, unknown> | undefined;
            const rawDisp = (finalSection?.['disposition'] as string) || (s.inspectionJson?.['disposition'] as string) || null;
            return rawDisp ? rawDisp.toUpperCase() === 'PASS' : false;
         }).length,
         serialValues: serials.map(s => s.value.toLowerCase())
       };
    }
    this.reportStatsCache = newStats;
    // We need to trigger change detection here if Angular isn't picking up the async mutation to the cache
    // But since this is called from an observable subscription, it should be fine. Just to be safe, we re-assign the object reference
    this.reportStatsCache = { ...newStats };
    this.cdr.markForCheck();
  }

  private computeCustomerKpis(reports: LocalInspectionReport[]) {
     this.kpiTotalReports = reports.length;
     this.kpiClosedReports = reports.filter(r => r.status === 'CLOSED').length;
     this.kpiOpenReports = this.kpiTotalReports - this.kpiClosedReports;
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

  getCustomerName(id: string | null): string {
    if (!id) return 'Unknown';
    const customer = this.customersSubj.value.find(c => c.id === id);
    return customer ? customer.name : id;
  }

  getPassRate(reportId: string): number | null {
    const stats = this.reportStatsCache[reportId];
    if (!stats || stats.serialCount === 0) return null;
    return stats.passCount / stats.serialCount;
  }

  getFilteredReports(reports: LocalInspectionReport[]) {
    const filtered = reports.filter(r => {
      let matchStatus = true;
      if (this.statusFilter === 'OPEN') {
         matchStatus = r.status !== 'CLOSED';
      } else if (this.statusFilter) {
         matchStatus = r.status === this.statusFilter;
      }

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
