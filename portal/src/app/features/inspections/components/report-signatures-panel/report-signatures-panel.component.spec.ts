import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SignatureDialogComponent } from '@portal/shared/components/signature-dialog/signature-dialog.component';
import { ToastService } from '@portal/shared/toast/toast.service';
import {
  ReportSignatureStates,
  ReportSignaturesService,
} from '@portal/features/inspections/services/report-signatures.service';
import { CustomerSignaturePendingComponent } from '@portal/features/workspaces/customer/customer-signature-pending.component';
import { ReportSignaturesPanelComponent } from './report-signatures-panel.component';

/** The real dialog needs a canvas; the panels only care about its inputs/outputs. */
@Component({ selector: 'app-signature-dialog', standalone: true, template: '' })
class StubDialog {
  heading = input('');
  description = input('');
  saveLabel = input('');
  uploader = input<((png: Blob) => Promise<unknown>) | null>(null);
  saved = output<void>();
  cancelled = output<void>();
}

const states = (over: Partial<ReportSignatureStates> = {}): ReportSignatureStates => ({
  reportId: 'r1',
  revisionNumber: 1,
  signable: true,
  fields: [
    {
      key: 'custSig',
      label: 'Customer approval',
      signer: 'CUSTOMER',
      required: true,
      signed: false,
      signedAt: null,
      signedByName: null,
    },
    {
      key: 'qa',
      label: 'QA',
      signer: 'SUPERVISOR',
      required: false,
      signed: true,
      signedAt: '2026-10-01T10:00:00.000Z',
      signedByName: 'Sam Supervisor',
    },
  ],
  ...over,
});

function setup() {
  const api = {
    getStates: jest.fn().mockResolvedValue(states()),
    listPending: jest.fn().mockResolvedValue([]),
    sign: jest.fn().mockResolvedValue(states()),
  };
  const toast = { showSuccess: jest.fn(), showError: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ReportSignaturesService, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  })
    .overrideComponent(ReportSignaturesPanelComponent, {
      remove: { imports: [SignatureDialogComponent] },
      add: { imports: [StubDialog] },
    })
    .overrideComponent(CustomerSignaturePendingComponent, {
      remove: { imports: [SignatureDialogComponent] },
      add: { imports: [StubDialog] },
    });
  return { api, toast };
}

const flush = async (f: ComponentFixture<unknown>) => {
  await f.whenStable();
  f.detectChanges();
};

describe('ReportSignaturesPanelComponent', () => {
  function create(isCustomer: boolean) {
    const f = TestBed.createComponent(ReportSignaturesPanelComponent);
    f.componentRef.setInput('reportId', 'r1');
    f.componentRef.setInput('status', 'APPROVED');
    f.componentRef.setInput('isCustomer', isCustomer);
    f.detectChanges();
    return f;
  }
  const text = (f: ComponentFixture<unknown>) =>
    ((f.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  it('shows who signed, and what is outstanding', async () => {
    setup();
    const f = create(false);
    await flush(f);
    expect(text(f)).toContain('Customer approval');
    expect(text(f)).toContain('Not signed yet');
    expect(text(f)).toContain('Signed by Sam Supervisor');
  });

  it('offers Sign only to a customer, for an unsigned customer field', async () => {
    setup();
    const staff = create(false);
    await flush(staff);
    expect(
      (staff.nativeElement as HTMLElement).querySelector('[data-testid="sign-custSig"]'),
    ).toBeNull();
    TestBed.resetTestingModule();

    setup();
    const customer = create(true);
    await flush(customer);
    const el = customer.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sign-custSig"]')).not.toBeNull();
    // never for a supervisor field, nor one already signed
    expect(el.querySelector('[data-testid="sign-qa"]')).toBeNull();
  });

  it('does not offer Sign before the report is approved', async () => {
    const { api } = setup();
    api.getStates.mockResolvedValue(states({ signable: false }));
    const f = create(true);
    await flush(f);
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="sign-custSig"]'),
    ).toBeNull();
  });

  it('renders nothing when the template has no signature fields or loading fails', async () => {
    const { api } = setup();
    api.getStates.mockRejectedValue(new Error('offline'));
    const f = create(true);
    await flush(f);
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="report-signatures"]'),
    ).toBeNull();
  });

  it('signs through the report uploader, then reloads', async () => {
    const { api, toast } = setup();
    const f = create(true);
    await flush(f);
    const cmp = f.componentInstance;
    cmp.openSigning(cmp.fields()[0]);
    const up = cmp.uploader();
    expect(up).not.toBeNull();
    const png = new Blob([new Uint8Array([1])]);
    await up?.(png);
    expect(api.sign).toHaveBeenCalledWith('r1', 'custSig', png);

    api.getStates.mockClear();
    await cmp.onSigned();
    expect(toast.showSuccess).toHaveBeenCalled();
    expect(api.getStates).toHaveBeenCalledTimes(1);
    expect(cmp.signing()).toBeNull();
  });
});

describe('CustomerSignaturePendingComponent', () => {
  const pendingReport = {
    reportId: 'r1',
    reportNumber: 'IR-001',
    poNumber: 'PO-9',
    status: 'APPROVED',
    fields: [{ key: 'custSig', label: 'Customer approval', required: true }],
  };

  it('renders nothing when nothing is pending', async () => {
    setup();
    const f = TestBed.createComponent(CustomerSignaturePendingComponent);
    f.detectChanges();
    await flush(f);
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="signature-pending"]'),
    ).toBeNull();
  });

  it('lists pending reports with a Sign button per field', async () => {
    const { api } = setup();
    api.listPending.mockResolvedValue([pendingReport]);
    const f = TestBed.createComponent(CustomerSignaturePendingComponent);
    f.detectChanges();
    await flush(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="signature-pending"]')).not.toBeNull();
    expect(el.textContent).toContain('IR-001');
    expect(el.querySelector('[data-testid="sign-r1-custSig"]')).not.toBeNull();
  });

  it('hides the panel when the list cannot be loaded', async () => {
    const { api } = setup();
    api.listPending.mockRejectedValue(new Error('offline'));
    const f = TestBed.createComponent(CustomerSignaturePendingComponent);
    f.detectChanges();
    await flush(f);
    expect(f.componentInstance.pending()).toEqual([]);
  });

  it('signs the chosen report+field, then reloads the list', async () => {
    const { api, toast } = setup();
    api.listPending.mockResolvedValue([pendingReport]);
    const f = TestBed.createComponent(CustomerSignaturePendingComponent);
    f.detectChanges();
    await flush(f);
    const cmp = f.componentInstance;
    cmp.openSigning(pendingReport, pendingReport.fields[0]);
    const png = new Blob([new Uint8Array([1])]);
    await cmp.target()?.uploader(png);
    expect(api.sign).toHaveBeenCalledWith('r1', 'custSig', png);

    api.listPending.mockResolvedValue([]);
    await cmp.onSigned();
    expect(toast.showSuccess).toHaveBeenCalled();
    expect(cmp.target()).toBeNull();
    expect(cmp.pending()).toEqual([]);
  });
});
