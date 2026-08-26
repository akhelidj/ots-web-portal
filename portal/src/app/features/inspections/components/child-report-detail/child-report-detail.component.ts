import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ChildReportsService } from '@portal/features/inspections/services/child-reports.service';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import {
  LocalChildReport,
  LocalInspectionReport,
  LocalInspectionApprovalBatch,
} from '@portal/core/offline/models/types';
import {
  getChildReportUiState,
  ChildReportUiState,
} from '@portal/core/ui-policy/child-report-ui-policy';
import {
  AppRole,
  APP_ROLES,
  CHILD_REPORT_STATUSES,
  ChildReportStatus,
  SERIAL_STATUSES,
} from '@portal/core/constants/app.constants';
import { environment } from '@app-env/environment';
import { SerialInspectionReactiveFormComponent } from '@portal/features/inspections/components/serial-inspection-reactive-form/serial-inspection-reactive-form.component';
import { TemplateFormDefinition } from '@portal/features/templates/schemas/definition-to-form-schema';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

@Component({
  selector: 'app-child-report-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    SerialInspectionReactiveFormComponent,
  ],
  templateUrl: './child-report-detail.component.html',
})
export class ChildReportDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private crService = inject(ChildReportsService);
  private irService = inject(InspectionReportsService);
  private session = inject(SessionService);
  private connectivity = inject(ConnectivityService);
  private batchSnRepo = inject(BatchSerialNumberLocalRepo);
  private userRepo = inject(UserLocalRepo);
  private subscriptions = new Subscription();

  public reportId = '';
  public cr = signal<LocalChildReport | null>(null);

  public headerPastThreshold = signal(false);
  public headerCondenseProgress = signal(0);
  public shellScrollbarWidth = signal(0);
  public isMobileTabletViewport = signal(window.innerWidth < 1024);

  public isHeaderCondensed = computed(
    () => this.isMobileTabletViewport() && this.headerPastThreshold(),
  );

  private shellScrollEl: HTMLElement | null = null;
  private readonly onShellScrollBound = () => this.onShellScroll();

  public parentReport = signal<LocalInspectionReport | null>(null);

  /**
   * Typed accessor for the inspection form's `[definition]` binding. The child form is
   * driven by the PARENT report's template, so its definition source is the parent's
   * `definitionJson` (`unknown | null`), cast to the form input's `TemplateFormDefinition
   * | null` here rather than widening the input. Null (pre-cutover) → legacy schema.
   */
  public get parentDefinition(): TemplateFormDefinition | null {
    return (this.parentReport()?.definitionJson ?? null) as TemplateFormDefinition | null;
  }

  public serials = signal<
    {
      id: string;
      serial: string;
      inspectionData?: Record<string, unknown>;
      disposition?: string;
      approvalStatus?: string;
    }[]
  >([]);

  public activeHistorySn = signal<{ id: string; serial: string } | null>(null);

  public historyNotes = computed(() => {
    const sn = this.activeHistorySn();
    if (!sn) return [];

    return this.batches()
      .filter((b) => b.notes && b.serialIds.includes(sn.id))
      .map((b) => ({
        notes: b.notes,
        date: b.submittedAt,
        user: b.submittedByName,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  public historySerialIds = computed(() => {
    const ids = new Set<string>();

    for (const batch of this.batches()) {
      if (batch.status !== 'RETURNED' || !batch.notes) {
        continue;
      }
      for (const id of batch.serialIds || []) {
        ids.add(id);
      }
    }
    return ids;
  });

  public openHistory(sn: { id: string; serial: string }): void {
    this.activeHistorySn.set(sn);
  }

  public closeHistory(): void {
    this.activeHistorySn.set(null);
  }

  public hasHistory(sn: { id: string; serial: string }): boolean {
    return this.historySerialIds().has(sn.id);
  }
  public batches = signal<
    (LocalInspectionApprovalBatch & {
      serialIds: string[];
      submittedByName: string;
    })[]
  >([]);

  // Drawer state is signal-backed so a serial swap (Prev/Next) drives change
  // detection in this zoneless app and never mutates `inspectionFormData` in place
  // while the drawer's form is mounted (a fresh reference re-runs the form's
  // ngOnChanges → repatch). Mirrors the parent detail's signal discipline.
  public inspectingSnId = signal<string | null>(null);
  public inspectingSnValue = signal('');
  public inspectingSnApprovalStatus = signal('');
  public inspectionFormData = signal<Record<string, unknown>>({});
  /**
   * Drawer save feedback, surfaced INSIDE the drawer (mirrors the parent). Before
   * this, a failed serial save wrote only `formError`, which renders on the hidden
   * workflow modal — so the failure was silent to a user looking at the drawer.
   */
  public isSavingInspection = signal(false);
  public inspectionSaveError = signal('');

  public uiState = signal<ChildReportUiState | null>(null);
  public userRole = signal('');
  public allowedTransitions = signal<
    {
      toStatus: string;
      requiresReason: boolean;
      enabled: boolean;
      label?: string;
      disabledReason?: string;
    }[]
  >([]);
  public selectedTransition = signal<{
    toStatus: string;
    requiresReason: boolean;
    label?: string;
  } | null>(null);
  public formReason = signal('');
  public formError = signal('');

  public notes = signal('');
  public isEditingNotes = signal(false);
  private isRefreshing = false;
  private refreshQueued = false;
  private isDestroyed = false;

  public isUploadingAttachment = signal(false);

  public isWorkflowModalOpen = signal(false);

  public get isOnline(): boolean {
    return this.connectivity.isOnline();
  }

  ngOnInit() {
    const p = this.session.profile();
    if (p) {
      this.userRole.set(p.role || '');
    }

    this.reportId = this.route.snapshot.paramMap.get('id') || '';
    if (this.reportId) {
      this.refreshData();

      // Skip reactive refreshes while a server pull is already in progress
      // to avoid the loop: pullSingleFromServer → crRepo.upsert → changes$ → refreshData loop
      this.subscriptions.add(
        this.crService.changes$.subscribe(() => {
          this.queueRefresh();
        }),
      );
    }

    this.shellScrollEl = document.getElementById('main-content');
    if (this.shellScrollEl) {
      this.shellScrollEl.addEventListener('scroll', this.onShellScrollBound, {
        passive: true,
      });
      this.onShellScroll();
    }
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.subscriptions.unsubscribe();
    if (this.shellScrollEl) {
      this.shellScrollEl.removeEventListener('scroll', this.onShellScrollBound);
    }
  }

  private onShellScroll(): void {
    if (!this.isMobileTabletViewport() || !this.shellScrollEl) {
      this.headerPastThreshold.set(false);
      this.headerCondenseProgress.set(0);
      return;
    }

    const scrollTop = this.shellScrollEl.scrollTop;
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

  private queueRefresh(): void {
    if (this.isRefreshing || this.refreshQueued || this.isDestroyed) {
      return;
    }

    this.refreshQueued = true;
    queueMicrotask(async () => {
      this.refreshQueued = false;
      if (this.isDestroyed || this.isRefreshing) {
        return;
      }

      await this.refreshData();
    });
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

      const cr = (await this.crService['crRepo'].getById(
        this.reportId,
      )) as LocalChildReport | null;
      this.cr.set(cr);

      if (cr) {
        if (!this.isEditingNotes()) {
          this.notes.set(cr.notes || '');
        }

        // Fetch parent report — pull from server if not found locally (private window case)
        let parent = (await this.irService.irRepo.getById(
          cr.inspectionReportId,
        )) as LocalInspectionReport | null;
        if (!parent && this.isOnline) {
          try {
            const serverParent = await firstValueFrom(
              this.http.get<LocalInspectionReport>(
                `${environment.apiUrl}/inspection-reports/${cr.inspectionReportId}`,
              ),
            );
            await this.irService.irRepo.upsert({
              ...serverParent,
              syncState: 'SYNCED',
            });
            parent = serverParent;
          } catch (e) {
            console.error('Failed to fetch parent report from server', e);
          }
        }
        this.parentReport.set(parent);

        this.serials.set(
          (cr.serialNumbers || []).sort((a, b) =>
            a.serial.localeCompare(b.serial, undefined, {
              numeric: true,
              sensitivity: 'base',
            }),
          ),
        );

        const selectable = new Set(this.getSelectableSerialIds());
        const sanitized = new Set(
          Array.from(this.selectedSnIds()).filter((id) => selectable.has(id)),
        );
        if (sanitized.size !== this.selectedSnIds().size) {
          this.selectedSnIds.set(sanitized);
        }

        // Pull batches for this child report (linked via reportId)
        const canAccessBatches =
          this.userRole() === APP_ROLES.INSPECTOR ||
          this.userRole() === APP_ROLES.SUPERVISOR ||
          this.userRole() === APP_ROLES.ADMIN;

        if (this.isOnline && canAccessBatches) {
          await this.irService.pullBatchesForReport(cr.inspectionReportId);
        }
        const allBatches = await this.irService[
          'approvalBatchRepo'
        ].listByReportId(cr.inspectionReportId);

        const childBatches = allBatches.filter(
          (b) => b.childReportId === this.reportId,
        );

        const enrichedBatches = await Promise.all(
          childBatches.map(async (b) => {
            const bsnList = await this.batchSnRepo.listByBatchId(b.id);
            let submittedByName = 'System';
            if (b.submittedByUserId) {
              const u = await this.userRepo.getById(b.submittedByUserId);
              if (u) {
                submittedByName = u.name || u.email || 'System';
              }
            }
            return {
              ...b,
              serialIds: bsnList.map((sn) => sn.serialNumberId),
              submittedByName,
            };
          }),
        );
        this.batches.set(enrichedBatches);

        const uiState = getChildReportUiState({
          role: this.userRole() as AppRole,
          reportStatus: cr.status as ChildReportStatus,
          parentReportStatus: parent?.status || 'UNKNOWN',
          isOffline: !this.isOnline,
          syncState: cr.syncState as 'SYNCED' | 'PENDING' | 'CONFLICT',
        });
        this.uiState.set(uiState);

        this.allowedTransitions.set(
          uiState.transitionChoices.filter(
            (t) => t.toStatus !== 'SUBMITTED_FOR_APPROVAL',
          ),
        );
      } else {
        this.uiState.set(null);
        this.allowedTransitions.set([]);
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  public selectedSnIds = signal<Set<string>>(new Set());
  protected readonly CHILD_REPORT_STATUSES = CHILD_REPORT_STATUSES;

  public canSelectSerial(sn: { approvalStatus?: string }): boolean {
    if (sn.approvalStatus === SERIAL_STATUSES.APPROVED) {
      return false;
    }

    if (this.userRole() === APP_ROLES.INSPECTOR) {
      return sn.approvalStatus === SERIAL_STATUSES.INSPECTED_DRAFT;
    }

    if (this.userRole() === APP_ROLES.SUPERVISOR) {
      return sn.approvalStatus === SERIAL_STATUSES.SUBMITTED_FOR_APPROVAL;
    }

    if (this.userRole() === APP_ROLES.ADMIN) {
      return sn.approvalStatus === SERIAL_STATUSES.INSPECTED_DRAFT;
    }

    return false;
  }

  public canUploadAttachments(status: ChildReportStatus): boolean {
    return (
      status !== CHILD_REPORT_STATUSES.APPROVED &&
      status !== CHILD_REPORT_STATUSES.CLOSED
    );
  }

  private getSelectableSerialIds(): string[] {
    return this.serials()
      .filter((sn) => this.canSelectSerial(sn))
      .map((sn) => sn.id);
  }

  public selectableSerialCount(): number {
    return this.getSelectableSerialIds().length;
  }

  public isAllSelectableSelected(): boolean {
    const selectableIds = this.getSelectableSerialIds();
    if (selectableIds.length === 0) {
      return false;
    }

    const selected = this.selectedSnIds();
    return selectableIds.every((id) => selected.has(id));
  }

  public toggleSelection(id: string) {
    const sn = this.serials().find((s) => s.id === id);
    if (!sn || !this.canSelectSerial(sn)) {
      return;
    }

    const current = new Set(this.selectedSnIds());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.selectedSnIds.set(current);
  }

  public selectAll() {
    const all = this.getSelectableSerialIds();
    const current = this.selectedSnIds();

    const allSelected = all.length > 0 && all.every((id) => current.has(id));
    if (allSelected) {
      this.selectedSnIds.set(new Set());
    } else {
      this.selectedSnIds.set(new Set(all));
    }
  }

  public clearSelection() {
    this.selectedSnIds.set(new Set());
  }

  public async submitSelectedForApproval() {
    const ids = this.serials()
      .filter(
        (sn) =>
          this.selectedSnIds().has(sn.id) &&
          sn.approvalStatus === SERIAL_STATUSES.INSPECTED_DRAFT,
      )
      .map((sn) => sn.id);

    if (ids.length === 0) return;

    const attachmentCount =
      this.cr()?.attachmentCount ?? this.cr()?.attachments?.length ?? 0;
    if (attachmentCount < 1) {
      this.formError.set(
        'At least one attachment is required before submitting child report serials for approval.',
      );
      return;
    }

    try {
      await this.irService.submitApprovalBatch(
        this.cr()?.inspectionReportId || '',
        ids,
        this.reportId,
      );
      this.clearSelection();
      await this.refreshData();
    } catch (e) {
      this.formError.set(
        (e as Error).message || 'Failed to submit for approval',
      );
    }
  }

  public openReasonSelect(transition: {
    toStatus: string;
    requiresReason: boolean;
  }): void {
    this.selectedTransition.set(transition);
    this.formReason.set('');
    this.formError.set('');
  }

  public async onTransition() {
    this.formError.set('');
    const transition = this.selectedTransition();
    if (!transition) return;

    try {
      if (this.notes() !== this.cr()?.notes) {
        await this.crService.updateNotes(this.reportId, this.notes());
      }
      await this.crService.transition(
        this.reportId,
        transition.toStatus as LocalChildReport['status'],
        this.formReason(),
      );
      this.selectedTransition.set(null);
      this.formReason.set('');
      this.isEditingNotes.set(false);
      await this.refreshData();
    } catch (error) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError.set(
        e?.error?.message ||
          (e as Error)?.message ||
          'Failed to transition report.',
      );
    }
  }

  public async saveNotes() {
    this.formError.set('');
    try {
      await this.crService.updateNotes(this.reportId, this.notes());
      this.isEditingNotes.set(false);
      await this.refreshData();
    } catch (error) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError.set(
        e?.error?.message || (e as Error)?.message || 'Failed to save notes.',
      );
    }
  }

  public getParentReportLink(parentId: string): string[] {
    const role = this.userRole().toLowerCase();
    return ['/', role, 'reports', parentId];
  }

  public goBack() {
    const parentId = this.parentReport()?.id;
    if (parentId) {
      this.router.navigate(this.getParentReportLink(parentId));
    } else {
      const role = this.userRole().toLowerCase();
      if (role === 'admin' || role === 'inspector') {
        this.router.navigate(['/', role, 'reports']);
      } else {
        this.router.navigate(['/', role, 'reports']);
      }
    }
  }

  public openInspectionForm(id: string) {
    const target = this.serials().find((s) => s.id === id);
    if (!target) return;
    this.inspectionSaveError.set('');
    this.inspectingSnId.set(id);
    this.inspectingSnValue.set(target.serial);
    this.inspectingSnApprovalStatus.set(target.approvalStatus || '');
    // Fresh object reference (never a mutation) so the mounted form's ngOnChanges
    // repatches when swapping serials via Prev/Next.
    this.inspectionFormData.set({ ...(target.inspectionData || {}) });
  }

  public closeInspectionForm() {
    this.inspectingSnId.set(null);
    this.inspectingSnValue.set('');
    this.inspectingSnApprovalStatus.set('');
    this.inspectionFormData.set({});
    this.inspectionSaveError.set('');
  }

  public async saveInspectionForm(data: Record<string, unknown>) {
    const snId = this.inspectingSnId();
    if (!snId) return;
    const cr = this.cr();
    if (!cr) return;

    // Align with the parent: send only inspectionData and let the server derive the
    // disposition (it reads inspectionData.body.emiResult itself in
    // ChildReportsService.updateChildReportSerialNumber and re-applies the REWORK
    // guard there). No client-side body.emiResult coupling.
    this.inspectionSaveError.set('');
    this.isSavingInspection.set(true);
    try {
      await this.crService.updateSerialNumberInspection(this.reportId, snId, data);
      this.closeInspectionForm();
      await this.refreshData();
    } catch (e) {
      const err = e as { error?: { message?: string }; message?: string };
      this.inspectionSaveError.set(
        err?.error?.message ||
          (err as Error)?.message ||
          'Failed to save inspection data.',
      );
    } finally {
      this.isSavingInspection.set(false);
    }
  }

  public get hasPrevSn(): boolean {
    const id = this.inspectingSnId();
    if (!id) return false;
    const all = this.serials();
    const idx = all.findIndex((s) => s.id === id);
    return idx > 0;
  }

  public get hasNextSn(): boolean {
    const id = this.inspectingSnId();
    if (!id) return false;
    const all = this.serials();
    const idx = all.findIndex((s) => s.id === id);
    return idx >= 0 && idx < all.length - 1;
  }

  public goToPrevSn() {
    const id = this.inspectingSnId();
    if (!id) return;
    const all = this.serials();
    const idx = all.findIndex((s) => s.id === id);
    if (idx > 0) {
      const prev = all[idx - 1];
      if (prev) this.openInspectionForm(prev.id);
    }
  }

  public goToNextSn() {
    const id = this.inspectingSnId();
    if (!id) return;
    const all = this.serials();
    const idx = all.findIndex((s) => s.id === id);
    if (idx >= 0 && idx < all.length - 1) {
      const next = all[idx + 1];
      if (next) this.openInspectionForm(next.id);
    }
  }

  public async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (!file) return;
    this.isUploadingAttachment.set(true);
    this.formError.set('');

    try {
      await this.crService.uploadAttachment(this.reportId, file);
      await this.refreshData();
    } catch (e) {
      const err = e as { error?: { message?: string }; message?: string };
      this.formError.set(
        err?.error?.message ||
          (err as Error)?.message ||
          'Failed to upload attachment.',
      );
    } finally {
      this.isUploadingAttachment.set(false);
      // Reset input value so the same file could be selected again if it failed
      input.value = '';
    }
  }
}
