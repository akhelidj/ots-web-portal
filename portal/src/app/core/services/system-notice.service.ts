import { Injectable, effect, inject, signal } from '@angular/core';
import {
  SwUpdate,
  VersionReadyEvent,
  VersionEvent,
} from '@angular/service-worker';
import { filter } from 'rxjs';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { APP_VERSION } from '@portal/core/config/app-version';

type NoticeType = 'update' | 'offline' | 'online';

export interface SystemNotice {
  type: NoticeType;
  title: string;
  message: string;
  version: string;
  latestVersion?: string;
}

const CONNECTIVITY_NOTICE_DURATION_MS = 3200;
const CONNECTIVITY_NOTICE_COOLDOWN_MS = 10000;

@Injectable({ providedIn: 'root' })
export class SystemNoticeService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly connectivity = inject(ConnectivityService);

  public readonly notice = signal<SystemNotice | null>(null);

  private currentOnlineState = this.connectivity.isOnline();
  private connectivityInitialized = false;
  private connectivityTimer: number | null = null;
  private lastConnectivityNoticeAt = 0;
  private lastConnectivityNoticeType: 'online' | 'offline' | null = null;
  private latestNotifiedHash: string | null = null;

  constructor() {
    this.initUpdateMonitoring();
    this.initConnectivityMonitoring();
  }

  public dismissNotice(): void {
    if (this.notice()?.type === 'update') {
      this.notice.set(null);
      return;
    }

    this.clearConnectivityTimer();
    this.notice.set(null);
  }

  public async applyUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled) {
      window.location.reload();
      return;
    }

    try {
      await this.swUpdate.activateUpdate();
    } finally {
      window.location.reload();
    }
  }

  private initUpdateMonitoring(): void {
    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(
        filter(
          (event: VersionEvent): event is VersionReadyEvent =>
            event.type === 'VERSION_READY',
        ),
      )
      .subscribe((event) => {
        if (this.latestNotifiedHash === event.latestVersion.hash) {
          return;
        }

        this.latestNotifiedHash = event.latestVersion.hash;
        this.clearConnectivityTimer();

        this.notice.set({
          type: 'update',
          title: 'New Version Available',
          message:
            'A newer version of the app is ready. Refresh to keep data and workflows perfectly in sync.',
          version: APP_VERSION,
          latestVersion: this.resolveLatestVersionLabel(event),
        });
      });
  }

  private resolveLatestVersionLabel(event: VersionReadyEvent): string {
    const appData = event.latestVersion.appData;

    if (appData && typeof appData === 'object' && 'version' in appData) {
      const version = String((appData as { version?: unknown }).version ?? '');
      if (version.trim()) {
        return `v${version}`;
      }
    }

    return event.latestVersion.hash.slice(0, 7);
  }

  private initConnectivityMonitoring(): void {
    effect(() => {
      const isOnline = this.connectivity.isOnline();

      if (!this.connectivityInitialized) {
        this.currentOnlineState = isOnline;
        this.connectivityInitialized = true;
        return;
      }

      if (isOnline === this.currentOnlineState) {
        return;
      }

      this.currentOnlineState = isOnline;
      this.showConnectivityNotice(isOnline ? 'online' : 'offline');
    });
  }

  private showConnectivityNotice(type: 'online' | 'offline'): void {
    if (this.notice()?.type === 'update') {
      return;
    }

    const now = Date.now();
    const isSameTypeAsPrevious = this.lastConnectivityNoticeType === type;
    if (
      isSameTypeAsPrevious &&
      now - this.lastConnectivityNoticeAt < CONNECTIVITY_NOTICE_COOLDOWN_MS
    ) {
      return;
    }

    this.lastConnectivityNoticeAt = now;
    this.lastConnectivityNoticeType = type;
    this.clearConnectivityTimer();

    this.notice.set({
      type,
      title: type === 'online' ? 'Back Online' : 'You Are Offline',
      message:
        type === 'online'
          ? 'Connection restored. Sync and data refresh are active again.'
          : 'You can continue working. Changes will sync when connectivity returns.',
      version: APP_VERSION,
    });

    this.connectivityTimer = window.setTimeout(() => {
      if (this.notice()?.type === type) {
        this.notice.set(null);
      }
      this.clearConnectivityTimer();
    }, CONNECTIVITY_NOTICE_DURATION_MS);
  }

  private clearConnectivityTimer(): void {
    if (this.connectivityTimer !== null) {
      window.clearTimeout(this.connectivityTimer);
      this.connectivityTimer = null;
    }
  }
}
