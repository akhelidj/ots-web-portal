import {
  Component,
  inject,
  OnInit,
  ChangeDetectorRef,
  signal,
  computed,
  Injector,
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
import { SyncOrchestratorService } from '@portal/core/offline/services/sync-orchestrator.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { SerialInspectionReactiveFormComponent } from '@portal/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component';

@Component({
  selector: 'app-inspection-report-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    SerialInspectionReactiveFormComponent,
  ],
  templateUrl: './inspection-report-detail.component.html',
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
  private connectivity = inject(ConnectivityService);
  private userRepo = inject(UserLocalRepo);
  private customerRepo = inject(CustomerLocalRepo);
  private approvalBatchRepo = inject(ApprovalBatchLocalRepo);
  private batchSnRepo = inject(BatchSerialNumberLocalRepo);
  private cdr = inject(ChangeDetectorRef);
  private injector = inject(Injector);

  public reportId = '';
  public report = signal<LocalInspectionReport | null>(null);
  public serials = signal<LocalSerialNumber[]>([]);
  public transitionLogs = signal<LocalTransitionLog[]>([]);
  public childReports = signal<LocalChildReport[]>([]);
  public approvalBatches = signal<
    {
      batch: LocalInspectionApprovalBatch;
      serials: (LocalSerialNumber & { batchStatus?: string })[];
      submittedByName?: string;
    }[]
  >([]);

  public formBulkSerials = '';
  public formReason = '';
  public formError = '';
  public editingSnId: string | null = null;
  public editingSnValue = '';
  public isValidationModalOpen = false;
  public activeHistorySn = signal<LocalSerialNumber | null>(null);
  public isPublishingReport = signal(false);
  public isSyncingRework = signal(false);

  public selectedForApproval = signal<Set<string>>(new Set());
  public selectedInBatch = signal<Set<string>>(new Set());
  public isSubmittingBatch = false;

  public activeActionBatchId: string | null = null;
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

  // Meta Fields
  public formInspectorComment = '';
  public formInspectionAddress = '';
  public formStandardUsed = '';
  public formEquipmentUsed: Array<{
    name: string;
    number: string;
    isOther: boolean;
  }> = [];
  public formInspectionMethod: Array<{ name: string; isOther: boolean }> = [];

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
  public readonly METHOD_OPTIONS = [
    'Wet',
    'Dry',
    'EAI',
    'UT-EAI',
    'VTI',
    'TGI',
    'Other',
  ];
  public readonly EQUIPMENT_OPTIONS = [
    'UV Light',
    'AC Yoke',
    'DC Coil',
    'EMI Unit',
    'UT-EA',
    'WT',
    'Other',
  ];

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
  public activeModalStatus:
    | (typeof SERIAL_DISPOSITIONS)[keyof typeof SERIAL_DISPOSITIONS]
    | null = null;
  public modalEquipmentList: LocalSerialNumber[] = [];

  public inspectingSn: LocalSerialNumber | null = null;
  public inspectionFormData: Record<string, unknown> = {};

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
    const progress = this.inspectionProgress();
    const isFullyApproved =
      progress.total > 0 && progress.approved === progress.total;
    const currentStatus = this.report()?.status;
    return (
      isSuperOrAdmin &&
      isFullyApproved &&
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
        await this.irService.pullBatchesForReport(this.reportId);
        await this.crService.pullForInspectionFromServer(this.reportId);
      }
    }
  }

  private async refreshData() {
    const list = await this.irService.irRepo.list();
    const r =
      list.find((x: LocalInspectionReport) => x.id === this.reportId) || null;
    this.report.set(r);

    const snList = await this.irService.getSnForReport(this.reportId);
    this.serials.set(snList);

    const logs = await this.irService.getTransitionLogsLocally(this.reportId);
    this.transitionLogs.set(logs);

    const childReports = await this.crService.getChildReportsForInspection(
      this.reportId,
    );
    this.childReports.set(childReports);

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

      enrichedBatches.push({ batch, serials: batchSerials, submittedByName });
    }
    // Sort batches by submittedAt desc
    enrichedBatches.sort(
      (a, b) =>
        new Date(b.batch.submittedAt).getTime() -
        new Date(a.batch.submittedAt).getTime(),
    );
    this.approvalBatches.set(enrichedBatches);

    if (r) {
      const vResult = this.validationService.validate(r, snList);

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
      this.validationResult = vResult;

      let previousStatus: string | null = null;
      let onHoldReason: string | null = null;
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

      this.uiState = getInspectionReportUiState({
        role: this.userRole() as AppRole,
        reportStatus: r.status as ReportStatus,
        isOffline: !this.isOnline,
        hasValidationIssues: !vResult.isReady,
        syncState: r.syncState as SyncState,
        previousStatus: previousStatus,
        onHoldReason: onHoldReason,
        version: r.version,
      });

      this.allowedTransitions = this.uiState.transitionChoices;

      // Meta Card Calcs
      this.customerAddress = 'N/A';
      if (r.customerId) {
        const cust = await this.customerRepo.getById(r.customerId);
        if (cust) {
          const parts = [
            cust.addressLine1,
            cust.addressLine2,
            cust.city,
            cust.country,
          ].filter((x) => x && x.trim().length > 0);
          this.customerAddress = parts.length > 0 ? parts.join(', ') : 'N/A';
        }
      }

      this.inspectedByName = 'N/A';
      this.approvedByName = 'N/A';
      if (logs.length > 0) {
        const sortedAsc = [...logs].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        // Inspected By: Last user who transitioned to IN_INSPECTION or PENDING_APPROVAL
        const inspectLog = [...sortedAsc]
          .reverse()
          .find(
            (l) =>
              l.toStatus === REPORT_STATUSES.IN_INSPECTION ||
              l.toStatus === REPORT_STATUSES.PENDING_APPROVAL,
          );
        if (inspectLog && inspectLog.userId) {
          const u = await this.userRepo.getById(inspectLog.userId);
          this.inspectedByName = u?.name || u?.email || 'N/A';
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
          this.approvedByName = u?.name || u?.email || 'N/A';
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

      this.reworkSerials = reworkList;

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

        const eqList: Array<{ name?: string; number?: string }> = Array.isArray(
          r.equipmentUsed,
        )
          ? (r.equipmentUsed as Array<{ name?: string; number?: string }>)
          : [];
        this.formEquipmentUsed = eqList.map((e) => ({
          name: e.name || '',
          number: e.number || '',
          isOther: !this.EQUIPMENT_OPTIONS.includes(e.name || ''),
        }));

        const methodList: Array<{ name?: string }> = Array.isArray(
          r.inspectionMethod,
        )
          ? (r.inspectionMethod as Array<{ name?: string }>)
          : typeof r.inspectionMethod === 'string'
            ? [{ name: r.inspectionMethod }]
            : [];
        this.formInspectionMethod = methodList.map((m) => {
          const mName = typeof m === 'string' ? m : m.name || '';
          return {
            name: mName,
            isOther: mName !== '' && !this.METHOD_OPTIONS.includes(mName),
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
    }
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
    }
  }

  public async onSyncReworkReport() {
    this.isSyncingRework.set(true);
    try {
      await this.irService.enqueueChildSync(this.reportId);
      await this.syncOrchestrator.syncNow();
      this.refreshData();
      this.isSyncingRework.set(false);
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to sync rework report.';
      this.isSyncingRework.set(false);
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
    this.inspectingSn = sn;
    this.inspectionFormData = sn.inspectionJson
      ? JSON.parse(JSON.stringify(sn.inspectionJson))
      : {};

    this.formError = '';
    this.isTransitionExpanded = false; // Auto-collapse transition bar to save screen space
  }

  public closeInspectionForm(): void {
    this.inspectingSn = null;
    this.inspectionFormData = {};
    this.isTransitionExpanded = true; // Auto-expand when done
  }

  public goToNextSn(): void {
    const snList = this.serials();
    const currentSn = this.inspectingSn;
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    if (index >= 0 && index < snList.length - 1) {
      this.openInspectionForm(snList[index + 1]);
    }
  }

  public goToPrevSn(): void {
    const snList = this.serials();
    const currentSn = this.inspectingSn;
    if (!currentSn || snList.length === 0) return;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    if (index > 0) {
      this.openInspectionForm(snList[index - 1]);
    }
  }

  public get hasNextSn(): boolean {
    const snList = this.serials();
    const currentSn = this.inspectingSn;
    if (!currentSn) return false;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    return index >= 0 && index < snList.length - 1;
  }

  public get hasPrevSn(): boolean {
    const snList = this.serials();
    const currentSn = this.inspectingSn;
    if (!currentSn) return false;
    const index = snList.findIndex((s) => s.id === currentSn.id);
    return index > 0;
  }

  public async saveInspectionForm(
    inspectionData: Record<string, unknown>,
  ): Promise<void> {
    if (!this.inspectingSn) return;

    try {
      await this.irService.saveSerialNumberInspection(
        this.inspectingSn.id,
        inspectionData as Record<string, unknown>,
      );

      this.refreshData();
      this.closeInspectionForm();
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
        .filter((e) => e.name.trim() !== '' || e.number.trim() !== '')
        .map((e) => ({ name: e.name, number: e.number }));

      const cleanMethod = this.formInspectionMethod
        .filter((m) => m.name.trim() !== '')
        .map((m) => ({ name: m.name }));

      await this.irService.saveReportUpdates(this.reportId, {
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
        connection: this.formConnection,
      });
      this.isEditingMeta = false;
      this.refreshData();
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to save details.';
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
          filename = decodeURIComponent(filenameStar.split("''")[1]);
        } else if (filenameNormal) {
          filename = filenameNormal.split('=')[1].replace(/["']/g, '');
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
    this.activeModalStatus = status;
    this.modalEquipmentList = this.serials().filter(
      (sn) => this.getDisposition(sn) === status,
    );
  }

  public closeKpiModal(): void {
    this.activeModalStatus = null;
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
    this.activeActionBatchId = batchId;
    // We NO LONGER reset selection here so pre-selected items carry over
    this.returnNotes = '';
    this.batchError = '';
  }

  public closeReturnBatchModal(): void {
    this.activeActionBatchId = null;
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

  public isBatchSnSelected(snId: string): boolean {
    return this.selectedInBatch().has(snId);
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

  public getBatchEligibleCount(batchId: string): number {
    const batch = this.approvalBatches().find((b) => b.batch.id === batchId);
    if (!batch) return 0;
    return batch.serials.filter((s) => s.batchStatus === 'PENDING').length;
  }

  public async returnBatch(): Promise<void> {
    if (!this.activeActionBatchId) return;
    const selected = Array.from(this.selectedInBatch());

    // Safety check: ensure selection belongs to this batch
    const batch = this.approvalBatches().find(
      (b) => b.batch.id === this.activeActionBatchId,
    );
    const batchSnIds = batch?.serials.map((s) => s.id) || [];
    const filteredSelection = selected.filter((id) => batchSnIds.includes(id));

    const ids = filteredSelection.length > 0 ? filteredSelection : undefined;

    this.isActioningBatch = true;
    this.batchError = '';
    try {
      await this.irService.returnBatch(
        this.activeActionBatchId,
        this.returnNotes,
        ids,
      );
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

    if (
      !confirm(
        'Are you sure you want to publish this report? This will mark it as APPROVED and lock most edits.',
      )
    ) {
      return;
    }

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

  public openHistory(sn: LocalSerialNumber): void {
    this.activeHistorySn.set(sn);
  }

  public closeHistory(): void {
    this.activeHistorySn.set(null);
  }

  public hasHistory(sn: LocalSerialNumber): boolean {
    return this.approvalBatches().some(
      (b) =>
        b.batch.status === BATCH_STATUSES.RETURNED &&
        b.batch.notes &&
        b.serials.some((s) => s.id === sn.id),
    );
  }
}
