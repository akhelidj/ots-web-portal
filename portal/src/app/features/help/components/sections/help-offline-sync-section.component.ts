import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-offline-sync-section',
  standalone: true,
  template: `
    <section class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm">
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Offline & Sync
      </p>
      <h2 class="mt-2 text-xl font-semibold tracking-tight text-neutral-900">
        Working safely with unstable network
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Offline Viewing:</strong> You can continue to view reports and navigate your workspace securely even if your connection drops.
          </li>
          <li>
            <strong>Data Freshness:</strong> The platform will automatically check for new report updates as soon as your device reconnects to the internet.
          </li>
          <li>
            <strong>Sync Status:</strong> Your connection health and last successful refresh time are visible at all times in the top navigation bar.
          </li>
        } @else {
          <li>
            <strong>Offline Queue:</strong> When offline, your local changes are securely stored in a persistent outbox for later synchronization.
          </li>
          <li>
            <strong>Reconnecting:</strong> When connection returns, sync is automatically scheduled and can also be triggered manually with the Sync button.
          </li>
          <li>
            <strong>Conflicts:</strong> If server conflicts or validation failures happen during upload, your items are flagged for explicit correction instead of silently overwritten.
          </li>
          <li>
            <strong>Status:</strong> Current offline status, pending item count, and last sync time are always visible in the top shell header.
          </li>
        }
      </ul>
    </section>
  `,
})
export class HelpOfflineSyncSectionComponent {
  @Input() role!: AppRole;
}
