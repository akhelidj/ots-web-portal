/**
 * Report timeline maths — pure functions over a report's status events. Shared by the
 * admin Metrics screen (aggregates across reports + the per-report timeline). Durations
 * are derived from the transition log only; nothing here is stored.
 */

export interface TimelineEvent {
  /** Status entered at `at`. */
  status: string;
  /** ISO timestamp (or anything `Date` parses). */
  at: string;
  id?: string;
}

export interface TimelineRow {
  id: string;
  status: string;
  at: string;
  /** Time since the previous event; null for the first. */
  took: number | null;
}

export interface TimelineStage {
  id: string;
  status: string;
  duration: number;
  /** Share of the closed stages' total time (0–1). */
  share: number;
}

export interface ReportTimelineSummary {
  /** Newest first. */
  rows: TimelineRow[];
  /** Closed stages, oldest first. The current (open-ended) stage is not a stage here. */
  stages: TimelineStage[];
  receivedAt: string | null;
  completedAt: string | null;
  /** Received → completed, once completed. */
  turnaround: number | null;
  /** Received → now, while not completed. */
  elapsed: number | null;
  current: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  DRAFT: 'Report created',
  RECEIVED: 'Pipe received',
  READY_FOR_CLEANING: 'Cleaning',
  READY_FOR_INSPECTION: 'Ready for inspection',
  IN_INSPECTION: 'Inspection in progress',
  PENDING_APPROVAL: 'Under review',
  APPROVED: 'Approved',
  ON_HOLD: 'On hold',
  CLOSED: 'Completed',
};

const STAGE_LABELS: Record<string, string> = {
  DRAFT: 'Created',
  RECEIVED: 'Received',
  READY_FOR_CLEANING: 'Cleaning',
  READY_FOR_INSPECTION: 'Ready',
  IN_INSPECTION: 'Inspection',
  PENDING_APPROVAL: 'Review',
  APPROVED: 'Approved',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
};

/** Workflow order, for listing stage averages in a stable sequence. */
export const STAGE_ORDER: readonly string[] = [
  'DRAFT',
  'RECEIVED',
  'READY_FOR_CLEANING',
  'READY_FOR_INSPECTION',
  'IN_INSPECTION',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
  'CLOSED',
];

const COMPLETED = new Set(['APPROVED', 'CLOSED']);

export function eventLabel(status: string): string {
  return EVENT_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function stageLabel(status: string): string {
  return STAGE_LABELS[status] ?? status.replace(/_/g, ' ');
}

/** "2 d 4 h" / "6 h 02 m" / "14 m" / "< 1 m" / "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '< 1 m';
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')} m`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Median of a list of numbers; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? null);
}

/**
 * Summarise one report's events (any order). `received` is the FIRST entry into RECEIVED,
 * `completed` the LATEST entry into APPROVED/CLOSED — the same milestones the report
 * detail shows.
 */
export function buildTimeline(
  input: readonly TimelineEvent[],
  now: number = Date.now(),
): ReportTimelineSummary {
  const events = input
    .map((e, i) => ({
      id: e.id ?? `${i}`,
      status: e.status,
      at: e.at,
      t: new Date(e.at).getTime(),
    }))
    .sort((a, b) => a.t - b.t);

  const rows: TimelineRow[] = events.map((e, i) => {
    const prev = events[i - 1];
    return { id: e.id, status: e.status, at: e.at, took: prev ? e.t - prev.t : null };
  });

  const closed = events.slice(0, -1).map((e, i) => {
    const next = events[i + 1];
    return { id: e.id, status: e.status, duration: next ? Math.max(0, next.t - e.t) : 0 };
  });
  const total = closed.reduce((sum, s) => sum + s.duration, 0);

  const received = events.find((e) => e.status === 'RECEIVED') ?? null;
  const completed = [...events].reverse().find((e) => COMPLETED.has(e.status)) ?? null;

  return {
    rows: rows.reverse(),
    stages: closed.map((s) => ({ ...s, share: total > 0 ? s.duration / total : 0 })),
    receivedAt: received?.at ?? null,
    completedAt: completed?.at ?? null,
    turnaround: received && completed ? completed.t - received.t : null,
    elapsed: received && !completed ? now - received.t : null,
    current: events[events.length - 1]?.status ?? null,
  };
}
