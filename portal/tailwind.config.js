const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    extend: {
      colors: {
        // primary & accent flow from the :root CSS-var token layer (src/styles.scss).
        // Channel form `rgb(var(--*) / <alpha-value>)` keeps opacity modifiers
        // (bg-primary/10, ring-primary/25, …) working under Tailwind v3.
        // Semantic surface tokens (background/foreground/card/muted/border) map the
        // same :root vars so `bg-card`, `text-foreground`, `text-muted-foreground`,
        // `border-border`, `bg-background` resolve from the token layer (and swap
        // with any future dark block) instead of raw gray-*/neutral-*.
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          light: 'var(--primary-hover)', // darker-blue hover/active slot
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'var(--accent-hover)',
        },
        success: {
          DEFAULT: '#4CAF50',
          light: '#E8F5E9',
          dark: '#388E3C',
        },
        error: {
          DEFAULT: '#F44336',
          light: '#FFEBEE',
          dark: '#D32F2F',
        },
        warning: {
          DEFAULT: '#FFC107',
          light: '#FFF8E1',
          dark: '#F57F17',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Source Sans 3"', 'sans-serif'],
        mono: ['"IBM Plex Sans"', '"Source Sans 3"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
