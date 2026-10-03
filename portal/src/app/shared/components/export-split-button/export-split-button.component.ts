import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export type ExportFormat = 'pdf' | 'xlsx';
export type ExportButtonVariant = 'customer' | 'header' | 'bar';

/**
 * Export as a split button: the main click downloads the filled PDF; the chevron opens
 * PDF and Excel (the filled workbook).
 *
 * `blocked` locks the formats (not approved, required signature pending, …) and
 * `reason` says why — shown in the menu and as the tooltip. The chevron stays usable while
 * blocked so the reason is always reachable.
 *
 * The menu is clamped to the viewport so it never runs off-screen on a narrow phone.
 */
@Component({
  selector: 'app-export-split-button',
  standalone: true,
  templateUrl: './export-split-button.component.html',
})
export class ExportSplitButtonComponent {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  public readonly blocked = input(false);
  public readonly reason = input('');
  public readonly isExporting = input(false);
  public readonly isOnline = input(true);
  public readonly variant = input<ExportButtonVariant>('header');

  public readonly exportRequested = output<ExportFormat>();

  public readonly open = signal(false);

  protected readonly filledDisabled = computed(
    () => this.isExporting() || this.blocked() || !this.isOnline(),
  );
  protected readonly menuWidth = signal(256);
  /** Offset from the host's left edge, so the menu stays inside the viewport. */
  protected readonly menuLeft = signal(0);

  protected readonly mainClass = computed(() => {
    switch (this.variant()) {
      case 'customer':
        return 'cust-sweep cust-sweep--accent group border border-transparent bg-accent px-5 py-3 font-sans uppercase tracking-[0.12em] text-[13px] text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:before:hidden';
      case 'bar':
        return 'btn btn-secondary !rounded-r-none';
      default:
        return 'bg-primary hover:bg-primary/90 text-white px-4 py-2 text-sm font-semibold rounded-l-lg shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary';
    }
  });

  protected readonly chevronClass = computed(() => {
    switch (this.variant()) {
      case 'customer':
        return 'border border-transparent border-l-accent-foreground/30 bg-accent px-3 text-accent-foreground hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background';
      case 'bar':
        return 'btn btn-secondary !rounded-l-none !px-2 border-l-0';
      default:
        return 'bg-primary hover:bg-primary/90 text-white px-2.5 rounded-r-lg border-l border-white/25 shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary';
    }
  });

  protected pick(format: ExportFormat): void {
    this.open.set(false);
    this.exportRequested.emit(format);
  }

  protected toggle(): void {
    if (!this.open()) this.placeMenu();
    this.open.update((v) => !v);
  }

  /** Right-align under the button, then clamp into the viewport with an 8px margin. */
  private placeMenu(): void {
    const margin = 8;
    const viewport = window.innerWidth;
    const width = Math.min(256, viewport - margin * 2);
    const rect = this.host.nativeElement.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.right - width, margin),
      viewport - width - margin,
    );
    this.menuWidth.set(width);
    this.menuLeft.set(left - rect.left);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
