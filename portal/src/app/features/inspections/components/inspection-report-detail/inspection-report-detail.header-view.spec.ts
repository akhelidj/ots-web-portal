/**
 * Phase D step 2 — regression guard for the keystroke bug in the generic header
 * edit form.
 *
 * THE BUG: `reportHeaderView` (the overlaid header the edit form binds to via
 * `[data]`) was a GETTER, so it returned a FRESH object on every read. Angular
 * re-evaluates `[data]="reportHeaderView()"` on every change-detection cycle; a new
 * reference each time made the edit component rebuild its reactive form mid-edit,
 * WIPING in-progress keystrokes. The fix memoizes it as a `computed`, so the
 * reference is STABLE while `report()` is unchanged and the form is not rebuilt.
 *
 * This spec would have caught it: it asserts the reference is stable across reads
 * within one report state (the exact property a per-CD rebuild violates). Reverting
 * the getter→computed fix turns the `.toBe` assertion RED. It also pins the overlay
 * semantics (headerData wins over the column bridge) and that the view DOES
 * recompute when the report genuinely changes.
 *
 * The component is created with loosely-mocked providers and NOT change-detected —
 * `reportHeaderView` depends only on the `report()` signal, so no template render
 * or service behavior is needed to exercise it.
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { InspectionReportDetailComponent } from './inspection-report-detail.component';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import { ChildReportsService } from '@portal/features/inspections/services/child-reports.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { ReportValidationService } from '@portal/core/validation/services/report-validation.service';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { UserLocalRepo } from '@portal/core/offline/repos/user-local.repo';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { ApprovalBatchLocalRepo } from '@portal/core/offline/repos/approval-batch-local.repo';
import { BatchSerialNumberLocalRepo } from '@portal/core/offline/repos/batch-serial-number-local.repo';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';
import { LocalInspectionReport } from '@portal/core/offline/models/types';

function reportWith(
  over: Partial<LocalInspectionReport>,
): LocalInspectionReport {
  return {
    id: 'ir-1',
    customerId: 'c1',
    poNumber: 'PO-1',
    status: 'DRAFT',
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    templateHash: 'h',
    version: 1,
    ...over,
  } as LocalInspectionReport;
}

describe('InspectionReportDetailComponent — reportHeaderView reference stability', () => {
  afterEach(() => TestBed.resetTestingModule());

  function create(): InspectionReportDetailComponent {
    const loose = { useValue: {} };
    TestBed.configureTestingModule({
      imports: [InspectionReportDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ir-1' } } },
        },
        { provide: HttpClient, ...loose },
        { provide: InspectionReportsService, ...loose },
        { provide: ChildReportsService, ...loose },
        { provide: SessionService, ...loose },
        { provide: ReportValidationService, ...loose },
        { provide: OutboxLocalRepo, ...loose },
        { provide: ConnectivityService, ...loose },
        { provide: UserLocalRepo, ...loose },
        { provide: CustomerLocalRepo, ...loose },
        { provide: ApprovalBatchLocalRepo, ...loose },
        { provide: BatchSerialNumberLocalRepo, ...loose },
        { provide: UserPreferencesService, ...loose },
      ],
    });
    return TestBed.createComponent(InspectionReportDetailComponent)
      .componentInstance;
  }

  it('keeps a STABLE reference across reads while report() is unchanged, and recomputes when it changes', () => {
    const c = create();

    // headerData overlays the legacy column — the effective header the edit form binds.
    c.report.set(
      reportWith({ headerData: { grade: 'OVERLAID', certNumber: 'CERT-1' } }),
    );

    const first = c.reportHeaderView();
    const second = c.reportHeaderView();

    // LOAD-BEARING: a getter builds a fresh object per read → this is where the
    // per-CD form rebuild (lost keystrokes) came from. The memoized computed keeps
    // the SAME reference, so the edit form is not rebuilt mid-edit.
    expect(second).toBe(first);

    // Overlay semantics: generic headerData wins over the named-column bridge, and a
    // column-less field is present only via headerData.
    expect(first['grade']).toBe('OVERLAID');
    expect(first['certNumber']).toBe('CERT-1');

    // It DOES recompute when the report genuinely changes (not frozen).
    c.report.set(reportWith({ headerData: { grade: 'CHANGED' } }));
    const third = c.reportHeaderView();
    expect(third).not.toBe(first);
    expect(third['grade']).toBe('CHANGED');
  });
});
