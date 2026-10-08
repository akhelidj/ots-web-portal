import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';
import { ReportTimelineComponent } from './report-timeline.component';
import {
  ReportTimelineSummary,
  STAGE_ORDER,
  TimelineEvent,
  buildTimeline,
  formatDuration,
  median,
  stageLabel,
} from './report-timeline';

/** `GET /metrics/reports` — one row per report with its raw status events. */
export interface ReportTimelineDto {
  id: string;
  reportNumber: string | null;
  poNumber: string;
  status: string;
  templateKey: string;
  customerName: string | null;
  serialCount: number;
  createdAt: string;
  events: { status: string; at: string }[];
}

export interface MetricsRow extends ReportTimelineDto {
  label: string;
  events: TimelineEvent[];
  timeline: ReportTimelineSummary;
  /** Turnaround when completed, else time so far (for sorting / display). */
  duration: number | null;
  slowest: { status: string; duration: number } | null;
}

type Period = '30' | '90' | '365' | 'all';
type SortKey = 'newest' | 'turnaround' | 'slowest';

/**
 * Admin Metrics: operational timing across every report in the tenant, plus a
 * per-report timeline. All durations are derived client-side from the transition log.
 */
@Component({
  selector: 'app-admin-metrics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ReportTimelineComponent],
  templateUrl: './admin-metrics.component.html',
})
export class AdminMetricsComponent implements OnInit {
  private readonly http = inject(HttpClient);

  public readonly loading = signal(true);
  public readonly error = signal('');
  private readonly reports = signal<MetricsRow[]>([]);

  public readonly customerFilter = signal('');
  public readonly period = signal<Period>('90');
  public readonly search = signal('');
  public readonly sort = signal<SortKey>('newest');
  public readonly selectedId = signal<string | null>(null);

  protected readonly formatDuration = formatDuration;
  protected readonly stageLabel = stageLabel;

  public readonly customers = computed(() =>
    [
      ...new Set(
        this.reports()
          .map((r) => r.customerName)
          .filter((n): n is string => !!n),
      ),
    ].sort(),
  );

  public readonly filtered = computed<MetricsRow[]>(() => {
    const customer = this.customerFilter();
    const q = this.search().trim().toLowerCase();
    const period = this.period();
    const since =
      period === 'all' ? null : Date.now() - Number(period) * 86_400_000;
    const rows = this.reports().filter(
      (r) =>
        (!customer || r.customerName === customer) &&
        (since === null || new Date(r.createdAt).getTime() >= since) &&
        (!q ||
          r.label.toLowerCase().includes(q) ||
          r.poNumber.toLowerCase().includes(q)),
    );
    const by = this.sort();
    return [...rows].sort((a, b) => {
      if (by === 'turnaround') return (b.duration ?? -1) - (a.duration ?? -1);
      if (by === 'slowest')
        return (b.slowest?.duration ?? -1) - (a.slowest?.duration ?? -1);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  });

  public readonly kpis = computed(() => {
    const rows = this.filtered();
    const turnarounds = rows
      .map((r) => r.timeline.turnaround)
      .filter((t): t is number => t !== null);
    const avg =
      turnarounds.length > 0
        ? turnarounds.reduce((s, t) => s + t, 0) / turnarounds.length
        : null;
    return {
      total: rows.length,
      completed: turnarounds.length,
      inProgress: rows.filter(
        (r) => r.timeline.turnaround === null && r.timeline.receivedAt,
      ).length,
      onHold: rows.filter((r) => r.status === 'ON_HOLD').length,
      medianTurnaround: median(turnarounds),
      avgTurnaround: avg,
      serials: rows.reduce((s, r) => s + r.serialCount, 0),
    };
  });

  /** Average time a report spends in each stage (across reports that passed through it). */
  public readonly stageAverages = computed(() => {
    const sums = new Map<string, { total: number; count: number }>();
    for (const r of this.filtered()) {
      const perReport = new Map<string, number>();
      for (const s of r.timeline.stages) {
        perReport.set(s.status, (perReport.get(s.status) ?? 0) + s.duration);
      }
      for (const [status, d] of perReport) {
        const acc = sums.get(status) ?? { total: 0, count: 0 };
        acc.total += d;
        acc.count += 1;
        sums.set(status, acc);
      }
    }
    const rows = STAGE_ORDER.filter((s) => sums.has(s)).map((status) => {
      const acc = sums.get(status) ?? { total: 0, count: 1 };
      return { status, avg: acc.total / acc.count, reports: acc.count };
    });
    const max = Math.max(0, ...rows.map((r) => r.avg));
    return rows.map((r) => ({ ...r, share: max > 0 ? r.avg / max : 0 }));
  });

  public readonly selected = computed(
    () => this.filtered().find((r) => r.id === this.selectedId()) ?? null,
  );

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  public async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(
        this.http.get<ReportTimelineDto[]>(
          `${environment.apiUrl}/metrics/reports`,
        ),
      );
      this.reports.set(data.map((d) => toRow(d)));
    } catch {
      this.error.set(
        'Metrics could not be loaded. They need a connection to the server.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  public select(id: string): void {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }
}

export function toRow(d: ReportTimelineDto): MetricsRow {
  const events: TimelineEvent[] = d.events.map((e, i) => ({
    id: `${d.id}-${i}`,
    status: e.status,
    at: e.at,
  }));
  const timeline = buildTimeline(events);
  const slowest = timeline.stages.reduce<{
    status: string;
    duration: number;
  } | null>(
    (best, s) =>
      !best || s.duration > best.duration
        ? { status: s.status, duration: s.duration }
        : best,
    null,
  );
  return {
    ...d,
    label: d.reportNumber || d.id.substring(0, 8).toUpperCase(),
    events,
    timeline,
    duration: timeline.turnaround ?? timeline.elapsed,
    slowest,
  };
}
