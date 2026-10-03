import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import SignaturePad from 'signature_pad';
import { SignatureService } from '@portal/core/auth/services/signature.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

/** Exported PNG size — what the API stores and the export embeds (3:1, transparent). */
export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
const INK = '#0f172a';

/**
 * Modal where the user draws their account signature. Draws on a hi-DPI canvas sized to
 * its container, then flattens to a fixed 600×200 transparent PNG so every signature,
 * whatever the device, reaches storage and the Excel export in the same shape.
 */
@Component({
  selector: 'app-signature-dialog',
  standalone: true,
  templateUrl: './signature-dialog.component.html',
})
export class SignatureDialogComponent implements AfterViewInit, OnDestroy {
  private signatures = inject(SignatureService);
  public connectivity = inject(ConnectivityService);

  /** False for the mandatory gate flow: no cancel button, Escape does nothing. */
  public dismissible = input(true);

  /** Copy — defaults describe the account-signature flow. */
  public heading = input('Your signature');
  public description = input(
    'Sign in the box below with your finger, stylus or mouse. It is saved to your account and applied to the reports you submit.',
  );
  public saveLabel = input('Save signature');

  /**
   * Where the drawn PNG goes. Omitted → the caller's account signature. A per-report
   * signature (customer sign-off) passes its own uploader and the account is untouched.
   */
  public uploader = input<((png: Blob) => Promise<unknown>) | null>(null);
  public saved = output<void>();
  public cancelled = output<void>();

  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private pad: SignaturePad | null = null;

  public isEmpty = signal(true);
  public isSaving = signal(false);
  public error = signal('');

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.pad = new SignaturePad(canvas, {
      penColor: INK,
      minWidth: 0.8,
      maxWidth: 2.4,
      backgroundColor: 'rgba(0,0,0,0)',
    });
    this.pad.addEventListener('endStroke', () => this.isEmpty.set(this.pad?.isEmpty() ?? true));
    this.resizeCanvas();
  }

  ngOnDestroy(): void {
    this.pad?.off();
    this.pad = null;
  }

  @HostListener('window:resize')
  public resizeCanvas(): void {
    const canvas = this.canvasRef().nativeElement;
    const pad = this.pad;
    if (!pad) return;
    const data = pad.toData();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.offsetWidth;
    if (width === 0) return;
    canvas.width = width * ratio;
    canvas.height = (width * SIGNATURE_HEIGHT * ratio) / SIGNATURE_WIDTH;
    canvas.getContext('2d')?.scale(ratio, ratio);
    pad.clear();
    // Strokes were recorded in CSS pixels of the previous size; rescale is not
    // attempted — a resize mid-signature keeps them at their original coordinates.
    if (data.length > 0) pad.fromData(data);
    this.isEmpty.set(pad.isEmpty());
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.dismissible() && !this.isSaving()) this.cancelled.emit();
  }

  public clear(): void {
    this.pad?.clear();
    this.isEmpty.set(true);
    this.error.set('');
  }

  public async save(): Promise<void> {
    if (!this.pad || this.pad.isEmpty()) {
      this.error.set('Draw your signature before saving.');
      return;
    }
    if (!this.connectivity.isOnline()) {
      this.error.set('A network connection is required to save your signature.');
      return;
    }

    this.isSaving.set(true);
    this.error.set('');
    try {
      const png = await this.flatten();
      const custom = this.uploader();
      if (custom) {
        await custom(png);
      } else {
        await this.signatures.save(png);
      }
      this.saved.emit();
    } catch (e) {
      this.error.set((e as Error).message || 'Could not save your signature.');
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Redraw the pad onto a fixed 600×200 transparent canvas and encode it as PNG. */
  private flatten(): Promise<Blob> {
    const source = this.canvasRef().nativeElement;
    const out = document.createElement('canvas');
    out.width = SIGNATURE_WIDTH;
    out.height = SIGNATURE_HEIGHT;
    out.getContext('2d')?.drawImage(source, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    return new Promise((resolve, reject) =>
      out.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('Could not encode the signature.')),
        'image/png',
      ),
    );
  }
}
