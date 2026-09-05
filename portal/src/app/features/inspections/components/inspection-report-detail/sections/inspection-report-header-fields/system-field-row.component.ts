import { Component, input } from '@angular/core';
import { SystemRoleValue } from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * The read-only row for a SYSTEM-owned (roled) header field. Shared by BOTH header
 * surfaces — the read-only Specs tab and the header-EDIT form — so they render an
 * identical, non-editable presentation and can never diverge. It shows the field label
 * with a static "System" badge, the derived value (or a neutral pending message naming
 * what it waits on), and a one-line note of where the value comes from.
 *
 * Presentational only: no input, no control, nothing emitted on save.
 *
 * Customer surfaces (`isCustomer()`) show NEITHER the "System" marker NOR the
 * technical source note — a customer never sees where a value is derived from,
 * only the value. Ops keeps a quiet, de-chromed "System" marker (a small muted
 * label, no border/chip/uppercase) plus the source note.
 */
@Component({
  selector: 'app-system-field-row',
  standalone: true,
  imports: [],
  template: `
    <div
      class="flex items-start justify-between gap-4"
      [attr.data-testid]="'system-field-' + fieldKey()"
    >
      <span class="flex flex-col gap-0.5">
        <span class="flex items-center gap-2">
          <span class="text-sm text-gray-500">{{ label() }}</span>
          @if (!isCustomer()) {
            <span
              class="text-[10px] font-medium tracking-wide text-gray-400"
              [attr.data-testid]="'system-badge-' + fieldKey()"
              >System</span
            >
          }
        </span>
        @if (!isCustomer()) {
          <span class="text-xs text-gray-400">{{ value()?.source }}</span>
        }
      </span>

      @if (value()?.pending) {
        <span
          class="text-sm font-medium text-gray-400 text-right italic"
          [attr.data-testid]="'system-value-' + fieldKey()"
        >
          {{ value()?.pendingLabel }}
        </span>
      } @else {
        <span
          class="text-sm font-bold text-neutral-900 text-right"
          [attr.data-testid]="'system-value-' + fieldKey()"
        >
          {{ value()?.value }}
        </span>
      }
    </div>
  `,
})
export class SystemFieldRowComponent {
  /** The field key — drives the row/value/badge test ids. */
  fieldKey = input.required<string>();
  /** The field's display label (from the definition). */
  label = input.required<string>();
  /** The derived value for this role (undefined → treated as pending-less blank). */
  value = input<SystemRoleValue | undefined>(undefined);
  /**
   * Customer document surface flag. Default `false` keeps the shared ops
   * rendering (Barlow Condensed "System" badge) byte-identical; `true` renders
   * the badge label in IBM Plex to match the customer surface.
   */
  isCustomer = input<boolean>(false);
}
