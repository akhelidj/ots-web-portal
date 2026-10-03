import { staleSyncedIds } from './stale-synced';

describe('staleSyncedIds', () => {
  it('flags synced rows the server no longer returns', () => {
    const local = [
      { id: 'a', syncState: 'SYNCED' },
      { id: 'b', syncState: 'SYNCED' },
    ];
    expect(staleSyncedIds(local, ['a'])).toEqual(['b']);
  });

  it('keeps rows the server still returns', () => {
    const local = [{ id: 'a', syncState: 'SYNCED' }];
    expect(staleSyncedIds(local, ['a', 'z'])).toEqual([]);
  });

  it('never flags rows with unsynced local work', () => {
    const local = [
      { id: 'p', syncState: 'PENDING' },
      { id: 'c', syncState: 'CONFLICT' },
      { id: 'e', syncState: 'ERROR' },
      { id: 'pc', syncState: 'PENDING_CREATE' },
      { id: 'pu', syncState: 'PENDING_UPDATE' },
    ];
    expect(staleSyncedIds(local, [])).toEqual([]);
  });

  it('never flags temporal-id rows, even if marked synced', () => {
    const local = [{ id: 'local-ir-123', syncState: 'SYNCED' }];
    expect(staleSyncedIds(local, [])).toEqual([]);
  });

  it('treats a user marked CLEAN as synced', () => {
    expect(staleSyncedIds([{ id: 'u', syncState: 'CLEAN' }], [])).toEqual([
      'u',
    ]);
  });

  it('flags a synced row when the server answered with nothing', () => {
    expect(staleSyncedIds([{ id: 'a', syncState: 'SYNCED' }], [])).toEqual([
      'a',
    ]);
  });

  it('keeps a row with no syncState (cannot tell it is synced)', () => {
    expect(staleSyncedIds([{ id: 'a' }], [])).toEqual([]);
  });
});
