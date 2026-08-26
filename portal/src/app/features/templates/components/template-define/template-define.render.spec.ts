/**
 * Phase D step 2b — zoneless DOM-rendering regression for the describe screen.
 *
 * THE BUG THIS GUARDS: the app is zoneless. TemplateDefineComponent used plain fields
 * (isLoading, rows, …) that were mutated after `await getTokens()`. The GET 200'd and
 * `isLoading` flipped to false, but nothing notified the zoneless scheduler, so the view
 * never re-rendered — the screen stayed stuck on "Loading tokens…" with the data already
 * in hand. The fix makes that async-driven state signals.
 *
 * WHY THE OLD SPEC MISSED IT: template-define.component.spec.ts asserts on component
 * fields directly (c.rows(), c.submitError()) and never renders the template, so it never
 * exercises change detection. This spec RENDERS the component and asserts the DOM, and —
 * critically — relies ONLY on automatic, scheduler-driven change detection: after the load
 * settles it calls NO manual `detectChanges()`. A manual CD would force the render the
 * zoneless scheduler is supposed to do on its own, masking the very bug under test. With
 * the fix's signals the scheduler runs CD and the rows appear; with the pre-fix plain
 * fields nothing is scheduled and the DOM stays on "Loading tokens…" (RED).
 */
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TemplateDefineComponent } from './template-define.component';
import {
  AdminTemplatesService,
  ExtractedToken,
} from '@portal/features/templates/services/admin-templates.service';

const TOKENS: ExtractedToken[] = [
  { token: '{{sn}}', cell: 'A2', row: 2 },
  { token: '{{poNumber}}', cell: 'B1', row: 1 },
];

describe('TemplateDefineComponent — zoneless DOM rendering (stuck-loading regression)', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(getTokens: jest.Mock) {
    TestBed.configureTestingModule({
      imports: [TemplateDefineComponent],
      providers: [
        {
          provide: AdminTemplatesService,
          useValue: { getTokens, defineTemplate: jest.fn() },
        },
        { provide: Router, useValue: { navigate: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    });
    return TestBed.createComponent(TemplateDefineComponent);
  }

  it('leaves the loading state and renders token rows after the async load settles — via the scheduler only', async () => {
    const getTokens = jest.fn().mockResolvedValue(TOKENS);
    const fixture = setup(getTokens);
    const html = () => fixture.nativeElement as HTMLElement;

    // Initial render (autoDetectChanges runs ngOnInit → load() and keeps CD driven by the
    // zoneless scheduler, exactly like the real app). The load has not settled yet.
    fixture.autoDetectChanges();
    expect(html().textContent).toContain('Loading tokens');

    // Deterministically wait for the fetch to finish, then let the scheduler flush the CD
    // that the component's signal writes scheduled. NO manual detectChanges() here — the
    // render must come from automatic, signal-driven change detection or not at all.
    await fixture.componentInstance.load();
    await fixture.whenStable();

    // The loading branch is gone: the wizard now shows its FIRST step (Layout). The screen
    // is stuck-loading no more — and this is the exact regression under test: nothing was
    // stuck on "Loading tokens…" with the data already in hand. Neither the disappearance
    // of the loading branch nor the wizard chrome is true unless a change-detection pass
    // ran automatically after the load settled.
    expect(html().textContent).not.toContain('Loading tokens');
    expect(html().textContent).toContain('Step 1 of 3'); // flat default → 3 steps
    expect(
      html().querySelector('[data-testid="has-repeating-rows"]'),
    ).not.toBeNull();

    // The per-token describe grid lives on the DESCRIBE step. Walk there the way a user
    // does — a real click on "Next" — which fires the zoneless scheduler again (still NO
    // manual detectChanges). The rows appear only if that scheduler-driven CD ran.
    (
      html().querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(html().textContent).toContain('Step 2 of 3');
    expect(
      html().querySelector('[data-testid="label-{{poNumber}}"]'),
    ).not.toBeNull();
    expect(
      html().querySelector('[data-testid="type-{{poNumber}}"]'),
    ).not.toBeNull();
  });
});
