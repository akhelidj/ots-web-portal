import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocalCustomer } from '@portal/core/offline/models/types';
import { brandPalette, isBrandColor } from '@portal/core/theme/brand-palette';
import { AdminCustomersService } from '@portal/features/customers/services/admin-customers.service';

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Admin: a customer's portal branding — optional logo and brand colour. Online-only.
 * The preview renders the customer's header and a card in both themes from the exact
 * palette their portal will use (brand-palette.ts), so what the admin sees is what the
 * customer gets.
 */
@Component({
  selector: 'app-customer-branding-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './customer-branding-panel.component.html',
  styles: [
    `
      /* Stock customer-theme surfaces; the palette's inline vars override them. */
      .brand-preview {
        --background: #f7f9fb;
        --card: #ffffff;
        --foreground: #0f2741;
        --muted-foreground: #55657a;
        --nav-bg: #0f2741;
        --border: rgba(15, 39, 65, 0.16);
        overflow: hidden;
        border: 1px solid var(--border);
        background: var(--background);
        color: var(--foreground);
        font-size: 0.75rem;
      }
      .brand-preview[data-mode='dark'] {
        --background: #0a1a2e;
        --card: #0f2741;
        --foreground: #f7f9fb;
        --muted-foreground: #aebbcc;
        --nav-bg: #08182b;
        --border: rgba(255, 255, 255, 0.16);
      }
      .brand-preview__nav {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        height: 2.5rem;
        padding: 0 0.75rem;
        background: var(--nav-bg);
        color: #ffffff;
      }
      .brand-preview__logo {
        height: 1.6rem;
        max-width: 5rem;
        padding: 0.15rem;
        background: rgba(255, 255, 255, 0.96);
        object-fit: contain;
      }
      .brand-preview__name {
        font-family: var(--font-mono, monospace);
        font-size: 0.62rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .brand-preview__avatar {
        margin-left: auto;
        display: grid;
        place-items: center;
        width: 1.5rem;
        height: 1.5rem;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.1);
        font-family: var(--font-mono, monospace);
        font-size: 0.55rem;
      }
      .brand-preview__body {
        padding: 0.75rem;
      }
      .brand-preview__eyebrow {
        margin-bottom: 0.5rem;
        color: var(--accent-text);
        font-family: var(--font-mono, monospace);
        font-size: 0.6rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .brand-preview__card {
        display: grid;
        gap: 0.25rem;
        padding: 0.5rem;
        border: 1px solid var(--border);
        background: var(--card);
      }
      .brand-preview__row {
        padding: 0.35rem 0.5rem;
        color: var(--foreground);
      }
      .brand-preview__row.is-selected {
        box-shadow: inset 2px 0 0 var(--accent);
        background: rgb(var(--accent-rgb) / 0.1);
      }
      .brand-preview__btn {
        justify-self: end;
        margin-top: 0.25rem;
        padding: 0.3rem 0.8rem;
        background: var(--accent);
        color: var(--on-accent);
        font-weight: 600;
        cursor: default;
      }
    `,
  ],
})
export class CustomerBrandingPanelComponent implements OnInit, OnDestroy {
  private readonly service = inject(AdminCustomersService);

  public readonly customer = input.required<LocalCustomer>();
  public readonly closed = output<void>();

  /** The latest server copy (its version moves on with every save). */
  public readonly current = signal<LocalCustomer | null>(null);
  public readonly useColor = signal(false);
  public readonly color = signal('#1d6fb8');
  public readonly logoUrl = signal<string | null>(null);
  public readonly busy = signal(false);
  public readonly error = signal('');
  public readonly notice = signal('');

  public readonly effectiveColor = computed(() =>
    this.useColor() && isBrandColor(this.color()) ? this.color() : null,
  );
  public readonly lightPreview = computed(() => brandPalette(this.effectiveColor(), 'light'));
  public readonly darkPreview = computed(() => brandPalette(this.effectiveColor(), 'dark'));

  public readonly colorDirty = computed(() => {
    const saved = this.current()?.brandColor ?? null;
    return (saved?.toLowerCase() ?? null) !== (this.effectiveColor()?.toLowerCase() ?? null);
  });

  ngOnInit(): void {
    const c = this.customer();
    this.current.set(c);
    if (isBrandColor(c.brandColor)) {
      this.useColor.set(true);
      this.color.set(c.brandColor.toLowerCase());
    }
    if (c.logoKey) void this.loadLogo(c);
  }

  ngOnDestroy(): void {
    this.setLogoUrl(null);
  }

  public onHexInput(value: string): void {
    const v = value.trim();
    this.color.set(v.startsWith('#') ? v : `#${v}`);
  }

  public async saveColor(): Promise<void> {
    const c = this.current();
    if (!c) return;
    if (this.useColor() && !isBrandColor(this.color())) {
      this.error.set('Enter a colour as #rrggbb.');
      return;
    }
    await this.run(async () => {
      this.current.set(await this.service.setBrandColor(c, this.effectiveColor()));
      this.notice.set(this.effectiveColor() ? 'Brand colour saved.' : 'Brand colour removed.');
    });
  }

  public async onLogoSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    const c = this.current();
    if (!file || !c) return;
    if (!LOGO_TYPES.includes(file.type)) {
      this.error.set('The logo must be a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      this.error.set('The logo must be 1 MB or smaller.');
      return;
    }
    await this.run(async () => {
      const updated = await this.service.uploadLogo(c, file);
      this.current.set(updated);
      this.setLogoUrl(URL.createObjectURL(file));
      this.notice.set('Logo uploaded.');
    });
  }

  public async removeLogo(): Promise<void> {
    const c = this.current();
    if (!c) return;
    await this.run(async () => {
      this.current.set(await this.service.removeLogo(c));
      this.setLogoUrl(null);
      this.notice.set('Logo removed.');
    });
  }

  private async loadLogo(c: LocalCustomer): Promise<void> {
    try {
      this.setLogoUrl(await this.service.fetchLogoUrl(c));
    } catch {
      /* missing object — the panel just shows no preview */
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(this.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  private describe(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Branding needs a connection to the server.';
      if (error.status === 409) {
        return 'This customer was changed elsewhere. Close this panel and reopen it to get the latest version.';
      }
      const message = (error.error as { message?: string | string[] } | null)?.message;
      if (message) return Array.isArray(message) ? message.join(' ') : message;
    }
    return 'Branding could not be saved.';
  }

  private setLogoUrl(url: string | null): void {
    const previous = this.logoUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.logoUrl.set(url);
  }
}
