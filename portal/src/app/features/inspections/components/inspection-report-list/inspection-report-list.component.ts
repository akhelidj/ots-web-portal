import {
  Component,
  inject,
  OnInit,
  Input,
  OnDestroy,
  ChangeDetectorRef,
  Injector,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subscription, combineLatest, startWith } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { SyncOrchestratorService } from '@portal/core/offline/services/sync-orchestrator.service';
import { FormsModule } from '@angular/forms';
import {
  LocalCustomer,
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';
import {
  ReportValidationService,
  ValidationResult,
} from '@portal/core/validation/services/report-validation.service';
import { SerialNumberLocalRepo } from '@portal/core/offline/repos/serial-number-local.repo';
import { ChildReportLocalRepo } from '@portal/core/offline/repos/child-report-local.repo';
import { SessionService } from '@portal/core/auth/services/session.service';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';
import {
  APP_ROLES,
  REPORT_STATUSES,
} from '@portal/core/constants/app.constants';
import {
  BadgeSeverity,
  StatusBadgeComponent,
} from '@portal/shared/components/status-badge/status-badge.component';
import {
  classifyOutcome,
  TemplateFormDefinition,
} from '@portal/features/templates/schemas/definition-to-form-schema';

@Component({
  selector: 'app-inspection-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, StatusBadgeComponent],
  templateUrl: './inspection-report-list.component.html',
})
export class InspectionReportListComponent implements OnInit, OnDestroy {
  private irService = inject(InspectionReportsService);
  private customerRepo = inject(CustomerLocalRepo);
  public syncOrchestrator = inject(SyncOrchestratorService);
  private validationService = inject(ReportValidationService);
  private snRepo = inject(SerialNumberLocalRepo);
  private childReportRepo = inject(ChildReportLocalRepo);
  private sessionService = inject(SessionService);
  public prefs = inject(UserPreferencesService);
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);

  public reports = this.irService.reports;
  public customers = signal<LocalCustomer[]>([]);

  public statusFilter = '';
  public customerFilter = '';
  public qFilter = '';
  public snFilter = '';
  public sortBy: 'updatedAt' | 'poNumber' | 'status' = 'updatedAt';

  public isCustomer = false;
  public isReceiver = false;
  public isAdmin = false;
  /** Customer's organization name, for the quiet document header (customer view only). */
  public customerOrgName = '';
  private customerScopeId: string | null = null;

  public kpiTotalReports = 0;
  public kpiOpenReports = 0;
  public kpiClosedReports = 0;

  public reportStatsCache: Record<
    string,
    { serialCount: number; passCount: number; serialValues: string[] }
  > = {};
  public validationCache: Record<string, ValidationResult> = {};
  public isCompactMode = computed(() => this.prefs.preferences().compactMode);
  private subs = new Subscription();

  /**
   * Fade-before-reflow phase for the customer document list. A discrete status
   * or sort change fades the list body OUT (accelerate), swaps the data while
   * it's invisible so the height reflow isn't seen, then settles it back IN
   * (decelerate) — the marketing site's signature rule, at app scale. Idle when
   * nothing is transitioning. Search-as-you-type is deliberately excluded so
   * typing feedback stays instant.
   */
  public listPhase = signal<'idle' | 'out' | 'in'>('idle');
  private reflowTimers: ReturnType<typeof setTimeout>[] = [];

  @Input() initialStatusFilter?: string;

  ngOnInit() {
    if (this.initialStatusFilter) {
      this.statusFilter = this.initialStatusFilter;
    }
    this.irService.refreshLocalCache();
    this.loadCustomers();

    const p = this.sessionService.profile();
    if (p) {
      this.isCustomer = p.role === APP_ROLES.CUSTOMER;
      this.isReceiver = p.role === APP_ROLES.RECEIVER;
      this.isAdmin = p.role === APP_ROLES.ADMIN;
      this.customerScopeId =
        p.role === APP_ROLES.CUSTOMER && p.customerId ? p.customerId : null;
      this.customerOrgName = p.customer?.name || p.tenant?.name || '';
    }

    this.subs.add(
      this.customerRepo.changes$.subscribe(() => this.loadCustomers()),
    );

    this.subs.add(
      combineLatest([
        toObservable(this.irService.reports, { injector: this.injector }),
        this.snRepo.changes$.pipe(startWith(null)),
        this.childReportRepo.changes$.pipe(startWith(null)),
      ]).subscribe(([reports]) => {
        const scopedReports = this.customerScopeId
          ? reports.filter((r) => r.customerId === this.customerScopeId)
          : reports;

        this.computeStats(scopedReports);
        this.computeCustomerKpis(scopedReports);
        if (!this.isCustomer) {
          this.computeValidations(scopedReports);
        }
      }),
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.clearReflowTimers();
  }

  /**
   * Apply a discrete status-filter change through the fade-before-reflow.
   * Called only from the customer document filter cells; the ops status
   * <select> keeps its plain [(ngModel)] binding, so ops is unaffected.
   */
  applyStatusFilter(value: string) {
    if (this.statusFilter === value) return;
    this.runReflow(() => (this.statusFilter = value));
  }

  /** Apply a discrete sort change through the same choreography. */
  applySort(value: 'updatedAt' | 'poNumber' | 'status') {
    if (this.sortBy === value) return;
    this.runReflow(() => (this.sortBy = value));
  }

  private clearReflowTimers() {
    this.reflowTimers.forEach((t) => clearTimeout(t));
    this.reflowTimers = [];
  }

  /** Duration token (`--duration-fast`) in ms, so the JS timing tracks the CSS. */
  private motionFastMs(): number {
    if (typeof window === 'undefined') return 220;
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--duration-fast')
      .trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 220;
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  private runReflow(apply: () => void) {
    // Reduced motion (or no window): apply instantly, no choreography.
    if (this.prefersReducedMotion()) {
      apply();
      this.listPhase.set('idle');
      this.cdr.markForCheck();
      return;
    }
    this.clearReflowTimers();
    const d = this.motionFastMs();
    this.listPhase.set('out');
    this.reflowTimers.push(
      setTimeout(() => {
        apply();
        this.listPhase.set('in');
        this.cdr.markForCheck();
        this.reflowTimers.push(
          setTimeout(() => {
            this.listPhase.set('idle');
            this.cdr.markForCheck();
          }, d),
        );
      }, d),
    );
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customers.set(list);
  }

  private async computeStats(reports: LocalInspectionReport[]) {
    const newStats: Record<
      string,
      { serialCount: number; passCount: number; serialValues: string[] }
    > = {};
    for (const r of reports) {
      // Only fetch serials for reports in the current scope
      const serials = await this.snRepo.listByReportId(r.id);
      newStats[r.id] = {
        serialCount: serials.length,
        passCount: serials.filter(
          (s) =>
            // Classify through the shared outcome classifier — the same bucketing the
            // detail KPIs, tables, and server use — so the list's pass count agrees with
            // every other surface. A serial counts here iff it lands in the `pass` bucket.
            classifyOutcome(
              s.inspectionJson ?? null,
              r.definitionJson as TemplateFormDefinition | null,
            ) === 'pass',
        ).length,
        serialValues: serials.map((s) => s.value.toLowerCase()),
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
    this.kpiClosedReports = reports.filter((r) => r.status === 'CLOSED').length;
    this.kpiOpenReports = this.kpiTotalReports - this.kpiClosedReports;
  }

  private async computeValidations(reports: LocalInspectionReport[]) {
    // Left existing bulk fetch specifically for supervisor/inspector workflows
    const allSerials = await this.snRepo.list();

    const snByReport = allSerials.reduce(
      (acc: Record<string, LocalSerialNumber[]>, sn: LocalSerialNumber) => {
        const bucket = (acc[sn.inspectionReportId] ||= []);
        bucket.push(sn);
        return acc;
      },
      {},
    );

    const newCache: Record<string, ValidationResult> = {};
    for (const r of reports) {
      newCache[r.id] = this.validationService.validate(
        r,
        snByReport[r.id] || [],
      );
    }
    this.validationCache = newCache;
  }

  getCustomerName(id: string | null): string {
    if (!id) return 'Unknown';
    const customer = this.customers().find((c) => c.id === id);
    return customer ? customer.name : id;
  }

  getPassRate(reportId: string): number | null {
    const stats = this.reportStatsCache[reportId];
    if (!stats || stats.serialCount === 0) return null;
    return stats.passCount / stats.serialCount;
  }

  /**
   * Status → badge severity for the customer document list. Mirrors the detail
   * view's `reportStatusSeverity` so a status reads the same colour on the list
   * as on the report it opens.
   */
  statusSeverity(status: string): BadgeSeverity {
    switch (status) {
      case REPORT_STATUSES.APPROVED:
      case REPORT_STATUSES.CLOSED:
        return 'success';
      case REPORT_STATUSES.ON_HOLD:
        return 'warning';
      case REPORT_STATUSES.PENDING_APPROVAL:
        return 'info';
      default:
        return 'neutral';
    }
  }

  /**
   * Whether the customer has narrowed the list (status chip, PO search, or S/N
   * search). Drives the empty state: "nothing matches your filter" vs. the
   * first-run "no reports yet". Sort is not a narrowing control, so it's excluded.
   */
  hasActiveCustomerFilter(): boolean {
    const q = this.qFilter.trim();
    const sn = this.snFilter.trim();
    return !!this.statusFilter || q.length >= 2 || sn.length >= 2;
  }

  getFilteredReports(reports: LocalInspectionReport[]) {
    const filtered = reports.filter((r) => {
      // Safety: always scope CUSTOMER users to their own customerId in case
      // stale IndexedDB data from another customer is present
      if (this.customerScopeId && r.customerId !== this.customerScopeId) {
        return false;
      }

      let matchStatus = true;
      if (this.statusFilter === 'OPEN') {
        matchStatus = r.status !== 'CLOSED';
      } else if (this.statusFilter) {
        matchStatus = r.status === this.statusFilter;
      }

      const matchCustomer = this.customerFilter
        ? r.customerId === this.customerFilter
        : true;
      const matchQ =
        this.qFilter && this.qFilter.trim().length >= 2
          ? r.poNumber.toLowerCase().includes(this.qFilter.trim().toLowerCase())
          : true;

      let matchSn = true;
      if (this.snFilter && this.snFilter.trim().length >= 2) {
        const stats = this.reportStatsCache[r.id];
        const query = this.snFilter.trim().toLowerCase();
        matchSn = stats
          ? stats.serialValues.some((val) => val.includes(query))
          : false;
      }
      return matchStatus && matchCustomer && matchQ && matchSn;
    });

    return filtered.sort((a, b) => {
      const valA = a[this.sortBy as keyof LocalInspectionReport] as
        | string
        | number
        | undefined;
      const valB = b[this.sortBy as keyof LocalInspectionReport] as
        | string
        | number
        | undefined;

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
      if (a.poNumber !== b.poNumber)
        return a.poNumber.localeCompare(b.poNumber);
      return a.id.localeCompare(b.id);
    });
  }
}
