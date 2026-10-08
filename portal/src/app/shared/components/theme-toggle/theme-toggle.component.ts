import { Component, inject } from '@angular/core';
import { ThemeService } from '@portal/core/theme/theme.service';

/**
 * Light / dark switch for the customer experience: a sliding two-icon control that is always
 * on screen (header on desktop, header bar on tablet and phone). Renders nothing for other roles.
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  template: `
    @if (theme.available()) {
      <button
        type="button"
        class="theme-switch"
        role="switch"
        [attr.aria-checked]="theme.mode() === 'dark'"
        [attr.aria-label]="
          theme.mode() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
        "
        [attr.data-mode]="theme.mode()"
        (click)="theme.toggle()"
        data-testid="theme-toggle"
      >
        <span class="theme-switch__thumb" aria-hidden="true"></span>
        <svg class="theme-switch__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <svg class="theme-switch__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>
    }
  `,
  styles: [
    `
      .theme-switch {
        position: relative;
        display: inline-grid;
        grid-template-columns: 1fr 1fr;
        align-items: center;
        width: 4.4rem;
        height: 2.5rem;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.35);
        background: transparent;
        color: #ffffff;
        cursor: pointer;
        transition: border-color 0.5s var(--ease-standard);
      }
      .theme-switch:hover {
        border-color: var(--accent-hover);
      }
      .theme-switch:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 3px;
      }
      .theme-switch__thumb {
        position: absolute;
        top: 2px;
        bottom: 2px;
        left: 2px;
        width: calc(50% - 2px);
        background: var(--accent);
        transition: transform 0.55s var(--ease-decelerate);
      }
      .theme-switch[data-mode='dark'] .theme-switch__thumb {
        transform: translateX(100%);
      }
      .theme-switch__icon {
        position: relative;
        z-index: 1;
        justify-self: center;
        width: 1.05rem;
        height: 1.05rem;
        transition: color 0.4s var(--ease-standard);
      }
      /* The icon under the thumb takes the ink colour; the other stays light. */
      .theme-switch[data-mode='light'] .theme-switch__icon:first-of-type,
      .theme-switch[data-mode='dark'] .theme-switch__icon:last-of-type {
        color: var(--on-accent);
      }
    `,
  ],
})
export class ThemeToggleComponent {
  public readonly theme = inject(ThemeService);
}
