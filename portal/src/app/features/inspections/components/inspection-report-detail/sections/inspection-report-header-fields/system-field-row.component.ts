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
      class="flex flex-col gap-0.5"
      [attr.data-testid]="'system-field-' + fieldKey()"
    >
      <span class="flex items-center gap-2">
        <span class="text-xs text-gray-500">{{ label() }}</span>
        @if (!isCustomer()) {
          <span
            class="text-[10px] font-medium tracking-wide text-gray-400"
            [attr.data-testid]="'system-badge-' + fieldKey()"
            >System</span
          >
        }
      </span>

      @if (value()?.pending) {
        <span
          class="text-sm font-medium text-gray-400 italic tabular-nums"
          [attr.data-testid]="'system-value-' + fieldKey()"
        >
          {{ value()?.pendingLabel }}
        </span>
      } @else {
        <span
          class="text-sm font-semibold text-neutral-900 tabular-nums"
          [attr.data-testid]="'system-value-' + fieldKey()"
        >
          {{ value()?.value }}
        </span>
      }

      @if (!isCustomer()) {
        <span class="text-[11px] text-gray-400">{{ value()?.source }}</span>
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
   * Customer document surface flag. Default `false` keeps the ops rendering — a
   * quiet "System" marker plus the technical source note. `true` (the customer
   * surface) drops BOTH: a customer sees only the derived value, never the marker
   * or where it came from.
   */
  isCustomer = input<boolean>(false);
}
