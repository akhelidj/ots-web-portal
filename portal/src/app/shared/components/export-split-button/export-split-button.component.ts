import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  viewChild,
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
 * The menu is a top-layer popover clamped to the viewport on both axes (it flips above the
 * button when there is no room below), so it is never clipped, covered or off-screen.
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
  /** Viewport coordinates: the menu is a top-layer popover, positioned against the viewport. */
  protected readonly menuLeft = signal(0);
  protected readonly menuTop = signal(0);

  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    // Show the menu in the top layer once rendered: no ancestor's overflow, z-index or
    // transform can clip or cover it. Then fit it vertically (flip above when no room below).
    effect((onCleanup) => {
      const el = this.menu()?.nativeElement;
      if (!el) return;
      if (
        typeof el.showPopover === 'function' &&
        !el.matches(':popover-open')
      ) {
        el.showPopover();
      }
      this.fitVertically(el);

      // A viewport-fixed menu would drift from its button on scroll/resize: close instead.
      const close = (event: Event) => {
        if (event.type === 'scroll' && el.contains(event.target as Node))
          return;
        this.open.set(false);
      };
      window.addEventListener('scroll', close, {
        capture: true,
        passive: true,
      });
      window.addEventListener('resize', close);
      onCleanup(() => {
        window.removeEventListener('scroll', close, { capture: true });
        window.removeEventListener('resize', close);
      });
    });
  }

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

  private static readonly MARGIN = 8;
  private static readonly GAP = 4;

  /** Right-align under the button, clamped into the viewport with an 8px margin. */
  private placeMenu(): void {
    const margin = ExportSplitButtonComponent.MARGIN;
    const viewport = window.innerWidth;
    const width = Math.min(256, viewport - margin * 2);
    const rect = this.host.nativeElement.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.right - width, margin),
      viewport - width - margin,
    );
    this.menuWidth.set(width);
    this.menuLeft.set(left);
    this.menuTop.set(rect.bottom + ExportSplitButtonComponent.GAP);
  }

  /**
   * Below the button by default; above it for the bottom bar or when there is no room below.
   * Clamped so the whole menu stays on screen either way.
   */
  private fitVertically(el: HTMLElement): void {
    const { MARGIN, GAP } = ExportSplitButtonComponent;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const height = el.offsetHeight;
    const viewportH = window.innerHeight;
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const fitsBelow = below + height <= viewportH - MARGIN;
    const preferAbove =
      this.variant() === 'bar' || (!fitsBelow && above >= MARGIN);
    const top = preferAbove ? above : below;
    this.menuTop.set(
      Math.max(MARGIN, Math.min(top, viewportH - height - MARGIN)),
    );
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (
      this.open() &&
      !this.host.nativeElement.contains(event.target as Node)
    ) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
