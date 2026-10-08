import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportLifecycleRailComponent } from './report-lifecycle-rail.component';

describe('ReportLifecycleRailComponent', () => {
  let fixture: ComponentFixture<ReportLifecycleRailComponent>;
  let component: ReportLifecycleRailComponent;

  const create = (
    status: string,
    logs: { toStatus: string; timestamp: string }[] = [],
    compact = false,
  ) => {
    fixture = TestBed.createComponent(ReportLifecycleRailComponent);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('logs', logs);
    fixture.componentRef.setInput('compact', compact);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportLifecycleRailComponent],
    }).compileComponents();
    // jsdom has no IntersectionObserver: the component then skips the intro and shows the end state.
    (
      window as unknown as { IntersectionObserver?: unknown }
    ).IntersectionObserver = undefined;
  });

  it('places the report at the stage matching its status', () => {
    create('IN_INSPECTION');
    expect(component.current()).toBe(4);
    expect(component.selectedStage().title).toBe('Inspection');
  });

  it('shows an on-hold report at the stage it was paused at', () => {
    create('ON_HOLD', [
      { toStatus: 'RECEIVED', timestamp: '2026-01-01T08:00:00Z' },
      { toStatus: 'IN_INSPECTION', timestamp: '2026-01-02T08:00:00Z' },
      { toStatus: 'ON_HOLD', timestamp: '2026-01-03T08:00:00Z' },
    ]);
    expect(component.onHold()).toBe(true);
    expect(component.current()).toBe(4);
  });

  it('records the latest time each stage was entered', () => {
    create('APPROVED', [
      { toStatus: 'PENDING_APPROVAL', timestamp: '2026-01-02T08:00:00Z' },
      { toStatus: 'PENDING_APPROVAL', timestamp: '2026-01-05T08:00:00Z' },
    ]);
    expect(component.reachedAt()[5]?.toISOString()).toBe(
      '2026-01-05T08:00:00.000Z',
    );
    expect(component.reachedAt()[0]).toBeNull();
  });

  it('lets the visitor pick a stage and keeps the current one marked', () => {
    create('PENDING_APPROVAL');
    component.select(1);
    fixture.detectChanges();
    expect(component.selected()).toBe(1);
    expect(component.current()).toBe(5);
    const current = fixture.nativeElement.querySelector(
      '[aria-current="step"]',
    );
    expect(current?.getAttribute('aria-label')).toContain('Under review');
  });

  it('renders eight stage buttons and no horizontal-scroll wrapper', () => {
    create('DRAFT');
    expect(fixture.nativeElement.querySelectorAll('button.node').length).toBe(
      8,
    );
  });

  it('renders pips only in compact mode', () => {
    create('APPROVED', [], true);
    expect(
      fixture.nativeElement.querySelectorAll('.rail-compact__pip').length,
    ).toBe(8);
    expect(fixture.nativeElement.querySelector('button.node')).toBeNull();
  });
});
