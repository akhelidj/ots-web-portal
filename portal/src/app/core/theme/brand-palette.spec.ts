import {
  brandPalette,
  contrast,
  ensureContrast,
  isBrandColor,
} from './brand-palette';

describe('brandPalette', () => {
  it('falls back to a monochrome accent: white on dark, ink on light, white on the nav bar', () => {
    const dark = brandPalette(null, 'dark');
    expect(dark['--accent']).toBe('#ffffff');
    expect(dark['--nav-accent']).toBe('#ffffff');
    expect(dark['--background']).toBeUndefined(); // stock surfaces untouched

    const light = brandPalette(undefined, 'light');
    expect(light['--accent']).toBe('#0f2741');
    expect(light['--on-accent']).toBe('#ffffff');
    expect(light['--nav-accent']).toBe('#ffffff');
  });

  it('ignores anything that is not #rrggbb', () => {
    expect(isBrandColor('#12345')).toBe(false);
    expect(isBrandColor('red')).toBe(false);
    expect(brandPalette('javascript:alert(1)', 'dark')['--accent']).toBe(
      '#ffffff',
    );
  });

  it.each(['#1d6fb8', '#ffd400', '#0a0a0a', '#e10600', '#ffffff', '#808080'])(
    'keeps brand %s legible in both themes',
    (brand) => {
      for (const mode of ['light', 'dark'] as const) {
        const p = brandPalette(brand, mode);
        const accent = p['--accent'] as string;
        const card = p['--card'] as string;
        const nav = p['--nav-bg'] as string;
        expect(contrast(accent, card)).toBeGreaterThanOrEqual(3);
        expect(
          contrast(p['--nav-accent'] as string, nav),
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrast(p['--on-accent'] as string, accent),
        ).toBeGreaterThanOrEqual(3);
        expect(
          contrast(p['--accent-text'] as string, p['--background'] as string),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(p['--foreground'] as string, p['--background'] as string),
        ).toBeGreaterThanOrEqual(7);
      }
    },
  );

  it('re-tints the surfaces with the brand hue', () => {
    const p = brandPalette('#e10600', 'dark');
    const bg = p['--background'] as string;
    // A red brand gives a red-leaning dark background.
    const [r, , b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
    expect(r).toBeGreaterThan(b);
  });

  it('keeps a colour that already has enough contrast', () => {
    expect(ensureContrast('#ffffff', '#000000', 4.5)).toBe('#ffffff');
  });
});
