import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LocalSerialNumber,
  ReportStatistic,
} from '@portal/core/offline/models/types';

/** One editable row in the statistics editor. `serialsOpen`/`filter` are UI-only. */
interface StatisticDraft {
  id: string;
  label: string;
  value: string;
  serials: string[];
  serialsOpen: boolean;
  filter: string;
}

/**
 * Free-entry report statistics: the inspector types a label + value (and optionally picks
 * the serials it concerns) — nothing here is computed. A card with serials is clickable and
 * emits the statistic so the parent can open the serials modal; a card without is static.
 * `variant` only changes the chrome (ops cards vs. the customer document grid); the data
 * and behaviour are identical. The editor saves the WHOLE list at once.
 */
@Component({
  selector: 'app-report-statistics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-statistics.component.html',
  host: { class: 'block w-full' },
})
export class ReportStatisticsComponent {
  @Input() statistics: ReportStatistic[] = [];
  /** The report's serials — the pool the editor's serial picker draws from. */
  @Input() serials: LocalSerialNumber[] = [];
  @Input() editable = false;
  @Input() variant: 'ops' | 'customer' = 'ops';
  /**
   * Persists the whole list; resolves to an error message, or `null` on success. The
   * editor stays open (with the message) on failure so the typed rows are never lost.
   */
  @Input() persist: (list: ReportStatistic[]) => Promise<string | null> = () =>
    Promise.resolve(null);

  @Output() statisticOpen = new EventEmitter<ReportStatistic>();

  protected readonly editing = signal(false);
  protected readonly draft = signal<StatisticDraft[]>([]);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');

  /** A plain getter, not a `computed`: ngModel mutates the rows in place, which a signal
   *  derivation would never see. */
  protected get invalid(): boolean {
    return this.draft().some((d) => !d.label.trim() || !d.value.trim());
  }

  protected startEdit(): void {
    this.draft.set(
      this.statistics.map((s) => ({
        ...s,
        serials: [...s.serials],
        serialsOpen: false,
        filter: '',
      })),
    );
    this.saveError.set('');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected addRow(): void {
    this.draft.update((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        label: '',
        value: '',
        serials: [],
        serialsOpen: false,
        filter: '',
      },
    ]);
  }

  protected removeRow(id: string): void {
    this.draft.update((rows) => rows.filter((r) => r.id !== id));
  }

  protected toggleSerials(row: StatisticDraft): void {
    row.serialsOpen = !row.serialsOpen;
  }

  protected shownSerials(row: StatisticDraft): string[] {
    const q = row.filter.trim().toLowerCase();
    const all = this.serials.map((s) => s.value);
    return q ? all.filter((v) => v.toLowerCase().includes(q)) : all;
  }

  protected hasSerial(row: StatisticDraft, value: string): boolean {
    return row.serials.includes(value);
  }

  protected toggleSerial(row: StatisticDraft, value: string): void {
    row.serials = this.hasSerial(row, value)
      ? row.serials.filter((v) => v !== value)
      : [...row.serials, value];
  }

  protected selectShown(row: StatisticDraft): void {
    row.serials = [...new Set([...row.serials, ...this.shownSerials(row)])];
  }

  protected clearSerials(row: StatisticDraft): void {
    row.serials = [];
  }

  protected async submit(): Promise<void> {
    if (this.invalid || this.saving()) return;
    this.saving.set(true);
    this.saveError.set('');
    try {
      const error = await this.persist(
        this.draft().map((d) => ({
          id: d.id,
          label: d.label.trim(),
          value: d.value.trim(),
          serials: d.serials,
        })),
      );
      if (error) this.saveError.set(error);
      else this.editing.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  protected open(stat: ReportStatistic): void {
    if (stat.serials.length > 0) this.statisticOpen.emit(stat);
  }
}
