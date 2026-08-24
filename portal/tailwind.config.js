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
