import { buildTimeline, formatDuration, median } from './report-timeline';
import { toRow } from './admin-metrics.component';

const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();

describe('report timeline', () => {
  it('derives step durations, time-in-stage and turnaround (events in any order)', () => {
    const t = buildTimeline([
      { id: 'l3', status: 'APPROVED', at: at(9) },
      { id: 'l1', status: 'RECEIVED', at: at(1) },
      { id: 'l2', status: 'IN_INSPECTION', at: at(3) },
    ]);

    expect(t.rows.map((r) => [r.status, formatDuration(r.took)])).toEqual([
      ['APPROVED', '6 h 00 m'],
      ['IN_INSPECTION', '2 h 00 m'],
      ['RECEIVED', '—'],
    ]);
    expect(t.stages.map((s) => [s.status, s.share])).toEqual([
      ['RECEIVED', 0.25],
      ['IN_INSPECTION', 0.75],
    ]);
    expect(t.turnaround).toBe(8 * 3_600_000);
    expect(t.elapsed).toBeNull();
    expect(t.current).toBe('APPROVED');
  });

  it('reports elapsed time while a report is not completed', () => {
    const t = buildTimeline([{ status: 'RECEIVED', at: at(1) }], Date.parse(at(5)));
    expect(t.turnaround).toBeNull();
    expect(t.elapsed).toBe(4 * 3_600_000);
  });

  it('formats durations and computes medians', () => {
    expect(formatDuration(26 * 3_600_000)).toBe('1 d 2 h');
    expect(formatDuration(30_000)).toBe('< 1 m');
    expect(formatDuration(null)).toBe('—');
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('maps an API row to a metrics row with its longest stage', () => {
    const row = toRow({
      id: 'abcdef1234',
      reportNumber: null,
      poNumber: 'PO-1',
      status: 'APPROVED',
      templateKey: 'drill-pipe',
      customerName: 'ACME',
      serialCount: 3,
      createdAt: at(0),
      events: [
        { status: 'RECEIVED', at: at(1) },
        { status: 'IN_INSPECTION', at: at(3) },
        { status: 'APPROVED', at: at(9) },
      ],
    });
    expect(row.label).toBe('ABCDEF12');
    expect(row.duration).toBe(8 * 3_600_000);
    expect(row.slowest).toEqual({ status: 'IN_INSPECTION', duration: 6 * 3_600_000 });
  });
});
