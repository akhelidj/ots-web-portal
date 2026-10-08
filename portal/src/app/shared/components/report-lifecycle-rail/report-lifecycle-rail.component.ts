import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  INSPECTOR_IMAGE_KEY,
  ReportSignatureField,
  ReportSignatureStates,
  ReportSignaturesService,
} from '@portal/features/inspections/services/report-signatures.service';

/** A signature card on a stage panel: the real signature image when one exists. */
export interface StageSignature {
  key: string;
  label: string;
  role: string;
  signed: boolean;
  signedAt: string | null;
  signedByName: string | null;
  /** The field the visitor can sign right now (customer fields on an approved report). */
  field: ReportSignatureField | null;
}

/** One stage of the customer-facing report lifecycle. */
export interface LifecycleStage {
  readonly status: string;
  readonly label: string;
  readonly title: string;
  readonly body: string;
}

/** Customer-facing lifecycle: the report workflow in plain language (internal-only steps hidden). */
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  {
    status: 'DRAFT',
    label: 'Draft',
    title: 'Report opened',
    body: 'A report is opened for your purchase order.',
  },
  {
    status: 'RECEIVED',
    label: 'Received',
    title: 'Tubulars received',
    body: 'Your tubulars have arrived at our facility and are logged.',
  },
  {
    status: 'READY_FOR_CLEANING',
    label: 'Cleaning',
    title: 'Cleaning',
    body: 'Tubulars are cleaned and prepared for inspection.',
  },
  {
    status: 'READY_FOR_INSPECTION',
    label: 'Ready',
    title: 'Ready for inspection',
    body: 'Cleaned and staged, waiting for the inspector.',
  },
  {
    status: 'IN_INSPECTION',
    label: 'Inspection',
    title: 'Inspection',
    body: 'Every serial is inspected and given a result.',
  },
  {
    status: 'PENDING_APPROVAL',
    label: 'Review',
    title: 'Under review',
    body: 'A supervisor reviews the inspection results.',
  },
  {
    status: 'APPROVED',
    label: 'Approved',
    title: 'Approved',
    body: 'Results are approved and signed off. You can sign and export the report.',
  },
  {
    status: 'CLOSED',
    label: 'Closed',
    title: 'Completed',
    body: 'The report is complete and locked.',
  },
];

export interface LifecycleLog {
  toStatus: string;
  timestamp: string | number | Date;
}

const STEP_MS = 420;

/**
 * The TrackLine lifecycle rail, driven by a real report. Full mode shows the eight stages, a
 * panel for the selected stage (when it was reached, plus signatures on the approved / closed
 * stages) and plays a one-time intro that fills the rail up to the report's current stage.
 * Compact mode is the row-level version: eight pips and the current stage name.
 */
@Component({
  selector: 'app-report-lifecycle-rail',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './report-lifecycle-rail.component.html',
  styleUrl: './report-lifecycle-rail.component.scss',
})
export class ReportLifecycleRailComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly signatureService = inject(ReportSignaturesService);

  public readonly status = input.required<string>();
  public readonly logs = input<readonly LifecycleLog[]>([]);
  public readonly signatures = input<ReportSignatureStates | null>(null);
  public readonly reportId = input<string | null>(null);
  /** Customer chose "Sign now" on a pending signature card. */
  public readonly signRequested = output<ReportSignatureField>();
  /** Real signature images (object URLs) by key. */
  public readonly images = signal<Record<string, string>>({});
  public readonly serialCount = input<number | null>(null);
  public readonly compact = input<boolean>(false);

  public readonly stages = LIFECYCLE_STAGES;
  public readonly last = LIFECYCLE_STAGES.length - 1;

  /** True when the report is paused; the rail then shows the stage it was paused at. */
  public readonly onHold = computed(() => this.status() === 'ON_HOLD');

  /** Index of the stage the report is at (the last stage reached before a hold). */
  public readonly current = computed(() => {
    const status = this.status();
    if (status === 'ON_HOLD') {
      const logs = [...this.logs()]
        .filter((l) => l.toStatus !== 'ON_HOLD')
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      const idx = this.indexOf(logs[0]?.toStatus);
      return idx >= 0 ? idx : 4;
    }
    return Math.max(this.indexOf(status), 0);
  });

  /** Latest time each stage was entered, by stage index. */
  public readonly reachedAt = computed(() => {
    const out: (Date | null)[] = this.stages.map(() => null);
    for (const log of this.logs()) {
      const idx = this.indexOf(log.toStatus);
      if (idx < 0) continue;
      const t = new Date(log.timestamp);
      if (!out[idx] || t > (out[idx] as Date)) out[idx] = t;
    }
    return out;
  });

  /** Stage chosen by the visitor; falls back to the current stage. */
  private readonly picked = signal<number | null>(null);
  public readonly selected = computed(() => this.picked() ?? this.current());
  public readonly selectedStage = computed(
    () => (this.stages[this.selected()] ?? this.stages[0]) as LifecycleStage,
  );

  /** How far the intro has revealed the rail (-1 = nothing yet). */
  public readonly shown = signal(-1);
  public readonly revealed = computed(() =>
    Math.min(this.shown(), this.current()),
  );
  public readonly fillPercent = computed(
    () => (Math.max(this.revealed(), 0) / this.last) * 100,
  );

  /** Keys whose image could not be fetched: shown as "on file" instead of loading forever. */
  public readonly failed = signal<Record<string, boolean>>({});
  private requested = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private observer: IntersectionObserver | null = null;
  private played = false;

  constructor() {
    // Fetch the real signature images once their stage is on screen.
    effect(() => {
      const id = this.reportId();
      const states = this.signatures();
      if (!id || !states || this.compact()) return;
      const wanted = [
        ...(states.inspector?.signed ? [INSPECTOR_IMAGE_KEY] : []),
        ...states.fields.filter((f) => f.signed).map((f) => f.key),
      ];
      for (const key of wanted) {
        const signedAt = states.fields.find((f) => f.key === key)?.signedAt ?? '';
        const token = `${id}:${key}:${states.revisionNumber}:${signedAt}`;
        if (this.requested.has(token)) continue;
        this.requested.add(token);
        this.signatureService
          .getImageUrl(id, key)
          .then((url) => {
            const prev = this.images()[key];
            if (prev) URL.revokeObjectURL(prev);
            this.images.update((m) => ({ ...m, [key]: url }));
          })
          .catch(() => this.failed.update((m) => ({ ...m, [key]: true })));
      }
    });
  }

  public ngAfterViewInit(): void {
    if (this.compact()) {
      this.shown.set(this.last);
      return;
    }
    const reduce = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      this.shown.set(this.last);
      return;
    }
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) this.playIntro();
      },
      { threshold: 0.3 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  public ngOnDestroy(): void {
    Object.values(this.images()).forEach((u) => URL.revokeObjectURL(u));
    this.stopIntro();
    this.observer?.disconnect();
  }

  public select(index: number): void {
    this.stopIntro();
    this.shown.set(this.last);
    this.picked.set(index);
  }

  public stageState(index: number): 'done' | 'active' | 'todo' {
    const revealed = this.revealed();
    if (index < revealed) return 'done';
    if (index === revealed) return 'active';
    return 'todo';
  }

  public isReached(index: number): boolean {
    return index <= this.current();
  }

  /** Signatures shown on a stage: the inspector's on review; supervisor + customer from approval. */
  public signaturesFor(index: number): StageSignature[] {
    const states = this.signatures();
    if (!states || index < 5) return [];
    const out: StageSignature[] = [];
    const ins = states.inspector;
    if (ins?.signed) {
      out.push({
        key: INSPECTOR_IMAGE_KEY,
        label: 'Inspector',
        role: 'Submitted for review',
        signed: true,
        signedAt: ins.signedAt,
        signedByName: ins.signedByName,
        field: null,
      });
    }
    if (index >= 6) {
      for (const f of states.fields) {
        out.push({
          key: f.key,
          label: f.label,
          role: f.signer === 'CUSTOMER' ? 'Customer' : 'Supervisor',
          signed: f.signed,
          signedAt: f.signedAt,
          signedByName: f.signedByName,
          field:
            states.signable && f.signer === 'CUSTOMER' && !f.signed ? f : null,
        });
      }
    }
    return out;
  }

  private playIntro(): void {
    if (this.played) return;
    this.played = true;
    this.observer?.disconnect();
    this.shown.set(0);
    const target = this.current();
    if (target <= 0) return;
    this.timer = setInterval(() => {
      const next = this.shown() + 1;
      this.shown.set(next);
      if (next >= target) this.stopIntro();
    }, STEP_MS);
  }

  private stopIntro(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private indexOf(status: string | undefined): number {
    return this.stages.findIndex((s) => s.status === status);
  }
}
