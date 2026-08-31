/**
 * DOM-level spec for the generic parent-report attachments panel. Zoneless
 * discipline: the component's post-await state (attachments, uploading, error,
 * thumbnails) lives in signals, so change detection must be scheduler-driven.
 * Every test RENDERS the DOM and relies on `autoDetectChanges()` + `whenStable()`
 * with real DOM events (a real `change` on a file input, a real `click` on a
 * row) — never a manual `detectChanges()` that would mask a missing-notification
 * bug.
 *
 * The attachment endpoint is auth-guarded, so thumbnails and downloads go through
 * `fetchAttachmentBlob` (JWT interceptor) and render/save object URLs. jsdom has
 * no `URL.createObjectURL`, so it is mocked here.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { ReportAttachmentsComponent } from './report-attachments.component';
import {
  AttachmentUploadOfflineError,
  InspectionReportsService,
} from '@portal/features/inspections/services/inspection-reports.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import {
  Attachment,
  LocalInspectionReport,
} from '@portal/core/offline/models/types';

const UPLOADED: Attachment = {
  id: 'att-1',
  filename: 'inspection-note.pdf',
  url: '/api/files/attachments/att-1',
  createdAt: '2026-08-27T00:00:00.000Z',
};

function attachment(over: Partial<Attachment>): Attachment {
  return {
    id: 'att-x',
    filename: 'file.bin',
    url: '/api/files/attachments/att-x',
    createdAt: '2026-08-27T00:00:00.000Z',
    ...over,
  };
}

function reportWith(atts: Attachment[]): LocalInspectionReport {
  return {
    id: 'ir-1',
    customerId: 'c1',
    poNumber: 'PO-1',
    status: 'DRAFT',
    templateKey: 'DRILL_PIPE_REPORT',
    templateVersion: 1,
    templateHash: 'h',
    version: 1,
    attachments: atts,
  } as LocalInspectionReport;
}

describe('ReportAttachmentsComponent', () => {
  let uploadAttachment: jest.Mock;
  let fetchAttachmentBlob: jest.Mock;
  let reports: WritableSignal<LocalInspectionReport[]>;
  let online: WritableSignal<boolean>;

  beforeEach(() => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = jest
      .fn()
      .mockReturnValue('blob:mock-url');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
      jest.fn();
  });

  afterEach(() => TestBed.resetTestingModule());

  function setup(opts: { online?: boolean; existing?: Attachment[] } = {}) {
    online = signal(opts.online ?? true);
    // The panel derives its rows from the service's reactive `reports` cache, so
    // seed it with the report (optionally carrying attachments) the panel views.
    reports = signal<LocalInspectionReport[]>([
      reportWith(opts.existing ?? []),
    ]);
    // Faithful to the real service: an upload upserts the attachment into the local
    // cache, which refreshes `reports` — the very signal the panel re-derives from.
    // So the mock updates the signal rather than resolving in isolation.
    uploadAttachment = jest.fn().mockImplementation(async () => {
      reports.update((list) =>
        list.map((r) =>
          r.id === 'ir-1'
            ? { ...r, attachments: [...(r.attachments ?? []), UPLOADED] }
            : r,
        ),
      );
      return UPLOADED;
    });
    fetchAttachmentBlob = jest
      .fn()
      .mockResolvedValue(new Blob(['bytes'], { type: 'image/png' }));

    TestBed.configureTestingModule({
      imports: [ReportAttachmentsComponent],
      providers: [
        {
          provide: InspectionReportsService,
          useValue: { uploadAttachment, fetchAttachmentBlob, reports },
        },
        { provide: ConnectivityService, useValue: { isOnline: online } },
      ],
    });

    const fixture = TestBed.createComponent(ReportAttachmentsComponent);
    fixture.componentRef.setInput('reportId', 'ir-1');
    return fixture;
  }

  const el = (f: ComponentFixture<ReportAttachmentsComponent>) =>
    f.nativeElement as HTMLElement;

  async function flush(f: ComponentFixture<ReportAttachmentsComponent>) {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await f.whenStable();
    }
  }

  async function render(
    opts: { online?: boolean; existing?: Attachment[] } = {},
  ) {
    const fixture = setup(opts);
    fixture.autoDetectChanges();
    await flush(fixture);
    return fixture;
  }

  /** Drive a real `change` event on the first file input with the given file. */
  async function pickFile(
    f: ComponentFixture<ReportAttachmentsComponent>,
    file: File,
  ) {
    const input = el(f).querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await flush(f);
  }

  it('shows the optional empty state when there are no attachments', async () => {
    const fixture = await render();
    const text = el(fixture).textContent ?? '';

    expect(text).toContain('No attachments yet');
    expect(text.toLowerCase()).toContain('optional');
    expect(el(fixture).querySelector('ul')).toBeNull();
    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
  });

  it('renders late-arriving attachments without a remount (cache hydrates after mount)', async () => {
    // Mount while the cached report carries no attachments yet — the empty state.
    const fixture = await render();
    expect(el(fixture).textContent ?? '').toContain('No attachments yet');
    expect(el(fixture).querySelector('ul')).toBeNull();

    // A slow pull hydrates attachments into the cache AFTER mount. Same component
    // instance — no re-creation — must reflect the new rows reactively.
    reports.set([
      reportWith([attachment({ id: 'late-1', filename: 'late-scan.pdf' })]),
    ]);
    await flush(fixture);

    expect(el(fixture).querySelectorAll('ul li').length).toBe(1);
    expect(el(fixture).textContent ?? '').toContain('late-scan.pdf');
    expect(el(fixture).textContent ?? '').not.toContain('No attachments yet');
  });

  it('appends a row on a successful upload, driven by a real file-input change', async () => {
    const fixture = await render();

    await pickFile(
      fixture,
      new File(['%PDF-1.4'], 'inspection-note.pdf', {
        type: 'application/pdf',
      }),
    );

    expect(uploadAttachment).toHaveBeenCalledWith('ir-1', expect.any(File));

    const row = el(fixture).querySelector('ul button');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('inspection-note.pdf');
    expect(el(fixture).textContent ?? '').not.toContain('No attachments yet');
  });

  it('shows an alert with a retry control when the upload fails', async () => {
    const fixture = await render();
    uploadAttachment.mockRejectedValueOnce(new Error('boom'));

    await pickFile(
      fixture,
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );

    const alert = el(fixture).querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('photo.jpg');

    const retry = Array.from(el(fixture).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Retry'),
    );
    expect(retry).toBeDefined();

    uploadAttachment.mockResolvedValueOnce(UPLOADED);
    retry?.dispatchEvent(new Event('click'));
    await flush(fixture);

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(el(fixture).querySelector('[role="alert"]')).toBeNull();
  });

  it('disables the upload controls while offline and states the reason', async () => {
    const fixture = await render({ online: false });

    const inputs = Array.from(
      el(fixture).querySelectorAll('input[type=file]'),
    ) as HTMLInputElement[];
    expect(inputs.length).toBe(3);
    expect(inputs.every((i) => i.disabled)).toBe(true);

    expect((el(fixture).textContent ?? '').toLowerCase()).toContain('offline');
  });

  it('surfaces the typed offline error when an upload is attempted offline', async () => {
    const fixture = await render();
    uploadAttachment.mockRejectedValueOnce(new AttachmentUploadOfflineError());

    await pickFile(
      fixture,
      new File(['x'], 'doc.txt', { type: 'text/plain' }),
    );

    const alert = el(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent?.toLowerCase()).toContain('offline');
  });

  it('resolves an image thumbnail from a fetched blob (object URL, not raw src)', async () => {
    const fixture = await render({
      existing: [attachment({ id: 'img-1', filename: 'weld.jpg' })],
    });

    expect(fetchAttachmentBlob).toHaveBeenCalledWith('img-1');

    const img = el(fixture).querySelector('ul img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    // Rendered from the mocked object URL — never the auth-guarded raw path.
    expect(img?.getAttribute('src')).toBe('blob:mock-url');
    expect(img?.getAttribute('src')).not.toContain('/api/files/');
  });

  it('falls back to the file-icon row when a thumbnail fetch fails (no broken image)', async () => {
    const fixture = setup({
      existing: [attachment({ id: 'img-2', filename: 'scan.png' })],
    });
    // Force the blob fetch to reject for this row (same fn the provider holds).
    fetchAttachmentBlob.mockReset().mockRejectedValue(new Error('401'));

    fixture.autoDetectChanges();
    await flush(fixture);

    expect(el(fixture).querySelector('ul img')).toBeNull();
    // The row is still present (as a button) with an icon, not a broken image.
    const row = el(fixture).querySelector('ul button');
    expect(row).not.toBeNull();
    expect(row?.querySelector('svg')).not.toBeNull();
  });

  it('shows the alert when a download fails, via a real row click', async () => {
    const fixture = await render({
      existing: [attachment({ id: 'doc-1', filename: 'report.pdf' })],
    });
    fetchAttachmentBlob.mockRejectedValueOnce(new Error('network'));

    const row = el(fixture).querySelector('ul button') as HTMLButtonElement;
    row.dispatchEvent(new Event('click'));
    await flush(fixture);

    const alert = el(fixture).querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('report.pdf');
    expect(alert?.textContent?.toLowerCase()).toContain("couldn't download");
  });

  it('revokes every thumbnail object URL on destroy', async () => {
    const fixture = await render({
      existing: [attachment({ id: 'img-3', filename: 'photo.webp' })],
    });
    expect(el(fixture).querySelector('ul img')).not.toBeNull();

    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
