import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { environment } from '@app-env/environment';
import { ReportSignaturesService } from './report-signatures.service';
import {
  describeSignaturePending,
  readSignaturePending,
} from './signature-pending.util';

describe('ReportSignaturesService', () => {
  let http: HttpTestingController;
  let service: ReportSignaturesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ReportSignaturesService);
  });

  afterEach(() => http.verify());

  it('loads the per-report signature states', async () => {
    const p = service.getStates('r1');
    const req = http.expectOne(`${environment.apiUrl}/inspection-reports/r1/signatures`);
    expect(req.request.method).toBe('GET');
    req.flush({ reportId: 'r1', revisionNumber: 1, signable: true, fields: [] });
    expect((await p).signable).toBe(true);
  });

  it('lists the reports waiting on the customer', async () => {
    const p = service.listPending();
    const req = http.expectOne(`${environment.apiUrl}/customer-signatures/pending`);
    req.flush([]);
    expect(await p).toEqual([]);
  });

  it('PUTs the drawn PNG as multipart `file`, encoding the field key', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const p = service.sign('r1', 'cust sig', png);
    const req = http.expectOne(
      `${environment.apiUrl}/inspection-reports/r1/signatures/cust%20sig`,
    );
    expect(req.request.method).toBe('PUT');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(Blob);
    req.flush({ reportId: 'r1', revisionNumber: 1, signable: true, fields: [] });
    await p;
  });
});

describe('signature-pending util', () => {
  const pendingBody = {
    code: 'SIGNATURE_PENDING',
    pending: [
      { key: 'custSig', label: 'Customer approval', signer: 'CUSTOMER' },
      { key: 'qa', label: 'QA', signer: 'SUPERVISOR' },
    ],
  };

  it('reads the pending list from a parsed JSON body', async () => {
    const err = new HttpErrorResponse({ status: 409, error: pendingBody });
    expect(await readSignaturePending(err)).toHaveLength(2);
  });

  it('reads it from a Blob body (export uses responseType blob)', async () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: new Blob([JSON.stringify(pendingBody)], { type: 'application/json' }),
    });
    const pending = await readSignaturePending(err);
    expect(pending?.map((p) => p.key)).toEqual(['custSig', 'qa']);
  });

  it('returns null for other statuses, other codes, and unparseable bodies', async () => {
    expect(
      await readSignaturePending(new HttpErrorResponse({ status: 500, error: pendingBody })),
    ).toBeNull();
    expect(
      await readSignaturePending(
        new HttpErrorResponse({ status: 409, error: { code: 'VERSION_CONFLICT' } }),
      ),
    ).toBeNull();
    expect(
      await readSignaturePending(
        new HttpErrorResponse({ status: 409, error: new Blob(['not json']) }),
      ),
    ).toBeNull();
  });

  it('describes who must sign', () => {
    expect(describeSignaturePending(pendingBody.pending as never)).toBe(
      'Export blocked — waiting for signature: Customer approval (customer), QA (supervisor).',
    );
    expect(describeSignaturePending([])).toMatch(/still missing/);
  });
});
