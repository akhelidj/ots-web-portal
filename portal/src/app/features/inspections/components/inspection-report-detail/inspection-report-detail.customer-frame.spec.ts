/**
 * Customer app frame — the sidebar model and the inspector's serial walk.
 *
 * - `customerNav` lists only the sections that have something to show (Overview always),
 *   with counts on the countable ones; `activeCustomerView` falls back to Overview when the
 *   requested view has nothing to show, without forgetting the request.
 * - The inspector's prev/next walks the list the customer SEES (`filteredSerials`, sorted),
 *   not the raw `serials()` order — so ↓ always lands on the next visible row.
 *
 * Created with loosely-mocked providers and not change-detected: everything under test
 * is signal-derived.
 */
import { signal } from '@angular/core';
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
import {
  LocalChildReport,
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';

function sn(id: string, value: string): LocalSerialNumber {
  return { id, value, inspectionReportId: 'ir-1' } as LocalSerialNumber;
}

describe('InspectionReportDetailComponent — customer app frame', () => {
  afterEach(() => TestBed.resetTestingModule());

  function create(role: string): InspectionReportDetailComponent {
    const loose = { useValue: {} };
    TestBed.configureTestingModule({
      imports: [InspectionReportDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => 'ir-1' },
              queryParamMap: { get: () => null },
            },
          },
        },
        { provide: SessionService, useValue: { profile: signal({ role }) } },
        { provide: HttpClient, ...loose },
        { provide: InspectionReportsService, ...loose },
        { provide: ChildReportsService, ...loose },
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
    const c = TestBed.createComponent(InspectionReportDetailComponent)
      .componentInstance;
    c.report.set({ id: 'ir-1', status: 'APPROVED' } as LocalInspectionReport);
    return c;
  }

  it('shows only Overview when the report has nothing else to show', () => {
    const c = create('CUSTOMER');
    expect(c.customerNav().map((i) => i.view)).toEqual(['overview']);
  });

  it('adds sections with content, with counts on the countable ones', () => {
    const c = create('CUSTOMER');
    c.hasSpecs.set(true);
    c.serials.set([sn('a', 'SN-2'), sn('b', 'SN-1')]);
    c.attachmentCount.set(3);

    const nav = c.customerNav();
    expect(nav.map((i) => i.view)).toEqual([
      'overview',
      'specs',
      'serials',
      'documents',
    ]);
    expect(nav.find((i) => i.view === 'serials')?.count).toBe(2);
    expect(nav.find((i) => i.view === 'documents')?.count).toBe(3);
  });

  it('falls back to Overview while the requested view is empty, and keeps the request', () => {
    const c = create('CUSTOMER');
    c.customerView.set('specs');
    expect(c.activeCustomerView()).toBe('overview');

    // Header fields report content after their first render → the request resolves.
    c.hasSpecs.set(true);
    expect(c.activeCustomerView()).toBe('specs');
  });

  it('shows a single child report directly, and lists several until one is picked', () => {
    const c = create('CUSTOMER');
    const child = (id: string, serials: string[]) =>
      ({
        id,
        inspectionReportId: 'ir-1',
        type: 'REWORK',
        status: 'APPROVED',
        serialNumbers: serials.map((s, i) => ({ id: `${id}-${i}`, serial: s })),
      }) as LocalChildReport;

    c.childReports.set([child('ch-1', ['A-1'])]);
    expect(c.activeChild()?.id).toBe('ch-1');

    c.childReports.set([child('ch-1', ['A-1']), child('ch-2', ['B-10', 'B-2'])]);
    expect(c.activeChild()).toBeNull(); // list first

    c.selectedChildId.set('ch-2');
    expect(c.activeChild()?.id).toBe('ch-2');
    // The child's serials, natural-sorted, and the inspector walks THAT list.
    expect(c.activeChildSerials().map((s) => s.value)).toEqual(['B-2', 'B-10']);
    c.customerView.set('children');
    c.inspectingSn.set(c.activeChildSerials()[0] ?? null);
    c.goToNextSn();
    expect(c.inspectingSn()?.value).toBe('B-10');
  });

  it('selects the first finding by default and lists the serials it links', () => {
    const c = create('CUSTOMER');
    c.serials.set([sn('a', 'SN-1'), sn('b', 'SN-2'), sn('c', 'SN-3'), sn('d', 'SN-4')]);
    c.report.set({
      id: 'ir-1',
      status: 'APPROVED',
      statistics: [
        { id: 's1', label: 'Accepted', value: '3', serials: ['SN-3', 'SN-1', 'SN-2'] },
        { id: 's2', label: 'Rejected', value: '1', serials: ['SN-4'] },
      ],
    } as LocalInspectionReport);

    expect(c.activeFinding()?.id).toBe('s1');
    expect(c.findingSerials().map((s) => s.value)).toEqual(['SN-1', 'SN-2', 'SN-3']);
    expect(c.findingCoverage(c.statistics()[0]!)).toBe(0.75);

    c.selectedFindingId.set('s2');
    expect(c.findingSerials().map((s) => s.value)).toEqual(['SN-4']);
  });

  it('labels history events in customer language, without timing analytics', () => {
    const c = create('CUSTOMER');
    expect(c.historyEventLabel('RECEIVED')).toBe('Pipe received');
    expect(c.historyEventLabel('PENDING_APPROVAL')).toBe('Under review');
    expect(c.historyEventLabel('SOMETHING_NEW')).toBe('SOMETHING NEW');
    expect((c as unknown as Record<string, unknown>)['customerHistory']).toBeUndefined();
  });

  it('walks the inspector through the serials in the order the customer sees them', () => {
    const c = create('CUSTOMER');
    // Stored order differs from the displayed (natural-sorted) order.
    c.serials.set([sn('c', 'SN-10'), sn('a', 'SN-1'), sn('b', 'SN-2')]);
    c.customerView.set('serials');

    c.inspectingSn.set(c.filteredSerials()[0] ?? null);
    expect(c.inspectingSn()?.value).toBe('SN-1');
    expect(c.hasPrevSn).toBe(false);

    c.goToNextSn();
    expect(c.inspectingSn()?.value).toBe('SN-2');
    c.goToNextSn();
    expect(c.inspectingSn()?.value).toBe('SN-10');
    expect(c.hasNextSn).toBe(false);

    c.goToPrevSn();
    expect(c.inspectingSn()?.value).toBe('SN-2');
  });
});
