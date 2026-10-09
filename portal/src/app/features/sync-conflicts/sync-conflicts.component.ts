import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  ConflictComparison,
  ConflictGroup,
  ConflictResolutionService,
} from '@portal/core/offline/conflicts/conflict-resolution.service';
import {
  FieldDifference,
  Side,
  pathLabel,
} from '@portal/core/offline/conflicts/conflict-merge';
import { SyncOrchestratorService } from '@portal/core/offline/services/sync-orchestrator.service';

interface GroupView {
  group: ConflictGroup;
  label: string;
}

@Component({
  selector: 'app-sync-conflicts',
  standalone: true,
  templateUrl: './sync-conflicts.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncConflictsComponent implements OnInit {
  private resolver = inject(ConflictResolutionService);
  private orchestrator = inject(SyncOrchestratorService);

  public readonly views = signal<GroupView[]>([]);
  public readonly loading = signal(true);
  public readonly loadError = signal<string | null>(null);

  /** The conflict currently open for field-by-field review. */
  public readonly reviewing = signal<string | null>(null);
  public readonly comparison = signal<ConflictComparison | null>(null);
  public readonly choices = signal<Record<string, Side>>({});
  public readonly comparing = signal(false);
  public readonly busyId = signal<string | null>(null);
  public readonly actionError = signal<string | null>(null);

  public async ngOnInit(): Promise<void> {
    await this.reload();
  }

  public async reload(): Promise<void> {
    this.loadError.set(null);
    try {
      const groups = await this.resolver.listGroups();
      const views = await Promise.all(
        groups.map(async (group) => ({
          group,
          label: await this.resolver.recordLabel(group),
        })),
      );
      this.views.set(views);
    } catch {
      this.loadError.set('Could not read the queued changes. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  public choiceFor(diff: FieldDifference): Side {
    return this.choices()[diff.id] ?? 'mine';
  }

  public choose(diff: FieldDifference, side: Side): void {
    this.choices.update((c) => ({ ...c, [diff.id]: side }));
  }

  public label(diff: FieldDifference): string {
    return pathLabel(diff.path);
  }

  public show(value: unknown): string {
    if (value === undefined) return '(empty)';
    if (value === null || value === '') return '(empty)';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return JSON.stringify(value);
  }

  public async review(view: GroupView): Promise<void> {
    this.actionError.set(null);
    this.comparison.set(null);
    this.choices.set({});
    this.reviewing.set(view.group.root.id);
    this.comparing.set(true);
    try {
      this.comparison.set(await this.resolver.compare(view.group));
    } catch {
      this.actionError.set(
        "Couldn't load the server's version. Check your connection and try again.",
      );
    } finally {
      this.comparing.set(false);
    }
  }

  public closeReview(): void {
    this.reviewing.set(null);
    this.comparison.set(null);
    this.actionError.set(null);
  }

  public applyMine(view: GroupView): Promise<void> {
    const comparison = this.comparison();
    if (!comparison) return Promise.resolve();
    return this.run(view, () =>
      this.resolver.keepMine(view.group, comparison, this.choices()),
    );
  }

  public keepServer(view: GroupView): Promise<void> {
    return this.run(view, () => this.resolver.keepServer(view.group));
  }

  public retry(view: GroupView): Promise<void> {
    return this.run(view, () => this.resolver.retry(view.group));
  }

  private async run(
    view: GroupView,
    action: () => Promise<void>,
  ): Promise<void> {
    this.actionError.set(null);
    this.busyId.set(view.group.root.id);
    try {
      await action();
      this.closeReview();
      await this.reload();
      void this.orchestrator.syncNow();
    } catch {
      this.actionError.set(
        "That didn't go through. Nothing was lost; check your connection and try again.",
      );
    } finally {
      this.busyId.set(null);
    }
  }
}
