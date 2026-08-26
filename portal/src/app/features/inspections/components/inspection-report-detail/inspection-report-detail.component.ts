import {
  Component,
  inject,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectorRef,
  signal,
  computed,
  Injector,
  ViewChild,
  ElementRef,
  HostListener,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';

import {
  HttpClient,
  HttpResponse,
  HttpErrorResponse,
} from '@angular/common/http';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import {
  APP_ROLES,
  AppRole,
  ReportStatus,
  REPORT_STATUSES,
  CHILD_REPORT_TYPES,
  SERIAL_DISPOSITIONS,
  BATCH_STATUSES,
  SERIAL_STATUSES,
  SYNC_STATES,
  SyncState,
  ENTITY_TYPES,
} from '@portal/core/constants/app.constants';
import { ChildReportsService } from '@portal/features/inspections/services/child-reports.service';
import { environment } from '@app-env/environment';
import { SessionService } from '@portal/core/auth/services/session.service';
import {
  LocalInspectionReport,
  LocalSerialNumber,
  LocalTransitionLog,
  LocalChildReport,
  LocalInspectionApprovalBatch,
} from '@portal/core/offline/models/types';
import {
  ReportValidationService,
  ValidationResult,
} from '@portal/core/validation/services/report-validation.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import {
  getInspectionReportUiState,
  InspectionReportUiState,
} from '@portal/core/ui-policy/inspection-report-ui-policy';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { SerialInspectionReactiveFormComponent } from '@portal/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component';
import {
  TemplateFormDefinition,
  definitionToFormSchema,
} from '@portal/features/templates/schemas/definition-to-form-schema';
import { SectionSchema } from '@portal/features/templates/schemas/drill-pipe-v1.schema';
import { InspectionReportHeaderComponent } from './sections/inspection-report-header/inspection-report-header.component';
import { InspectionReportHeaderFieldsComponent } from './sections/inspection-report-header-fields/inspection-report-header-fields.component';
import { InspectionReportHeaderEditComponent } from './sections/inspection-report-header-fields/inspection-report-header-edit.component';
import { InspectionReportBannersComponent } from './sections/inspection-report-banners/inspection-report-banners.component';
import { InspectionReportTransitionActionComponent } from './sections/inspection-report-transition-bar/inspection-report-transition-bar.component';
import { InspectionReportKpiOverviewComponent } from './sections/inspection-report-kpi-overview/inspection-report-kpi-overview.component';
import { InspectionReportReworkStatusComponent } from './sections/inspection-report-rework-status/inspection-report-rework-status.component';
import { InspectionReportAddSerialPanelComponent } from './sections/inspection-report-add-serial-panel/inspection-report-add-serial-panel.component';
import { InspectionReportApprovalBatchesComponent } from './sections/inspection-report-approval-batches/inspection-report-approval-batches.component';
import { InspectionReportTransitionHistoryComponent } from './sections/inspection-report-transition-history/inspection-report-transition-history.component';
import { InspectionReportSerialsTableComponent } from './sections/inspection-report-serials-table/inspection-report-serials-table.component';

@Component({
  selector: 'app-inspection-report-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    SerialInspectionReactiveFormComponent,
    InspectionReportHeaderComponent,
    InspectionReportBannersComponent,
    InspectionReportTransitionActionComponent,
    InspectionReportKpiOverviewComponent,
    InspectionReportReworkStatusComponent,
    InspectionReportAddSerialPanelComponent,
    InspectionReportApprovalBatchesComponent,
    InspectionReportTransitionHistoryComponent,
    InspectionReportSerialsTableComponent,
    InspectionReportHeaderFieldsComponent,
    InspectionReportHeaderEditComponent,
  ],
  templateUrl: './inspection-report-detail.component.html',
})
export class InspectionReportDetailComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  private route = inject(ActivatedRoute);
  private irService = inject(InspectionReportsService);
  private crService = inject(ChildReportsService);
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private validationService = inject(ReportValidationService);
  private outboxRepo = inject(OutboxLocalRepo);
  private connectivity = inject(ConnectivityService);
  private userRepo = inject(UserLocalRepo);
  private customerRepo = inject(CustomerLocalRepo);
  private approvalBatchRepo = inject(ApprovalBatchLocalRepo);
  private batchSnRepo = inject(BatchSerialNumberLocalRepo);
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);
  public prefs = inject(UserPreferencesService);

  // Focusable validation error-summary target (moved focus after a failed transition).
  @ViewChild('validationSummary') validationSummaryRef?: ElementRef<HTMLElement>;

  public reportId = '';
  public report = signal<LocalInspectionReport | null>(null);

  /**
   * Typed accessor for the inspection form's `[definition]` binding. The stored
   * `definitionJson` is `unknown | null` on LocalInspectionReport; the form input is
   * `TemplateFormDefinition | null`. Cast here rather than widening the input, keeping
   * the input's type honest. Null (pre-cutover) → the form's legacy hardcoded schema.
   */
  public get reportDefinition(): TemplateFormDefinition | null {
    return (this.report()?.definitionJson ?? null) as TemplateFormDefinition | null;
  }

  /**
   * The report's item-scope form sections, built from the template definition by the
   * SAME adapter the serial drawer form consumes (`definitionToFormSchema`, default
   * item scope). Drives the serials matrix's group bands, column headers, and cells —
   * so the table and the drawer form agree by construction, for ANY template. A
   * `computed` so the reference is stable across change-detection and only rebuilds
   * when `report()` changes. No/malformed definition → `[]` (identity columns only).
   */
  public itemFormSections = computed<SectionSchema[]>(() => {
    const def = this.reportDefinition;
    if (!def) return [];
    try {
      return definitionToFormSchema(def).sections;
    } catch {
      return [];
    }
  });

  /**
   * The effective header view — the report row with its generic `headerData`
   * overlaid on the legacy named columns (headerData wins), mirroring the
   * export-time snapshot overlay (`assembleSnapshotHeader`). Both the read-only and
   * edit header components read header-scope VALUES by field key from this, so a
   * generic edit shows through immediately after refresh. Phase D step 2.
   *
   * A `computed` (not a getter) so the reference is STABLE across change-detection
   * cycles and only changes when `report()` does. The edit component rebuilds its
   * reactive form whenever its `[data]` input reference changes; a fresh object per
   * CD would wipe in-progress keystrokes, so a stable ref is load-bearing.
   */
  public reportHeaderView = computed<Record<string, unknown>>(() => {
    const r = this.report();
    if (!r) return {};
    const generic =
      r.headerData && typeof r.headerData === 'object'
        ? (r.headerData as Record<string, unknown>)
        : {};
    return { ...(r as unknown as Record<string, unknown>), ...generic };
  });
  public serials = signal<LocalSerialNumber[]>([]);
  public transitionLogs = signal<LocalTransitionLog[]>([]);
  public enrichedTransitionLogs = signal<
    (LocalTransitionLog & { userName?: string })[]
  >([]);
  public childReports = signal<LocalChildReport[]>([]);
  public approvalBatches = signal<
    {
      batch: LocalInspectionApprovalBatch;
      serials: (LocalSerialNumber & { batchStatus?: string })[];
      submittedByName?: string;
      reviewedByName?: string;
    }[]
  >([]);

  public formBulkSerials = '';
  public formReason = '';
  public formError = '';
  public editingSnId: string | null = null;
  public editingSnValue = '';
  public activeHistorySn = signal<LocalSerialNumber | null>(null);
  public isPublishingReport = signal(false);
  public isGeneratingChildReport = signal(false);

  public selectedForApproval = signal<Set<string>>(new Set());
  public selectedInBatch = signal<Set<string>>(new Set());
  public isSubmittingBatch = false;

  public activeActionBatchId = signal<string | null>(null);
  public returnNotes = '';
  public isActioningBatch = false;

  // Expose constants to template
  public readonly APP_ROLES = APP_ROLES;
  public readonly REPORT_STATUSES = REPORT_STATUSES;
  public readonly SERIAL_DISPOSITIONS = SERIAL_DISPOSITIONS;
  public readonly CHILD_REPORT_TYPES = CHILD_REPORT_TYPES;
  public readonly BATCH_STATUSES = BATCH_STATUSES;
  public readonly SERIAL_STATUSES = SERIAL_STATUSES;
  public readonly SYNC_STATES = SYNC_STATES;
  public batchError = '';
  public activeTab = signal<
    'summary' | 'serials' | 'approvals' | 'specs' | 'history'
  >('summary');
  public isMobileTabletViewport = signal(window.innerWidth < 1024);
  public headerPastThreshold = signal(false);
  public headerCondenseProgress = signal(0);
  public shellScrollbarWidth = signal(0);
  public isHeaderCondensed = computed(
    () => this.isMobileTabletViewport() && this.headerPastThreshold(),
  );

  private shellScrollEl: HTMLElement | null = null;
  private readonly onShellScrollBound = () => this.onShellScroll();

  public isCompactMode = computed(() => this.prefs.preferences().compactMode);
  public hasSubmittedBatches = computed(() => {
    return this.approvalBatches().length > 0;
  });
  public hasPendingApprovals = computed(() => {
    return this.approvalBatches().some(
      (batch) => batch.batch.status === BATCH_STATUSES.SUBMITTED,
    );
  });
  public allBatchesApproved = computed(() => {
    const batches = this.approvalBatches();
    return (
      batches.length > 0 &&
      batches.every((batch) => batch.batch.status === BATCH_STATUSES.APPROVED)
    );
  });
  public hasReworkChildReport = computed(() =>
    this.childReports().some(
      (report) => report.type === CHILD_REPORT_TYPES.REWORK,
    ),
  );

  // Static tab attention badges (no animation). Same conditions the old pulse used,
  // minus any persisted per-tab dismissal (localStorage pulse prefs are no longer read).
  public serialsUninspectedCount = computed(
    () =>
      this.serials().filter(
        (sn) => sn.approvalStatus === SERIAL_STATUSES.NOT_INSPECTED,
      ).length,
  );
  public pendingApprovalCount = computed(
    () =>
      this.approvalBatches().filter(
        (batch) => batch.batch.status === BATCH_STATUSES.SUBMITTED,
      ).length,
  );

  // Search Filter Signals
  public snSearchQuery = signal('');
  public filteredSerials = computed(() => {
    const query = this.snSearchQuery().trim().toLowerCase();
    const serials = this.serials();
    const baseList = !query
      ? serials
      : serials.filter((sn) => sn.value.toLowerCase().includes(query));

    // Sort by value (serial number) alphanumeric
    return baseList.sort((a, b) =>
      a.value.localeCompare(b.value, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
  });

  // The standalone global-comment editor's model. The rest of the header-scope
  // `form*` scaffold (grade/nomWT/equipment/…) was retired in Phase D step 2 —
  // header editing is now the generic definition-driven `header-edit` component
  // writing a single `headerData` map (see `onSaveHeader`).
  public formGlobalComment = '';

  public isEditingMeta = signal<boolean>(false);
  public isEditingGlobalComment = signal<boolean>(false);
  // Restored workflow modal — a signal (not the old plain field) so a reopen after an
  // await re-renders under zoneless change detection.
  public isWorkflowModalOpen = signal<boolean>(false);

  ngAfterViewInit(): void {
    this.setupShellScrollTracking();
  }

  ngOnDestroy(): void {
    if (this.shellScrollEl) {
      this.shellScrollEl.removeEventListener('scroll', this.onShellScrollBound);
    }
  }

  @HostListener('window:resize')
  public onViewportResize(): void {
    const isMobileTablet = window.innerWidth < 1024;
    this.isMobileTabletViewport.set(isMobileTablet);

    if (!isMobileTablet) {
      this.headerPastThreshold.set(false);
      return;
    }

    this.onShellScroll();
  }

  private setupShellScrollTracking(): void {
    if (this.shellScrollEl) {
      this.shellScrollEl.removeEventListener('scroll', this.onShellScrollBound);
    }

    this.shellScrollEl = document.getElementById('main-content');
    if (!this.shellScrollEl) {
      return;
    }

    this.shellScrollEl.addEventListener('scroll', this.onShellScrollBound, {
      passive: true,
    });
    this.onShellScroll();
  }

  private onShellScroll(): void {
    if (!this.isMobileTabletViewport() || !this.shellScrollEl) {
      this.headerPastThreshold.set(false);
      this.headerCondenseProgress.set(0);
      return;
    }

    const scrollTop = this.shellScrollEl.scrollTop;
    // We delay the condense start until we actually hit the top of the viewport
    // On mobile, padding offset is ~40px. On tablet, ~56px.
    const start =
      this.isMobileTabletViewport() && window.innerWidth < 640 ? 40 : 56;
    const end = start + 50;
    const ratio = Math.max(0, Math.min(1, (scrollTop - start) / (end - start)));

    this.headerCondenseProgress.set(ratio);

    if (!this.headerPastThreshold() && scrollTop > start) {
      this.headerPastThreshold.set(true);
    } else if (this.headerPastThreshold() && scrollTop <= start - 10) {
      this.headerPastThreshold.set(false);
    }

    const scrollbarWidth = Math.max(
      0,
      this.shellScrollEl.offsetWidth - this.shellScrollEl.clientWidth,
    );
    this.shellScrollbarWidth.set(scrollbarWidth);
  }

  // The hardcoded drill-pipe METHOD_OPTIONS / EQUIPMENT_OPTIONS dropdown lists were
  // retired in Phase D step 2 with the `saveMeta` scaffold — the generic header
  // edit uses free-text `{ name, number }` rows (no per-template option lists).

  public uiState: InspectionReportUiState | null = null;
  public userRole = computed(
    () => (this.session.profile()?.role?.toUpperCase() as AppRole) || '',
  );
  public allowedTransitions: {
    toStatus: string;
    requiresReason: boolean;
    enabled: boolean;
    label?: string;
    disabledReason?: string;
  }[] = [];
  public selectedTransition: {
    toStatus: string;
    requiresReason: boolean;
    label?: string;
  } | null = null;

  public validationResult: ValidationResult | null = null;
  public reworkSerials: {
    sn: LocalSerialNumber;
    childLinked: LocalChildReport | null;
  }[] = [];

  // KPIs
  public kpiTotal = 0;
  public kpiPassed = 0;
  public kpiRework = 0;
  public kpiScrap = 0;
  public kpiHold = 0;
  public kpiPassRate = 0;

  public isInspectorCapable = computed(() => {
    const role = this.userRole().toUpperCase();
    return (
      role === APP_ROLES.INSPECTOR ||
      role === APP_ROLES.SUPERVISOR ||
      role === APP_ROLES.ADMIN
    );
  });

  public canSubmitBatch = computed(() => {
    const role = this.userRole().toUpperCase();
    return role === APP_ROLES.INSPECTOR || role === APP_ROLES.ADMIN;
  });

  public inspectionProgress = computed(() => {
    const sns = this.serials();
    if (!sns || sns.length === 0) return { approved: 0, total: 0, percent: 0 };
    const approved = sns.filter(
      (sn) => sn.approvalStatus === SERIAL_STATUSES.APPROVED,
    ).length;
    return {
      approved,
      total: sns.length,
      percent: Math.round((approved / sns.length) * 100),
    };
  });

  public inspectedByName = 'N/A';
  public approvedByName = 'N/A';
  public customerAddress = 'N/A';

  // Modal State
  public activeModalStatus = signal<
    (typeof SERIAL_DISPOSITIONS)[keyof typeof SERIAL_DISPOSITIONS] | null
  >(null);
  public modalEquipmentList: LocalSerialNumber[] = [];

  public inspectingSn = signal<LocalSerialNumber | null>(null);
  public inspectionFormData: Record<string, unknown> = {};
  /** Save-in-flight for the SN drawer → drives the Save button's busy state. */
  public isSavingInspection = signal(false);
  /** Save error surfaced INSIDE the drawer (not the hidden workflow panel). */
  public inspectionSaveError = signal('');

  public isExporting = false;
  public isCustomer = computed(
    () => this.userRole().toUpperCase() === APP_ROLES.CUSTOMER,
  );
  public isReceiver = computed(
    () => this.userRole().toUpperCase() === APP_ROLES.RECEIVER,
  );
  public isSupervisor = computed(
    () => this.userRole().toUpperCase() === APP_ROLES.SUPERVISOR,
  );
  public canAccessBatchApprovals = computed(() => {
    const role = this.userRole().toUpperCase();
    return (
      role === APP_ROLES.INSPECTOR ||
      role === APP_ROLES.SUPERVISOR ||
      role === APP_ROLES.ADMIN
    );
  });
  public isAdmin = computed(
    () => this.userRole().toUpperCase() === APP_ROLES.ADMIN,
  );
  public isLocked = computed(() => {
    const report = this.report();
    if (!report) return false;
    return (
      report.status === REPORT_STATUSES.APPROVED ||
      report.status === REPORT_STATUSES.CLOSED
    );
  });

  public isTransitionExpanded = true;

  public canPublishReport = computed(() => {
    const role = this.userRole().toUpperCase();
    const isSuperOrAdmin =
      role === APP_ROLES.SUPERVISOR || role === APP_ROLES.ADMIN;
    const currentStatus = this.report()?.status;
    const serials = this.serials();

    const hasSerials = serials && serials.length > 0;
    const allSerialsApproved =
      hasSerials &&
      serials.every((sn) => sn.approvalStatus === SERIAL_STATUSES.APPROVED);

    return (
      isSuperOrAdmin &&
      allSerialsApproved &&
      currentStatus !== REPORT_STATUSES.APPROVED &&
      currentStatus !== REPORT_STATUSES.CLOSED
    );
  });

  public historyNotes = computed(() => {
    const sn = this.activeHistorySn();
    if (!sn) return [];

    return this.approvalBatches()
      .filter((b) => b.batch.notes && b.serials.some((s) => s.id === sn.id))
      .map((b) => ({
        notes: b.batch.notes,
        date: b.batch.submittedAt,
        user: b.submittedByName,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  public historySerialIds = computed(() => {
    const ids = new Set<string>();

    for (const batch of this.approvalBatches()) {
      if (
        batch.batch.status !== BATCH_STATUSES.RETURNED ||
        !batch.batch.notes
      ) {
        continue;
      }

      for (const serial of batch.serials) {
        ids.add(serial.id);
      }
    }

    return ids;
  });

  public get isOnline(): boolean {
    return this.connectivity.isOnline();
  }

  public getDisposition(sn: LocalSerialNumber): string | null {
    if (!sn.inspectionJson) return null;
    const bodySection = sn.inspectionJson['body'] as
      | Record<string, unknown>
      | undefined;
    return (bodySection?.['emiResult'] as string) || null;
  }

  async ngOnInit() {
    this.reportId = this.route.snapshot.paramMap.get('id') || '';
    if (this.reportId && this.reportId !== 'reports') {
      this.refreshData();

      toObservable(this.irService.reports, {
        injector: this.injector,
      }).subscribe(() => {
        this.refreshData();
      });

      this.crService.changes$.subscribe(() => {
        this.refreshData();
      });

      if (
        !this.reportId.startsWith('local-ir-') &&
        this.reportId !== 'create'
      ) {
        await this.irService.refreshAvailableTransitions(this.reportId);
        await this.irService.refreshTransitionLogs(this.reportId);
        if (this.canAccessBatchApprovals()) {
          await this.irService.pullBatchesForReport(this.reportId);
        }
        await this.crService.pullForInspectionFromServer(this.reportId);
      }
    }
  }

  private async refreshData() {
    // 1. Fetch all data asynchronously without mutating component state yet
    const list = await this.irService.irRepo.list();
    const r =
      list.find((x: LocalInspectionReport) => x.id === this.reportId) || null;

    const snList = await this.irService.getSnForReport(this.reportId);
    const logs = await this.irService.getTransitionLogsLocally(this.reportId);

    // Enrich logs with user names
    const enrichedLogs = [];
    for (const log of logs) {
      let userName = 'Unknown';
      if (log.userId) {
        const u = await this.userRepo.getById(log.userId);
        if (u) userName = u.name || u.email;
      }
      enrichedLogs.push({ ...log, userName });
    }
    // Sort by timestamp desc for timeline feel (newest first)
    enrichedLogs.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const childReports = await this.crService.getChildReportsForInspection(
      this.reportId,
    );

    // Load batches
    const batches = await this.approvalBatchRepo.listByReportId(this.reportId);
    const enrichedBatches = [];
    for (const batch of batches) {
      const bsnList = await this.batchSnRepo.listByBatchId(batch.id);
      const snMap = new Map(
        bsnList.map((b) => [b.serialNumberId, b.status || 'PENDING']),
      );
      const batchSerials = snList
        .filter((sn) => snMap.has(sn.id))
        .map((sn) => ({
          ...sn,
          batchStatus: snMap.get(sn.id),
        }));

      let submittedByName = 'Unknown';
      if (batch.submittedByUserId) {
        const u = await this.userRepo.getById(batch.submittedByUserId);
        if (u) submittedByName = u.name || u.email;
      }

      let reviewedByName = 'Unknown';
      if (batch.reviewedByUserId) {
        const reviewer = await this.userRepo.getById(batch.reviewedByUserId);
        if (reviewer) {
          reviewedByName = reviewer.name || reviewer.email;
        }
      }

      enrichedBatches.push({
        batch,
        serials: batchSerials,
        submittedByName,
        reviewedByName,
      });
    }
    // Sort batches by submittedAt desc
    enrichedBatches.sort(
      (a, b) =>
        new Date(b.batch.submittedAt).getTime() -
        new Date(a.batch.submittedAt).getTime(),
    );

    let vResult = null;
    let previousStatus: string | null = null;
    let onHoldReason: string | null = null;
    let newUiState = null;
    let newCustomerAddress = 'N/A';
    let newInspectedByName = 'N/A';
    let newApprovedByName = 'N/A';

    if (r) {
      vResult = this.validationService.validate(r, snList);

      const pending = await this.outboxRepo.getPendingItems();
      const conflicts = await this.outboxRepo.getConflictItems();
      const transitionOutbox = [...pending, ...conflicts].filter(
        (i) =>
          i.entityType === ENTITY_TYPES.INSPECTION_REPORT &&
          i.entityId === this.reportId &&
          i.operation === 'TRANSITION' &&
          i.lastError,
      );

      for (const t of transitionOutbox) {
        vResult.issues.push({
          code: 'BACKEND_REJECTION',
          level: 'BLOCKER',
          message: `Server Rejected Transition: ${t.lastError}`,
          scope: 'REPORT',
        });
        vResult.isReady = false;
      }

      if (r.status === REPORT_STATUSES.ON_HOLD && logs.length > 0) {
        const sortedLogs = [...logs].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const toHold = sortedLogs.find(
          (l) => l.toStatus === REPORT_STATUSES.ON_HOLD,
        );
        if (toHold) {
          previousStatus = toHold.fromStatus;
          onHoldReason = toHold.reason || null;
        }
      }

      newUiState = getInspectionReportUiState({
        role: this.userRole() as AppRole,
        reportStatus: r.status as ReportStatus,
        isOffline: !this.isOnline,
        hasValidationIssues: !vResult.isReady,
        syncState: r.syncState as SyncState,
        previousStatus: previousStatus,
        onHoldReason: onHoldReason,
        version: r.version,
      });

      // Meta Card Calcs
      if (r.customerId) {
        const cust = await this.customerRepo.getById(r.customerId);
        if (cust) {
          const parts = [
            cust.addressLine1,
            cust.addressLine2,
            cust.city,
            cust.country,
          ].filter((x) => x && x.trim().length > 0);
          newCustomerAddress = parts.length > 0 ? parts.join(', ') : 'N/A';
        }
      }

      if (logs.length > 0) {
        const sortedAsc = [...logs].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        // Inspected By: Last user who transitioning to IN_INSPECTION or PENDING_APPROVAL
        const inspectLog = [...sortedAsc]
          .reverse()
          .find(
            (l) =>
              l.toStatus === REPORT_STATUSES.IN_INSPECTION ||
              l.toStatus === REPORT_STATUSES.PENDING_APPROVAL,
          );
        if (inspectLog && inspectLog.userId) {
          const u = await this.userRepo.getById(inspectLog.userId);
          newInspectedByName = u?.name || u?.email || 'N/A';
        }

        // Approved By: Last user who transitioned to APPROVED
        const approveLog = [...sortedAsc]
          .reverse()
          .find(
            (l) =>
              l.toStatus === REPORT_STATUSES.APPROVED ||
              l.toStatus === REPORT_STATUSES.CLOSED,
          );
        if (approveLog && approveLog.userId) {
          const u = await this.userRepo.getById(approveLog.userId);
          newApprovedByName = u?.name || u?.email || 'N/A';
        } else {
          const latestApprovedBatch = enrichedBatches
            .filter((b) => b.batch.status === BATCH_STATUSES.APPROVED)
            .sort(
              (a, b) =>
                new Date(b.batch.reviewedAt || b.batch.submittedAt).getTime() -
                new Date(a.batch.reviewedAt || a.batch.submittedAt).getTime(),
            )[0];

          if (latestApprovedBatch?.reviewedByName) {
            newApprovedByName = latestApprovedBatch.reviewedByName;
          }
        }
      }
    }

    // KPI Calcs
    const total = snList.length;
    let pass = 0;
    let rework = 0;
    let scrap = 0;
    let hold = 0;

    const reworkList: {
      sn: LocalSerialNumber;
      childLinked: LocalChildReport | null;
    }[] = [];

    for (const sn of snList) {
      const rawDisp = this.getDisposition(sn);
      const disp = rawDisp ? rawDisp.toUpperCase() : null;

      if (disp === SERIAL_DISPOSITIONS.PASS) pass++;
      else if (disp === SERIAL_DISPOSITIONS.REWORK) {
        rework++;
        const child =
          childReports.find((cr) => cr.type === CHILD_REPORT_TYPES.REWORK) ||
          null;
        reworkList.push({ sn, childLinked: child });
      } else if (disp === SERIAL_DISPOSITIONS.SCRAP) scrap++;
      else if (disp === SERIAL_DISPOSITIONS.HOLD) hold++;
    }

    // --- APPLY ALL STATE SYNCHRONOUSLY AT THE END ---
    this.report.set(r);
    this.serials.set(snList);
    this.transitionLogs.set(logs);
    this.enrichedTransitionLogs.set(enrichedLogs);
    this.childReports.set(childReports);
    this.approvalBatches.set(enrichedBatches);

    if (r) {
      this.validationResult = vResult;
      this.uiState = newUiState;
      this.allowedTransitions = newUiState ? newUiState.transitionChoices : [];
      this.customerAddress = newCustomerAddress;
      this.inspectedByName = newInspectedByName;
      this.approvedByName = newApprovedByName;
      this.reworkSerials = reworkList;

      // Set default tab if not set
      if (this.activeTab() === 'summary') {
        const hasRedirectedTab = sessionStorage.getItem('hasRedirectedTab');

        if (!hasRedirectedTab) {
          const role = this.userRole().toUpperCase();
          if (role === APP_ROLES.INSPECTOR) {
            this.activeTab.set('serials');
            sessionStorage.setItem('hasRedirectedTab', 'true');
          } else if (role === APP_ROLES.SUPERVISOR) {
            this.activeTab.set(
              this.hasPendingApprovals() ? 'approvals' : 'serials',
            );
            sessionStorage.setItem('hasRedirectedTab', 'true');
          }
        }
      }

      this.kpiTotal = total;
      this.kpiPassed = pass;
      this.kpiRework = rework;
      this.kpiScrap = scrap;
      this.kpiHold = hold;
      this.kpiPassRate = total > 0 ? Math.round((pass / total) * 100) : 0;

      // Header-scope fields are no longer hydrated into a `form*` scaffold — the
      // generic header-edit component seeds itself from `[data]` (the header view).
      // Only the standalone global-comment editor keeps a model here, read from the
      // generic `headerData` store (the sole header source after step 3) so a Specs
      // edit of the comment shows through.
      if (!this.isEditingGlobalComment()) {
        const generic =
          r.headerData && typeof r.headerData === 'object'
            ? (r.headerData as Record<string, unknown>)
            : {};
        this.formGlobalComment =
          typeof generic['inspectorComment'] === 'string'
            ? (generic['inspectorComment'] as string)
            : '';
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
    }

    setTimeout(() => this.setupShellScrollTracking(), 0);
  }

  public async onAddSerials() {
    this.formError = '';
    const rawLines = this.formBulkSerials
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (rawLines.length === 0) return;

    const lines = rawLines.map((l) => l.trim());
    const uniqueLines = [...new Set(lines)];
    if (uniqueLines.length !== lines.length) {
      this.formError = 'Duplicate serial numbers found in the input list.';
      return;
    }

    const existingSns = this.serials();
    const existingVals = new Set(existingSns.map((s) => s.value.toLowerCase()));
    const duplicates = uniqueLines.filter((l) =>
      existingVals.has(l.toLowerCase()),
    );

    if (duplicates.length > 0) {
      this.formError = `These serial numbers already exist in this report: ${duplicates.join(', ')}`;
      return;
    }

    try {
      await this.irService.addSerialNumbers(this.reportId, uniqueLines);
      this.formBulkSerials = '';
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to add serials.';
    }
  }

  public openReasonSelect(transition: {
    toStatus: string;
    requiresReason: boolean;
  }): void {
    this.selectedTransition = transition;
    this.formReason = '';
    this.formError = '';
  }

  public async onTransition() {
    this.formError = '';
    if (!this.selectedTransition) return;

    try {
      await this.irService.transitionReport(
        this.reportId,
        this.selectedTransition.toStatus,
        this.formReason,
      );
      this.selectedTransition = null;
      this.formReason = '';
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to transition report.';
      // Skill: Focusable Error Summary — move focus to the validation summary so
      // keyboard/screen-reader users land on why the transition was rejected.
      this.focusValidationSummary();
    }
  }

  /** Move focus to the role="alert" validation summary if it is currently rendered. */
  private focusValidationSummary(): void {
    setTimeout(() => this.validationSummaryRef?.nativeElement?.focus(), 0);
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

    const existingSns = this.serials();
    const duplicateExists = existingSns.some(
      (s) => s.id !== sn.id && s.value.toLowerCase() === newValue.toLowerCase(),
    );
    if (duplicateExists) {
      this.formError = `Serial number '${newValue}' already exists in this report.`;
      return;
    }

    try {
      await this.irService.renameSerialNumber(sn.id, newValue);
      this.cancelEditSn();
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to rename serial number.';
    }
  }

  public async onDeleteSn(sn: LocalSerialNumber): Promise<void> {
    if (
      !confirm(
        `Are you sure you want to delete ${sn.value}? This cannot be undone.`,
      )
    )
      return;

    try {
      await this.irService.deleteSerialNumber(sn.id);
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to delete serial number.';
    }
  }

  public openInspectionForm(sn: LocalSerialNumber): void {
    this.inspectingSn.set(sn);
    this.inspectionSaveError.set('');
    this.inspectionFormData = sn.inspectionJson
      ? JSON.parse(JSON.stringify(sn.inspectionJson))
      : {};

    this.formError = '';
    this.isTransitionExpanded = false; // Auto-collapse transition bar to save screen space
  }

  public closeInspectionForm(): void {
    this.inspectingSn.set(null);
    this.inspectionFormData = {};
    this.inspectionSaveError.set('');
    this.isTransitionExpanded = true; // Auto-expand when done
  }

  public goToNextSn(): void {
    const snList = this.serials();
    const currentSn = this.inspectingSn();
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    if (index >= 0 && index < snList.length - 1) {
      const next = snList[index + 1];
      if (next) this.openInspectionForm(next);
    }
  }

  public goToPrevSn(): void {
    const snList = this.serials();
    const currentSn = this.inspectingSn();
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    if (index > 0) {
      const prev = snList[index - 1];
      if (prev) this.openInspectionForm(prev);
    }
  }

  public get hasNextSn(): boolean {
    const snList = this.serials();
    const currentSn = this.inspectingSn();
    if (!currentSn) return false;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    return index >= 0 && index < snList.length - 1;
  }

  public get hasPrevSn(): boolean {
    const snList = this.serials();
    const currentSn = this.inspectingSn();
    if (!currentSn) return false;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    return index > 0;
  }

  public async saveInspectionForm(
    inspectionData: Record<string, unknown>,
  ): Promise<void> {
    const currentSn = this.inspectingSn();
    if (!currentSn) return;

    this.inspectionSaveError.set('');
    this.isSavingInspection.set(true);
    try {
      await this.irService.saveSerialNumberInspection(
        currentSn.id,
        inspectionData as Record<string, unknown>,
      );

      await this.refreshData();
      this.closeInspectionForm();
    } catch (error) {
      const e = error as Error;
      // Surface inside the drawer where the user is looking (the shared `formError`
      // renders only on the workflow-actions panel, hidden behind the drawer).
      this.inspectionSaveError.set(e.message || 'Failed to save inspection data.');
    } finally {
      this.isSavingInspection.set(false);
    }
  }

  /**
   * Persist a generic header edit. The header-edit component emits ONE
   * definition-keyed map (fieldKey -> value); it is written to the report's
   * generic `headerData` store via the existing report-update path (same offline
   * outbox), never per-named-column. On export the engine reads header fields off
   * this map (overlaid on the legacy columns). The map is the FULL header slice, so
   * the offline cache's shallow `{ ...rep, ...updates }` correctly replaces it.
   */
  public async onSaveHeader(
    headerData: Record<string, unknown>,
  ): Promise<void> {
    this.formError = '';
    try {
      await this.irService.saveReportUpdates(this.reportId, { headerData });
      this.isEditingMeta.set(false);
      await this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to save details.';
    }
  }

  /** The effective inspector comment, read from the generic headerData store. */
  private effectiveInspectorComment(): string {
    const r = this.report();
    const generic =
      r?.headerData && typeof r.headerData === 'object'
        ? (r.headerData as Record<string, unknown>)
        : {};
    return typeof generic['inspectorComment'] === 'string'
      ? (generic['inspectorComment'] as string)
      : '';
  }

  public startEditingGlobalComment(): void {
    this.formGlobalComment = this.effectiveInspectorComment();
    this.isEditingGlobalComment.set(true);
  }

  public cancelEditingGlobalComment(): void {
    this.formGlobalComment = this.effectiveInspectorComment();
    this.isEditingGlobalComment.set(false);
  }

  public async saveGlobalComment(): Promise<void> {
    this.formError = '';
    try {
      // Write through the generic header store too (merged full map), so the
      // comment lands on the SAME axis the Specs edit uses — no column-vs-headerData
      // masking. Named columns are retired in step 3.
      const r = this.report();
      const merged: Record<string, unknown> = {
        ...(r?.headerData && typeof r.headerData === 'object'
          ? (r.headerData as Record<string, unknown>)
          : {}),
        inspectorComment: this.formGlobalComment,
      };
      await this.irService.saveReportUpdates(this.reportId, {
        headerData: merged,
      });
      this.isEditingGlobalComment.set(false);
      await this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to save global comment.';
    }
  }

  public async exportReport(): Promise<void> {
    if (!this.isOnline) {
      this.formError = 'Export requires internet connection.';
      return;
    }

    this.isExporting = true;
    this.formError = '';

    try {
      const observer = this.http.get(
        `${environment.apiUrl}/inspection-reports/${this.reportId}/export`,
        {
          responseType: 'blob',
          observe: 'response',
        },
      );

      const response = await new Promise<HttpResponse<Blob>>(
        (resolve, reject) => {
          observer.subscribe({
            next: (res) => resolve(res as HttpResponse<Blob>),
            error: (err) => reject(err as HttpErrorResponse),
          });
        },
      );

      const blob = response.body;
      if (!blob) throw new Error('No blob data received');
      const contentDisposition = response.headers.get('Content-Disposition');

      let filename = '';
      if (contentDisposition) {
        const parts = contentDisposition.split(';');
        const filenameStar = parts.find((p: string) =>
          p.trim().startsWith('filename*='),
        );
        const filenameNormal = parts.find((p: string) =>
          p.trim().startsWith('filename='),
        );

        if (filenameStar) {
          // String() preserves the prior implicit coercion: a header lacking the
          // RFC-5987 "''" delimiter yielded the literal string "undefined" here.
          filename = decodeURIComponent(String(filenameStar.split("''")[1]));
        } else if (filenameNormal) {
          // startsWith('filename=') guarantees split('=')[1] exists; ?? '' only
          // satisfies the compiler and never triggers at runtime.
          filename = (filenameNormal.split('=')[1] ?? '').replace(/["']/g, '');
        }
      }

      if (!filename) {
        const ext = blob.type === 'application/zip' ? '.zip' : '.xlsx';
        const currentReport = this.report();
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
        this.formError =
          'Report mapping validation failed or template mismatch.';
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

  public openKpiModal(
    status: (typeof SERIAL_DISPOSITIONS)[keyof typeof SERIAL_DISPOSITIONS],
  ): void {
    this.activeModalStatus.set(status);
    this.modalEquipmentList = this.serials().filter(
      (sn) => this.getDisposition(sn) === status,
    );
  }

  public closeKpiModal(): void {
    this.activeModalStatus.set(null);
    this.modalEquipmentList = [];
  }

  public get isAllEligibleSelected(): boolean {
    const eligible = this.filteredSerials().filter(
      (sn) => sn.approvalStatus === SERIAL_STATUSES.INSPECTED_DRAFT,
    );
    if (eligible.length === 0) return false;
    const selected = this.selectedForApproval();
    return eligible.every((sn) => selected.has(sn.id));
  }

  public toggleAllEligible(): void {
    const eligible = this.filteredSerials().filter(
      (sn) => sn.approvalStatus === SERIAL_STATUSES.INSPECTED_DRAFT,
    );
    if (eligible.length === 0) return;

    if (this.isAllEligibleSelected) {
      this.selectedForApproval.set(new Set());
    } else {
      const newSet = new Set<string>();
      eligible.forEach((sn) => newSet.add(sn.id));
      this.selectedForApproval.set(newSet);
    }
  }

  public toggleSelection(sn: LocalSerialNumber): void {
    if (sn.approvalStatus !== SERIAL_STATUSES.INSPECTED_DRAFT) return;
    const current = new Set(this.selectedForApproval());
    if (current.has(sn.id)) {
      current.delete(sn.id);
    } else {
      current.add(sn.id);
    }
    this.selectedForApproval.set(current);
  }

  public async submitSelectedForApproval(): Promise<void> {
    if (!this.canSubmitBatch()) return;
    const selectedIds = Array.from(this.selectedForApproval());
    if (selectedIds.length === 0) return;

    this.isSubmittingBatch = true;
    this.formError = '';

    try {
      await this.irService.submitApprovalBatch(this.reportId, selectedIds);

      this.selectedForApproval.set(new Set());
      this.refreshData();
    } catch (e) {
      const err = e as Error;
      this.formError = err.message || 'Failed to submit batch for approval.';
    } finally {
      this.isSubmittingBatch = false;
    }
  }

  public openReturnBatchModal(batchId: string): void {
    this.activeActionBatchId.set(batchId);
    // We NO LONGER reset selection here so pre-selected items carry over
    this.returnNotes = '';
    this.batchError = '';
  }

  public closeReturnBatchModal(): void {
    this.activeActionBatchId.set(null);
    this.returnNotes = '';
    this.batchError = '';
  }

  public toggleBatchSnSelection(snId: string) {
    const current = new Set(this.selectedInBatch());
    if (current.has(snId)) {
      current.delete(snId);
    } else {
      current.add(snId);
    }
    this.selectedInBatch.set(current);
  }

  public async approveBatch(batchId: string): Promise<void> {
    const selected = Array.from(this.selectedInBatch());

    // Safety check: ensure selection belongs to this batch
    const batch = this.approvalBatches().find((b) => b.batch.id === batchId);
    if (!batch) return;

    const batchSnIds = batch.serials.map((s) => s.id);
    const filteredSelection = selected.filter((id) => batchSnIds.includes(id));

    // If no selection, we default to all ELIGIBLE serials (those still pending)
    const ids = filteredSelection.length > 0 ? filteredSelection : undefined;

    this.isActioningBatch = true;
    this.batchError = '';
    try {
      await this.irService.approveBatch(batchId, ids);
      this.selectedInBatch.set(new Set());
      await this.refreshData();
    } catch (e) {
      const err = e as Error;
      this.batchError = err.message || 'Failed to approve batch';
    } finally {
      this.isActioningBatch = false;
    }
  }

  public async returnBatch(): Promise<void> {
    const activeBatchId = this.activeActionBatchId();
    if (!activeBatchId) return;
    const selected = Array.from(this.selectedInBatch());

    // Safety check: ensure selection belongs to this batch
    const batch = this.approvalBatches().find(
      (b) => b.batch.id === activeBatchId,
    );
    const batchSnIds = batch?.serials.map((s) => s.id) || [];
    const filteredSelection = selected.filter((id) => batchSnIds.includes(id));

    const ids = filteredSelection.length > 0 ? filteredSelection : undefined;

    this.isActioningBatch = true;
    this.batchError = '';
    try {
      await this.irService.returnBatch(activeBatchId, this.returnNotes, ids);
      this.selectedInBatch.set(new Set());
      this.closeReturnBatchModal();
      await this.refreshData();
    } catch (e) {
      const err = e as Error;
      this.batchError = err.message || 'Failed to return batch';
      this.isActioningBatch = false; // Reset if error so user can retry
    } finally {
      this.isActioningBatch = false;
    }
  }

  public async onPublishReport(): Promise<void> {
    if (!this.canPublishReport() || this.isPublishingReport()) return;

    this.isPublishingReport.set(true);
    this.formError = '';
    try {
      await this.irService.publishReport(this.reportId);
      this.refreshData();
    } catch (e) {
      const err = e as Error;
      this.formError = err.message || 'Failed to publish report.';
    } finally {
      this.isPublishingReport.set(false);
    }
  }

  public async onGenerateReworkChildReport(): Promise<void> {
    if (!this.reportId || this.reportId.startsWith('local-ir-')) {
      this.formError =
        'Child report generation requires a synced inspection report.';
      return;
    }

    this.isGeneratingChildReport.set(true);
    this.formError = '';
    try {
      await this.crService.generateReworkChildReport(this.reportId);
      await this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to generate child report.';
    } finally {
      this.isGeneratingChildReport.set(false);
    }
  }

  public onTabClick(
    tab: 'summary' | 'serials' | 'approvals' | 'specs' | 'history',
  ) {
    this.activeTab.set(tab);
  }

  /** Enter metadata-edit mode and jump to the Specs tab (from the Summary card). */
  public editMetadataFromSummary(): void {
    this.isEditingMeta.set(true);
    this.onTabClick('specs');
  }

  /**
   * Whether a tab should surface a static attention badge. Same role/status/data
   * conditions the old pulse used, minus the persisted per-tab dismissal — the
   * localStorage pulse preferences are intentionally no longer read.
   */
  public tabNeedsAttention(tab: string): boolean {
    const report = this.report();
    if (!report || this.isCustomer()) {
      return false;
    }

    const status = report.status as string;
    const sns = this.serials();
    const hasUninspected =
      sns.length === 0 ||
      sns.some((sn) => sn.approvalStatus === SERIAL_STATUSES.NOT_INSPECTED);

    if (tab === 'approvals') {
      return this.canAccessBatchApprovals() && this.hasPendingApprovals();
    }

    if (tab === 'serials') {
      if (
        (this.isReceiver() || this.isAdmin()) &&
        ['DRAFT', 'RECEIVED', 'READY_FOR_CLEANING'].includes(status)
      ) {
        return true;
      }

      if (
        (this.userRole() === APP_ROLES.INSPECTOR || this.isAdmin()) &&
        (status === REPORT_STATUSES.READY_FOR_INSPECTION ||
          status === REPORT_STATUSES.IN_INSPECTION)
      ) {
        if (hasUninspected) return true;
      }

      if (
        (this.isSupervisor() || this.isAdmin()) &&
        (status === REPORT_STATUSES.IN_INSPECTION ||
          status === REPORT_STATUSES.PENDING_APPROVAL)
      ) {
        if (!this.hasPendingApprovals()) return true;
      }
      return false;
    }

    if (tab === 'summary' || tab === 'specs') {
      if (
        (this.userRole() === APP_ROLES.INSPECTOR || this.isAdmin()) &&
        (status === REPORT_STATUSES.READY_FOR_INSPECTION ||
          status === REPORT_STATUSES.IN_INSPECTION)
      ) {
        if (!hasUninspected && sns.length > 0) {
          return true;
        }
      }
      return false;
    }

    return false;
  }

  public tabTooltip(tab: 'serials' | 'approvals'): string {
    if (tab === 'approvals' && this.tabNeedsAttention('approvals')) {
      return 'Pending approvals require review';
    }

    if (tab === 'serials' && this.tabNeedsAttention('serials')) {
      return 'Inspect pipes and set dispositions';
    }

    return '';
  }

  public openHistory(sn: LocalSerialNumber): void {
    this.activeHistorySn.set(sn);
  }

  public closeHistory(): void {
    this.activeHistorySn.set(null);
  }
}
