import {
  buildMergedPayload,
  diffDocuments,
  flattenLeaves,
  pathLabel,
  rebaseVersion,
} from './conflict-merge';

describe('conflict-merge', () => {
  describe('flattenLeaves', () => {
    it('recurses plain objects and keeps arrays, scalars, nulls and empty objects as leaves', () => {
      const leaves = flattenLeaves({
        a: 1,
        b: { c: 'x', d: { e: null } },
        f: [1, 2],
        g: {},
      });
      expect(leaves).toEqual([
        { path: ['a'], value: 1 },
        { path: ['b', 'c'], value: 'x' },
        { path: ['b', 'd', 'e'], value: null },
        { path: ['f'], value: [1, 2] },
        { path: ['g'], value: {} },
      ]);
    });
  });

  describe('diffDocuments', () => {
    it('lists only leaves where mine differs from the server', () => {
      const diffs = diffDocuments(
        { poNumber: 'PO-2', headerData: { grade: 'S135', range: '2' } },
        { poNumber: 'PO-1', headerData: { grade: 'S135', range: '3' } },
      );
      expect(diffs.map((d) => d.path)).toEqual([
        ['poNumber'],
        ['headerData', 'range'],
      ]);
      expect(diffs[1]).toMatchObject({ mine: '2', server: '3' });
    });

    it('treats a leaf the server lacks as a difference with an undefined server value', () => {
      const [d] = diffDocuments({ note: 'hi' }, {});
      expect(d?.server).toBeUndefined();
    });

    it('ignores leaves only the server has (the user never touched them)', () => {
      expect(diffDocuments({ a: 1 }, { a: 1, b: 2 })).toEqual([]);
    });

    it('compares arrays and objects by content, not reference', () => {
      expect(diffDocuments({ s: [{ a: 1 }] }, { s: [{ a: 1 }] })).toEqual([]);
      expect(diffDocuments({ s: [{ a: 1 }] }, { s: [{ a: 2 }] })).toHaveLength(
        1,
      );
    });

    it('does not collide keys that contain dots', () => {
      const diffs = diffDocuments({ 'meta.name': 'A' }, { 'meta.name': 'B' });
      expect(diffs[0]?.path).toEqual(['meta.name']);
    });
  });

  describe('buildMergedPayload', () => {
    const server = {
      poNumber: 'PO-1',
      headerData: { grade: 'S135', range: '3', weight: '9' },
      statistics: [{ label: 'x', value: '1' }],
    };
    const mine = {
      poNumber: 'PO-2',
      headerData: { grade: 'S135', range: '2' },
      statistics: [{ label: 'x', value: '9' }],
    };
    const diffs = diffDocuments(mine, server);

    it('defaults to keeping my values', () => {
      const payload = buildMergedPayload(server, diffs, {});
      expect(payload['poNumber']).toBe('PO-2');
      expect(payload['statistics']).toEqual([{ label: 'x', value: '9' }]);
    });

    it('sends a whole top-level value: the server object overlaid with only the chosen leaves', () => {
      const payload = buildMergedPayload(server, diffs, {});
      // `weight` exists only on the server and must survive (the API replaces headerData).
      expect(payload['headerData']).toEqual({
        grade: 'S135',
        range: '2',
        weight: '9',
      });
    });

    it('omits top-level keys where everything resolved to the server', () => {
      const choices = Object.fromEntries(
        diffs.map((d) => [d.id, 'server' as const]),
      );
      expect(buildMergedPayload(server, diffs, choices)).toEqual({});
    });

    it('mixes sides per leaf', () => {
      const rangeId = diffs.find((d) => d.path[1] === 'range')!.id;
      const poId = diffs.find((d) => d.path[0] === 'poNumber')!.id;
      const payload = buildMergedPayload(server, diffs, {
        [rangeId]: 'server',
        [poId]: 'mine',
      });
      expect(payload['poNumber']).toBe('PO-2');
      expect('headerData' in payload).toBe(false);
    });

    it('does not mutate its inputs', () => {
      const before = JSON.stringify(server);
      buildMergedPayload(server, diffs, {});
      expect(JSON.stringify(server)).toBe(before);
    });

    it('creates the container when the server has none for a nested leaf', () => {
      const d = diffDocuments(
        { inspectionData: { body: { emiResult: 'PASS' } } },
        {},
      );
      expect(buildMergedPayload({}, d, {})).toEqual({
        inspectionData: { body: { emiResult: 'PASS' } },
      });
    });
  });

  describe('rebaseVersion', () => {
    it('shifts a numeric version by the base delta and leaves other values alone', () => {
      expect(rebaseVersion(4, 3, 7)).toBe(8);
      expect(rebaseVersion(undefined, 3, 7)).toBeUndefined();
      expect(rebaseVersion('x', 3, 7)).toBe('x');
    });
  });

  it('pathLabel joins with a separator', () => {
    expect(pathLabel(['headerData', 'range'])).toBe('headerData › range');
  });
});
