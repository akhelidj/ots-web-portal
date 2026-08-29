/**
 * Zoneless DOM-rendering regression for the Define-Template wizard.
 *
 * THE BUG THIS GUARDS: the app is zoneless. The component mutates state after
 * `await getTokens()`. If that state is not a signal, the GET 200s but nothing notifies the
 * zoneless scheduler, so the view stays stuck on "Loading tokens…" with the data in hand.
 * This spec RENDERS the component and relies ONLY on automatic, scheduler-driven change
 * detection — after the load settles it calls NO manual `detectChanges()`. A manual CD would
 * force the render the scheduler is supposed to do on its own, masking the very bug.
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

  it('leaves the loading state and renders the wizard after the async load settles — via the scheduler only', async () => {
    const getTokens = jest.fn().mockResolvedValue(TOKENS);
    const fixture = setup(getTokens);
    const html = () => fixture.nativeElement as HTMLElement;

    fixture.autoDetectChanges();
    expect(html().textContent).toContain('Loading tokens');

    // Deterministically wait for the fetch, then let the scheduler flush the CD the
    // component's signal writes scheduled. NO manual detectChanges().
    await fixture.componentInstance.load();
    await fixture.whenStable();

    // Stuck-loading no more: the wizard shows its FIRST step (Detect Tokens), always 4 steps.
    expect(html().textContent).not.toContain('Loading tokens');
    expect(html().textContent).toContain('Step 1 of 4');
    expect(html().textContent).toContain('Detect Tokens');
    // The read-only detect inventory renders every token.
    expect(html().querySelector('[data-testid="detect-count"]')?.textContent).toContain('2');
    expect(html().querySelector('[data-testid="detect-token-{{poNumber}}"]')).not.toBeNull();

    // Walk to the Metadata step the way a user does — a real "Next" click fires the zoneless
    // scheduler again (still NO manual detectChanges). The header grid appears only if that
    // scheduler-driven CD ran.
    (
      html().querySelector('[data-testid="wizard-next"]') as HTMLButtonElement
    ).click();
    await fixture.whenStable();

    expect(html().textContent).toContain('Step 2 of 4');
    const include = html().querySelector(
      '[data-testid="header-include-{{poNumber}}"]',
    ) as HTMLInputElement;
    expect(include).not.toBeNull();
    // Its label control is not built until the token is included — checking it in reveals
    // the inline describe controls purely through scheduler-driven CD.
    expect(html().querySelector('[data-testid="header-label-{{poNumber}}"]')).toBeNull();
    include.click();
    await fixture.whenStable();
    expect(html().querySelector('[data-testid="header-label-{{poNumber}}"]')).not.toBeNull();
  });
});
