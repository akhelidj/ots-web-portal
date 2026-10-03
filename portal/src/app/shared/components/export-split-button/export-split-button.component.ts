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

export type ExportFormat = 'pdf' | 'xlsx' | 'template';
export type ExportButtonVariant = 'customer' | 'header' | 'bar';

/**
 * Export as a split button: the main click downloads the filled PDF; the chevron opens
 * Excel (the filled workbook) and Template (the blank workbook with its tokens).
 *
 * `blocked` locks the two filled formats (not approved, required signature pending, …) and
 * `reason` says why — shown in the menu and as the tooltip. Template carries no report
 * data, so it only needs a connection. The chevron stays usable while blocked so the reason
 * and the Template option are always reachable.
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
  protected readonly templateDisabled = computed(
    () => this.isExporting() || !this.isOnline(),
  );

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
    this.open.update((v) => !v);
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
