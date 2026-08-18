/**
 * Phase D flat step 5 — the consumption picker on the create-report screen, DOM-level.
 *
 * Report creation is no longer locked to DRILL_PIPE_REPORT: the screen fetches the
 * defined-only template list from GET /inspection-reports/available-templates and offers
 * exactly those. This RENDERS the component and asserts the DOM (zoneless discipline — a
 * component-field assertion can pass while the <select> is empty):
 *
 *   - the Template <select> is populated from the fetched list (and only that list — an
 *     undefined template the endpoint never returns is not an option);
 *   - picking a template flows its templateKey into the createReport({customerId,
 *     poNumber, templateKey}) call — driven through real DOM events, no field pokes.
 *
 * The picker is data-driven, so the options come from the fetched signal or not at all.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { CreateInspectionReportComponent } from './create-inspection-report.component';
import {
  AvailableTemplate,
  InspectionReportsService,
} from '@portal/features/inspections/services/inspection-reports.service';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';

const TEMPLATES: AvailableTemplate[] = [
  { templateKey: 'CASING_FLAT', templateVersion: 1, displayName: 'Casing Flat' },
  {
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 3,
    displayName: 'Drill Pipe Report',
  },
];

const CUSTOMERS = [{ id: 'cust-1', name: 'Acme Drilling' }];

describe('CreateInspectionReportComponent — consumption picker (step 5)', () => {
  let getAvailableTemplates: jest.Mock;
  let createReport: jest.Mock;

  afterEach(() => TestBed.resetTestingModule());

  function setup(templates: AvailableTemplate[] = TEMPLATES) {
    getAvailableTemplates = jest.fn().mockResolvedValue(templates);
    createReport = jest.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      imports: [CreateInspectionReportComponent],
      providers: [
        {
          provide: InspectionReportsService,
          useValue: { getAvailableTemplates, createReport },
        },
        {
          provide: CustomerLocalRepo,
          useValue: {
            list: jest.fn().mockResolvedValue(CUSTOMERS),
            changes$: new Subject<void>(),
          },
        },
        provideRouter([]),
      ],
    });
    return TestBed.createComponent(CreateInspectionReportComponent);
  }

  /**
   * Render + let the constructor's fire-and-forget async loads (getAvailableTemplates,
   * customer list) settle. A macrotask flush drains their promise chains so the signal
   * writes land; autoDetectChanges (scheduler-driven) then renders — no manual
   * detectChanges (which trips NG0100 with ngModel selects in zoneless).
   */
  async function render(templates: AvailableTemplate[] = TEMPLATES) {
    const fixture = setup(templates);
    fixture.autoDetectChanges();
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    return fixture;
  }

  const el = (f: ComponentFixture<CreateInspectionReportComponent>) =>
    f.nativeElement as HTMLElement;
  const templateSelect = (f: ComponentFixture<CreateInspectionReportComponent>) =>
    el(f).querySelector('#templateKey') as HTMLSelectElement;

  async function setSelect(
    f: ComponentFixture<CreateInspectionReportComponent>,
    sel: string,
    value: string,
  ) {
    const node = el(f).querySelector(sel) as HTMLSelectElement;
    node.value = value;
    node.dispatchEvent(new Event('change'));
    await f.whenStable();
  }
  async function setInput(
    f: ComponentFixture<CreateInspectionReportComponent>,
    sel: string,
    value: string,
  ) {
    const node = el(f).querySelector(sel) as HTMLInputElement;
    node.value = value;
    node.dispatchEvent(new Event('input'));
    await f.whenStable();
  }

  it('populates the Template picker from the fetched defined-only list', async () => {
    const f = await render();
    expect(getAvailableTemplates).toHaveBeenCalled();

    const labels = Array.from(templateSelect(f).querySelectorAll('option'))
      .map((o) => o.textContent?.trim())
      .filter((t) => t && t !== 'Select a Template');
    expect(labels).toEqual(['Casing Flat', 'Drill Pipe Report']);

    const values = Array.from(templateSelect(f).querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain('CASING_FLAT');
    // An undefined template the endpoint never returns is not offered.
    expect(values).not.toContain('NOT_YET_DEFINED');
  });

  it('is data-driven: an empty available list yields no template options', async () => {
    const f = await render([]);
    const labels = Array.from(templateSelect(f).querySelectorAll('option'))
      .map((o) => o.textContent?.trim())
      .filter((t) => t && t !== 'Select a Template');
    expect(labels).toEqual([]); // nothing hardcoded — no DRILL_PIPE_REPORT fallback
  });

  it('flows the PICKED templateKey into createReport (non-drill-pipe selectable)', async () => {
    const f = await render();

    await setSelect(f, '#customer', 'cust-1');
    await setInput(f, '#poNumber', 'PO-123');
    await setSelect(f, '#templateKey', 'CASING_FLAT'); // pick the non-drill-pipe template

    (el(f).querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await f.whenStable();

    expect(createReport).toHaveBeenCalledWith({
      customerId: 'cust-1',
      poNumber: 'PO-123',
      templateKey: 'CASING_FLAT',
    });
  });
});
