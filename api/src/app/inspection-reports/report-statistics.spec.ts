import { BadRequestException } from '@nestjs/common';
import { MAX_STATISTICS, normalizeStatistics } from './report-statistics';

describe('normalizeStatistics', () => {
  it('trims, stringifies numbers and defaults serials to []', () => {
    expect(
      normalizeStatistics([{ id: ' a ', label: ' Toto ', value: 15 }]),
    ).toEqual([{ id: 'a', label: 'Toto', value: '15', serials: [] }]);
  });

  it('de-duplicates and trims serials, keeping order', () => {
    const [row] = normalizeStatistics([
      { id: 'a', label: 'L', value: 'v', serials: ['B', ' A ', 'B'] },
    ]);
    expect(row.serials).toEqual(['B', 'A']);
  });

  it('accepts an empty list (all statistics removed)', () => {
    expect(normalizeStatistics([])).toEqual([]);
  });

  it.each([
    ['non-array', 'x'],
    ['non-object row', ['x']],
    ['missing label', [{ id: 'a', label: ' ', value: '1' }]],
    ['missing value', [{ id: 'a', label: 'L', value: '' }]],
    ['missing id', [{ label: 'L', value: '1' }]],
    [
      'duplicate id',
      [
        { id: 'a', label: 'L', value: '1' },
        { id: 'a', label: 'M', value: '2' },
      ],
    ],
    ['non-string serial', [{ id: 'a', label: 'L', value: '1', serials: [1] }]],
    ['blank serial', [{ id: 'a', label: 'L', value: '1', serials: [' '] }]],
    [
      'too many rows',
      Array.from({ length: MAX_STATISTICS + 1 }, (_, i) => ({
        id: `i${i}`,
        label: 'L',
        value: '1',
      })),
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => normalizeStatistics(input)).toThrow(BadRequestException);
  });
});
