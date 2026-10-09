import { TestBed } from '@angular/core/testing';
import {
  ConflictComparison,
  ConflictGroup,
  ConflictResolutionService,
} from '@portal/core/offline/conflicts/conflict-resolution.service';
import { SyncOrchestratorService } from '@portal/core/offline/services/sync-orchestrator.service';
import { OutboxItem } from '@portal/core/offline/models/types';
import { SyncConflictsComponent } from './sync-conflicts.component';

const settle = () => new Promise((r) => setTimeout(r, 0));

function group(mergeable: boolean): ConflictGroup {
  return {
    root: {
      id: 'o1',
      entityId: 'e1',
      lastError: 'Version conflict',
    } as OutboxItem,
    dependents: [{ id: 'o2' } as OutboxItem],
    title: 'Report update',
    mergeable,
  };
}

const comparison: ConflictComparison = {
  differences: [
    { id: '["poNumber"]', path: ['poNumber'], mine: 'A', server: 'B' },
  ],
  serverDoc: { poNumber: 'B' },
  serverVersion: 5,
  serverRecord: {},
};

describe('SyncConflictsComponent', () => {
  let groups: ConflictGroup[];
  let resolver: {
    listGroups: jest.Mock;
    recordLabel: jest.Mock;
    compare: jest.Mock;
    keepMine: jest.Mock;
    keepServer: jest.Mock;
    retry: jest.Mock;
  };
  let syncNow: jest.Mock;

  function create(): { el: HTMLElement; cmp: SyncConflictsComponent } {
    const fixture = TestBed.createComponent(SyncConflictsComponent);
    fixture.detectChanges();
    return { el: fixture.nativeElement, cmp: fixture.componentInstance };
  }

  beforeEach(() => {
    groups = [group(true)];
    resolver = {
      listGroups: jest.fn(() => Promise.resolve(groups)),
      recordLabel: jest.fn(() => Promise.resolve('Report PO 42')),
      compare: jest.fn(() => Promise.resolve(comparison)),
      keepMine: jest.fn(() => {
        groups = [];
        return Promise.resolve();
      }),
      keepServer: jest.fn(() => {
        groups = [];
        return Promise.resolve();
      }),
      retry: jest.fn(() => Promise.resolve()),
    };
    syncNow = jest.fn(() => Promise.resolve());
    TestBed.configureTestingModule({
      providers: [
        { provide: ConflictResolutionService, useValue: resolver },
        { provide: SyncOrchestratorService, useValue: { syncNow } },
      ],
    });
  });

  it('lists conflicts with the record label and queued-behind note', async () => {
    const { el, cmp } = create();
    await cmp.reload();
    expect(cmp.views()).toHaveLength(1);
    expect(cmp.views()[0].label).toBe('Report PO 42');
    expect(resolver.listGroups).toHaveBeenCalled();
    expect(el).toBeTruthy();
  });

  it('shows an empty state when nothing conflicts', async () => {
    groups = [];
    const { cmp } = create();
    await cmp.reload();
    expect(cmp.views()).toHaveLength(0);
    expect(cmp.loading()).toBe(false);
  });

  it('defaults every difference to "mine" and records a switch to the server', async () => {
    const { cmp } = create();
    await cmp.reload();
    await cmp.review(cmp.views()[0]);
    const diff = cmp.comparison()!.differences[0];
    expect(cmp.choiceFor(diff)).toBe('mine');
    cmp.choose(diff, 'server');
    expect(cmp.choiceFor(diff)).toBe('server');
  });

  it('applies the selection, reloads and triggers a sync', async () => {
    const { cmp } = create();
    await cmp.reload();
    const view = cmp.views()[0];
    await cmp.review(view);
    cmp.choose(comparison.differences[0], 'server');
    await cmp.applyMine(view);
    await settle();
    expect(resolver.keepMine).toHaveBeenCalledWith(view.group, comparison, {
      '["poNumber"]': 'server',
    });
    expect(cmp.views()).toHaveLength(0);
    expect(cmp.reviewing()).toBeNull();
    expect(syncNow).toHaveBeenCalled();
  });

  it('keeps the card and reports an error when the server cannot be reached', async () => {
    resolver.compare.mockRejectedValueOnce(new Error('offline'));
    const { cmp } = create();
    await cmp.reload();
    await cmp.review(cmp.views()[0]);
    expect(cmp.comparison()).toBeNull();
    expect(cmp.actionError()).toContain('Check your connection');
    expect(cmp.views()).toHaveLength(1);
  });

  it('does not sync or drop the card when a resolution fails', async () => {
    resolver.keepServer.mockRejectedValueOnce(new Error('boom'));
    const { cmp } = create();
    await cmp.reload();
    await cmp.keepServer(cmp.views()[0]);
    expect(cmp.actionError()).toContain('Nothing was lost');
    expect(cmp.views()).toHaveLength(1);
    expect(syncNow).not.toHaveBeenCalled();
    expect(cmp.busyId()).toBeNull();
  });

  it('offers retry for changes that cannot be compared', async () => {
    groups = [group(false)];
    const { cmp } = create();
    await cmp.reload();
    await cmp.retry(cmp.views()[0]);
    expect(resolver.retry).toHaveBeenCalled();
    expect(syncNow).toHaveBeenCalled();
  });
});
