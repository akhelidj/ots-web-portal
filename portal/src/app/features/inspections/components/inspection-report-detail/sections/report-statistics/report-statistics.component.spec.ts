import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  LocalSerialNumber,
  ReportStatistic,
} from '@portal/core/offline/models/types';
import { ReportStatisticsComponent } from './report-statistics.component';

const serial = (value: string): LocalSerialNumber => ({
  id: `id-${value}`,
  inspectionReportId: 'r1',
  value,
  version: 1,
});

const STATS: ReportStatistic[] = [
  { id: 's1', label: 'Toto', value: '15', serials: [] },
  { id: 's2', label: 'Accepted', value: '3', serials: ['A1', 'A2'] },
];

/** The component's protected editor API, exposed for the tests only. */
interface DraftRow {
  id: string;
  label: string;
  value: string;
  serials: string[];
  filter: string;
}
interface Internals {
  draft(): DraftRow[];
  invalid: boolean;
  addRow(): void;
  toggleSerial(row: DraftRow, value: string): void;
  selectShown(row: DraftRow): void;
  clearSerials(row: DraftRow): void;
  submit(): Promise<void>;
}

describe('ReportStatisticsComponent', () => {
  let f: ComponentFixture<ReportStatisticsComponent>;
  let c: ReportStatisticsComponent;

  const el = () => f.nativeElement as HTMLElement;
  const internals = () => c as unknown as Internals;
  const q = (sel: string) => el().querySelector(sel) as HTMLElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReportStatisticsComponent] });
    f = TestBed.createComponent(ReportStatisticsComponent);
    c = f.componentInstance;
    c.serials = [serial('A1'), serial('A2'), serial('B1')];
  });

  it('shows each typed label + value, nothing computed', () => {
    c.statistics = STATS;
    f.detectChanges();
    const text = el().textContent ?? '';
    expect(text).toContain('Toto');
    expect(text).toContain('15');
    expect(text).toContain('Accepted');
    expect(text).not.toContain('Pass Rate');
  });

  it('only a statistic with serials is clickable and emits itself', () => {
    c.statistics = STATS;
    const opened: ReportStatistic[] = [];
    c.statisticOpen.subscribe((s) => opened.push(s));
    f.detectChanges();

    const cards = el().querySelectorAll('[data-testid="statistics-grid"] > *');
    (cards[0] as HTMLElement).click(); // Toto — no serials
    expect(opened).toHaveLength(0);
    (cards[1] as HTMLElement).click(); // Accepted — has serials
    expect(opened).toEqual([STATS[1]]);
  });

  it('renders nothing for a customer with no statistics, and hides the edit button', () => {
    c.variant = 'customer';
    c.statistics = [];
    f.detectChanges();
    expect(q('[data-testid="statistics-grid"]')).toBeNull();
    expect(q('[data-testid="statistics-edit"]')).toBeNull();
  });

  it('offers the editor only when editable', () => {
    c.statistics = STATS;
    f.detectChanges();
    expect(q('[data-testid="statistics-edit"]')).toBeNull();

    f.componentRef.setInput('editable', true);
    f.detectChanges();
    expect(q('[data-testid="statistics-edit"]')).not.toBeNull();
  });

  it('saves the whole typed list (trimmed) with chosen serials, then closes', async () => {
    const persist = jest.fn().mockResolvedValue(null);
    c.editable = true;
    c.statistics = [];
    c.persist = persist;
    f.detectChanges();

    q('[data-testid="statistics-edit"]')!.click();
    f.detectChanges();
    internals().addRow();
    f.detectChanges();

    const row = internals().draft()[0];
    row.label = '  Toto ';
    row.value = ' 15 ';
    internals().toggleSerial(row, 'B1');

    await internals().submit();
    f.detectChanges();

    expect(persist).toHaveBeenCalledWith([
      { id: row.id, label: 'Toto', value: '15', serials: ['B1'] },
    ]);
    expect(q('[data-testid="statistics-editor"]')).toBeNull();
  });

  it('refuses to save a row without label or value', async () => {
    const persist = jest.fn().mockResolvedValue(null);
    c.editable = true;
    c.persist = persist;
    f.detectChanges();
    q('[data-testid="statistics-edit"]')!.click();
    internals().addRow();
    f.detectChanges();

    await internals().submit();
    expect(persist).not.toHaveBeenCalled();
    expect(internals().invalid).toBe(true);
  });

  it('keeps the editor open with the error when the save fails', async () => {
    c.editable = true;
    c.persist = jest.fn().mockResolvedValue('Version mismatch');
    f.detectChanges();
    q('[data-testid="statistics-edit"]')!.click();
    internals().addRow();
    const row = internals().draft()[0];
    row.label = 'L';
    row.value = '1';

    await internals().submit();
    f.detectChanges();

    expect(q('[data-testid="statistics-editor"]')).not.toBeNull();
    expect(el().textContent).toContain('Version mismatch');
  });

  it('select shown / clear act on the filtered serial pool', () => {
    c.editable = true;
    c.statistics = [{ id: 's', label: 'L', value: '1', serials: [] }];
    f.detectChanges();
    q('[data-testid="statistics-edit"]')!.click();
    const row = internals().draft()[0];

    row.filter = 'a';
    internals().selectShown(row);
    expect(row.serials).toEqual(['A1', 'A2']);

    internals().clearSerials(row);
    expect(row.serials).toEqual([]);
  });
});
