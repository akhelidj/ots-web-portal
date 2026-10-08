/**
 * Customer brand palette: every customer-theme token derived from ONE brand colour.
 *
 * Without a brand colour the customer theme keeps its default blue-ish surfaces and the
 * accent is monochrome — white on dark surfaces (and on the nav bar), the theme's ink on
 * light ones. With a brand colour, the surfaces are re-tinted with its hue and the
 * accent is the colour itself, nudged lighter/darker until it stays legible on the
 * surface it sits on (WCAG contrast). Pure functions: ThemeService applies the result
 * as inline custom properties on <html>, overriding the stylesheet defaults.
 */

import type { ThemeMode } from './theme.service';

export type PaletteVars = Record<string, string>;

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function isBrandColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const hsl = (h: number, s: number, l: number) => rgbToHex(hslToRgb({ h, s, l }));

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Move `color` lighter (on a dark `bg`) or darker (on a light one), keeping its hue,
 * until it reaches `ratio` against `bg`. Falls back to white/black at the extreme.
 */
export function ensureContrast(color: string, bg: string, ratio: number): string {
  if (contrast(color, bg) >= ratio) return color;
  const lighten = luminance(bg) < 0.18;
  const base = rgbToHsl(hexToRgb(color));
  for (let step = 1; step <= 50; step++) {
    const l = Math.min(1, Math.max(0, base.l + (lighten ? 0.02 : -0.02) * step));
    const candidate = hsl(base.h, base.s, l);
    if (contrast(candidate, bg) >= ratio) return candidate;
  }
  return lighten ? '#ffffff' : '#000000';
}

/** Same hue, lightness moved by `dl` (−1…1). */
function shift(color: string, dl: number): string {
  const { h, s, l } = rgbToHsl(hexToRgb(color));
  return hsl(h, s, Math.min(1, Math.max(0, l + dl)));
}

/** Ink or white — whichever reads better on `bg`. */
function onColor(bg: string, ink: string): string {
  return contrast('#ffffff', bg) >= contrast(ink, bg) ? '#ffffff' : ink;
}

const rgbTriple = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
};

function accentVars(accent: string, hover: string, onAccent: string, text: string): PaletteVars {
  return {
    '--accent': accent,
    '--accent-hover': hover,
    '--on-accent': onAccent,
    '--accent-rgb': rgbTriple(accent),
    '--accent-text': text,
    '--ring': accent,
    '--focus-ring': `0 0 0 3px rgb(${rgbTriple(accent)} / 0.55)`,
  };
}

/** Accent shown on the nav bar (always a dark surface), scoped by CSS to the header. */
function navAccentVars(accent: string, hover: string, onAccent: string): PaletteVars {
  return {
    '--nav-accent': accent,
    '--nav-accent-hover': hover,
    '--nav-on-accent': onAccent,
  };
}

/** Default (no brand colour): monochrome accent on the stock blue-ish surfaces. */
function defaultPalette(mode: ThemeMode): PaletteVars {
  const navy = '#0f2741';
  const white = navAccentVars('#ffffff', '#dfe7f0', navy);
  return mode === 'dark'
    ? { ...accentVars('#ffffff', '#dfe7f0', navy, '#ffffff'), ...white }
    : { ...accentVars(navy, '#1b3a5c', '#ffffff', navy), ...white };
}

/**
 * The full set of custom properties for a customer's theme. `brandColor` null/invalid
 * returns the default monochrome accent (surfaces stay as the stylesheet defines them).
 */
export function brandPalette(brandColor: string | null | undefined, mode: ThemeMode): PaletteVars {
  if (!isBrandColor(brandColor)) return defaultPalette(mode);

  const brand = brandColor.toLowerCase();
  const { h, s } = rgbToHsl(hexToRgb(brand));
  // Surfaces carry the hue but never more saturation than the stock navy-ish feel.
  const ss = Math.min(s, 0.45);

  if (mode === 'dark') {
    const background = hsl(h, ss, 0.08);
    const card = hsl(h, ss, 0.13);
    const nav = hsl(h, ss, 0.06);
    const fg = hsl(h, Math.min(s, 0.2), 0.97);
    const accent = ensureContrast(brand, card, 3);
    const navAccent = ensureContrast(brand, nav, 3);
    return {
      '--background': background,
      '--background-rgb': rgbTriple(background),
      '--card': card,
      '--tl-surface': card,
      '--muted': hsl(h, ss, 0.105),
      '--nav-bg': nav,
      '--foreground': fg,
      '--card-foreground': fg,
      '--primary': fg,
      '--primary-hover': '#ffffff',
      '--primary-rgb': rgbTriple(fg),
      '--color-primary': rgbTriple(fg),
      '--on-primary': card,
      '--muted-foreground': hsl(h, Math.min(s, 0.18), 0.76),
      '--light-slate': hsl(h, Math.min(s, 0.15), 0.62),
      ...accentVars(
        accent,
        shift(accent, 0.08),
        onColor(accent, card),
        ensureContrast(brand, background, 4.5),
      ),
      ...navAccentVars(navAccent, shift(navAccent, 0.08), onColor(navAccent, nav)),
    };
  }

  const ink = hsl(h, Math.min(s, 0.55), 0.15);
  const background = hsl(h, Math.min(ss, 0.3), 0.975);
  const nav = ink;
  const accent = ensureContrast(brand, '#ffffff', 3);
  const navAccent = ensureContrast(brand, nav, 3);
  const inkRgb = rgbTriple(ink);
  return {
    '--background': background,
    '--background-rgb': rgbTriple(background),
    '--card': '#ffffff',
    '--tl-surface': '#ffffff',
    '--muted': hsl(h, Math.min(ss, 0.3), 0.93),
    '--nav-bg': nav,
    '--foreground': ink,
    '--card-foreground': ink,
    '--primary': ink,
    '--primary-hover': hsl(h, Math.min(s, 0.55), 0.23),
    '--primary-rgb': inkRgb,
    '--color-primary': inkRgb,
    '--on-primary': '#ffffff',
    '--muted-foreground': hsl(h, Math.min(s, 0.18), 0.38),
    '--light-slate': hsl(h, Math.min(s, 0.15), 0.45),
    '--border': `rgba(${inkRgb.split(' ').join(', ')}, 0.16)`,
    '--tl-line': `rgba(${inkRgb.split(' ').join(', ')}, 0.16)`,
    '--tl-ghost': `rgba(${inkRgb.split(' ').join(', ')}, 0.09)`,
    ...accentVars(
      accent,
      shift(accent, -0.08),
      onColor(accent, ink),
      ensureContrast(brand, background, 4.5),
    ),
    ...navAccentVars(navAccent, shift(navAccent, 0.08), onColor(navAccent, nav)),
  };
}
