import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Attachment } from '@portal/core/offline/models/types';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import {
  AttachmentUploadOfflineError,
  InspectionReportsService,
} from '@portal/features/inspections/services/inspection-reports.service';

/** Per-instance id seed so each mounted component gets unique input ids for its
 *  <label for>/id pairs (label-has-associated-control is enforced). */
let nextReportAttachmentsId = 0;

/**
 * Generic, report-agnostic attachments panel. Knows nothing about report type,
 * tool type, or workflow status — the host passes `disabled` from whatever
 * governs read-only-ness. Attachments are optional; the empty state says so.
 *
 * The `/api/files/attachments/:id` endpoint is auth-guarded, so a bare
 * `<img src>`/`<a href>` (no JWT header) would 401. Instead every image
 * thumbnail and every download fetches the bytes through HttpClient (JWT
 * interceptor applies) and renders/saves an object URL. Object URLs are revoked
 * on destroy so nothing leaks across drawer/tab switches.
 */
@Component({
  selector: 'app-report-attachments',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './report-attachments.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
})
export class ReportAttachmentsComponent implements OnDestroy {
  private reportsService = inject(InspectionReportsService);
  private connectivity = inject(ConnectivityService);

  /** Required: the parent inspection report these attachments belong to. */
  public readonly reportId = input.required<string>();
  /** Optional: host-supplied read-only flag (e.g. report locked). */
  public readonly disabled = input(false);
  /** Optional: a view-only consumer (e.g. customer) — the upload controls are
   *  hidden entirely and the panel reads as a documents list. Downloads and
   *  thumbnails are unaffected. */
  public readonly viewerOnly = input(false);

  private readonly uid = `report-attachments-${nextReportAttachmentsId++}`;
  public readonly docInputId = `${this.uid}-doc`;
  public readonly photoInputId = `${this.uid}-photo`;
  public readonly cameraInputId = `${this.uid}-camera`;
  public readonly errorId = `${this.uid}-error`;

  /** Reactive view of the cached report's attachments. Derived from the service's
   *  `reports` signal (refreshed on every local-cache change), so attachments that
   *  arrive AFTER this panel mounts — e.g. a slow pull hydrating them mid-view —
   *  render without a remount. A successful upload persists through the same cache,
   *  so a new document surfaces here via this computed too. */
  public readonly attachments = computed<Attachment[]>(() => {
    const id = this.reportId();
    return (
      this.reportsService.reports().find((r) => r.id === id)?.attachments ?? []
    );
  });

  // All post-await state lives in signals — the app is zoneless, so a plain
  // field set in a catch() would not repaint.
  public readonly uploading = signal(false);
  public readonly pendingName = signal<string | null>(null);
  public readonly errorMessage = signal<string | null>(null);
  private readonly retryAction = signal<(() => void) | null>(null);

  // Thumbnail state. The registry Map is the revoke source-of-truth; the signals
  // mirror it for the template. `thumbInFlight` dedupes concurrent fetches.
  private readonly thumbObjectUrls = new Map<string, string>();
  private readonly thumbInFlight = new Set<string>();
  public readonly thumbUrl = signal<Record<string, string>>({});
  public readonly thumbFailed = signal<Record<string, boolean>>({});

  /** Offline is a live signal so the buttons disable ahead of the click. */
  public readonly isOffline = computed(() => !this.connectivity.isOnline());

  public readonly isDisabled = computed(
    () => this.disabled() || this.uploading() || this.isOffline(),
  );

  public readonly hasRetry = computed(() => this.retryAction() !== null);

  private static readonly IMAGE_EXT =
    /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif|svg)$/i;

  constructor() {
    // Lazily resolve a thumbnail for each image row not yet fetched/failed.
    effect(() => {
      const list = this.attachments();
      untracked(() => {
        for (const a of list) {
          if (!this.isImage(a.filename)) continue;
          if (this.thumbObjectUrls.has(a.id)) continue;
          if (this.thumbFailed()[a.id]) continue;
          if (this.thumbInFlight.has(a.id)) continue;
          this.thumbInFlight.add(a.id);
          void this.loadThumb(a.id);
        }
      });
    });
  }

  public ngOnDestroy(): void {
    for (const url of this.thumbObjectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.thumbObjectUrls.clear();
  }

  public isImage(filename: string): boolean {
    return ReportAttachmentsComponent.IMAGE_EXT.test(filename);
  }

  public async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so re-picking the same file still fires (change) — including retry.
    input.value = '';
    if (!file) return;
    await this.upload(file);
  }

  public async retry(): Promise<void> {
    const action = this.retryAction();
    if (action) action();
  }

  public async download(attachment: Attachment): Promise<void> {
    this.clearError();
    try {
      const blob = await this.reportsService.fetchAttachmentBlob(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      this.errorMessage.set(
        `Couldn't download "${attachment.filename}". Check your connection and try again.`,
      );
      this.retryAction.set(() => void this.download(attachment));
    }
  }

  private async upload(file: File): Promise<void> {
    this.clearError();
    this.uploading.set(true);
    this.pendingName.set(file.name);
    try {
      // uploadAttachment upserts the new attachment into the local cache, which
      // refreshes the `reports` signal and re-derives `attachments`. No optimistic
      // local append — that would duplicate the row the cache is about to add.
      await this.reportsService.uploadAttachment(this.reportId(), file);
    } catch (err: unknown) {
      this.errorMessage.set(this.describeUploadError(err, file.name));
      this.retryAction.set(() => void this.upload(file));
    } finally {
      this.uploading.set(false);
      this.pendingName.set(null);
    }
  }

  private clearError(): void {
    this.errorMessage.set(null);
    this.retryAction.set(null);
  }

  private describeUploadError(err: unknown, filename: string): string {
    if (err instanceof AttachmentUploadOfflineError) {
      return `Couldn't upload "${filename}" — you're offline. Reconnect and try again.`;
    }
    return `Couldn't upload "${filename}". Check your connection and try again.`;
  }

  private async loadThumb(id: string): Promise<void> {
    try {
      const blob = await this.reportsService.fetchAttachmentBlob(id);
      const url = URL.createObjectURL(blob);
      this.thumbObjectUrls.set(id, url);
      this.thumbUrl.update((m) => ({ ...m, [id]: url }));
    } catch {
      this.thumbFailed.update((m) => ({ ...m, [id]: true }));
    } finally {
      this.thumbInFlight.delete(id);
    }
  }

  /** Template helper: a fetched-and-ready thumbnail exists for this row. */
  public thumbReady(id: string): boolean {
    return !!this.thumbUrl()[id];
  }

  /** Template helper: an image row still resolving its thumbnail (not failed). */
  public thumbLoading(attachment: Attachment): boolean {
    return (
      this.isImage(attachment.filename) &&
      !this.thumbUrl()[attachment.id] &&
      !this.thumbFailed()[attachment.id]
    );
  }

  /** Mark a thumbnail failed (belt-and-suspenders for a decode/render error). */
  public onThumbError(id: string): void {
    this.thumbFailed.update((m) => ({ ...m, [id]: true }));
  }

}
