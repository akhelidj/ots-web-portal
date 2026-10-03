/**
 * Transition-history timeline marker, DOM-level (#8) — rendered in the real zoneless DOM via
 * autoDetectChanges() + whenStable(), no manual detectChanges(). Asserts the reshaped marker:
 * a SQUARED badge (radius 0, `rounded-none`), NO glow/pulse shadow on ANY status (the old
 * per-status `shadow-[0_0_6px_…]` literals are gone), with the per-status fill semantics kept
 * and token-driven (bg-success / bg-primary / bg-warning / bg-gray-400).
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InspectionReportTransitionHistoryComponent } from './inspection-report-transition-history.component';
import { LocalTransitionLog } from '@portal/core/offline/models/types';

type Log = LocalTransitionLog & { userName?: string };

function log(toStatus: string): Log {
  return {
    id: `l-${toStatus}`,
    fromStatus: 'DRAFT',
    toStatus,
    timestamp: new Date(0).toISOString(),
    userName: 'Tester',
  } as unknown as Log;
}

describe('InspectionReportTransitionHistoryComponent — squared static marker (#8)', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(logs: Log[]) {
    TestBed.configureTestingModule({
      imports: [InspectionReportTransitionHistoryComponent],
    });
    const fixture: ComponentFixture<InspectionReportTransitionHistoryComponent> =
      TestBed.createComponent(InspectionReportTransitionHistoryComponent);
    fixture.componentInstance.logs = logs;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    return fixture;
  }

  /** The colored inner marker div for the single rendered timeline row. */
  const marker = (f: ComponentFixture<InspectionReportTransitionHistoryComponent>) =>
    (f.nativeElement as HTMLElement).querySelector(
      '.h-2.w-2',
    ) as HTMLElement | null;

  it('ON_HOLD marker is a squared badge with NO glow, filled from the warning token', async () => {
    const f = await render([log('ON_HOLD')]);
    const dot = marker(f)!;
    expect(dot).not.toBeNull();
    // Squared: radius 0, and the old round class is gone.
    expect(dot.classList.contains('rounded-none')).toBe(true);
    expect(dot.classList.contains('rounded-full')).toBe(false);
    // No glow/pulse: no arbitrary box-shadow utility survives on any state.
    expect(dot.className).not.toContain('shadow-[');
    // Fill semantics kept, token-driven.
    expect(dot.classList.contains('bg-warning')).toBe(true);
  });

  it('every status renders squared + glow-free with its token fill', async () => {
    const cases: [string, string][] = [
      ['APPROVED', 'bg-success'],
      ['CLOSED', 'bg-success'],
      ['IN_INSPECTION', 'bg-primary'],
      ['PENDING_APPROVAL', 'bg-primary'],
      ['ON_HOLD', 'bg-warning'],
      ['DRAFT', 'bg-gray-400'], // unmapped → neutral fallback
    ];
    for (const [status, fill] of cases) {
      const f = await render([log(status)]);
      const dot = marker(f)!;
      expect(dot.classList.contains('rounded-none')).toBe(true);
      expect(dot.className).not.toContain('shadow-[');
      expect(dot.classList.contains(fill)).toBe(true);
      TestBed.resetTestingModule();
    }
  });

  it('the outer marker ring is squared too and keeps its hover-scale affordance', async () => {
    const f = await render([log('ON_HOLD')]);
    const ring = (f.nativeElement as HTMLElement).querySelector(
      '.h-8.w-8',
    ) as HTMLElement;
    expect(ring.classList.contains('rounded-none')).toBe(true);
    expect(ring.classList.contains('rounded-full')).toBe(false);
    expect(ring.classList.contains('group-hover:scale-110')).toBe(true);
  });
});
