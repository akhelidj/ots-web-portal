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
        background: 'rgb(var(--background-rgb) / <alpha-value>)', // channel form: enables bg-background/95
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
        'light-slate': 'var(--light-slate)', // caption/secondary-label text
        primary: {
          DEFAULT: 'rgb(var(--primary-rgb) / <alpha-value>)',
          light: 'var(--primary-hover)', // ink-soft hover/active slot
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'var(--accent-hover)',
          foreground: 'var(--on-accent)', // ink text for orange surfaces (text-accent-foreground)
        },
        // Status colors now flow from the :root token layer (src/styles.scss) so they
        // are re-pointable; the DEFAULT/light/dark class names are unchanged. Channel
        // form keeps the existing alpha modifiers (border-success/30, ring-error/25,
        // bg-warning-light/20, …) working.
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          light: 'rgb(var(--success-light) / <alpha-value>)',
          dark: 'rgb(var(--success-dark) / <alpha-value>)',
        },
        error: {
          DEFAULT: 'rgb(var(--error) / <alpha-value>)',
          light: 'rgb(var(--error-light) / <alpha-value>)',
          dark: 'rgb(var(--error-dark) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          light: 'rgb(var(--warning-light) / <alpha-value>)',
          dark: 'rgb(var(--warning-dark) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Body/UI = IBM Plex; headings = Manrope; condensed accents = Barlow Condensed.
        sans: ['"IBM Plex Sans"', '"Source Sans 3"', 'sans-serif'],
        heading: ['"Manrope"', '"IBM Plex Sans"', 'sans-serif'],
        condensed: ['"Barlow Condensed"', '"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Sans"', '"Source Sans 3"', 'sans-serif'],
      },
      // Radius flows from --radius (currently 0): every rectangular-container scale
      // (sm/DEFAULT/md/lg/xl/2xl/3xl) and their directional -t/-b/-l/-r variants
      // resolve square, so containers match their contents.
      // `rounded-full` is deliberately left alone here — it is used ONLY for genuinely
      // circular things (avatars, spinners, status dots). Non-circular pills/chips/
      // count-badges/icon-buttons were switched off rounded-full in the markup instead.
      borderRadius: {
        sm: 'var(--radius)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)',
        '3xl': 'var(--radius)',
      },
      // Motion — expose the :root duration/easing tokens as real utilities so
      // markup can write `duration-fast`/`ease-standard` etc. instead of ad-hoc
      // values. Additive under `extend`: Tailwind's numeric durations (150/300/
      // 500…) and default easings (in/out/in-out) that the ops surfaces use are
      // untouched.
      transitionDuration: {
        fast: 'var(--duration-fast)', // 220ms — hovers, small state flips
        medium: 'var(--duration-medium)', // 440ms — panels, disclosures
        slow: 'var(--duration-slow)', // 720ms — drawer/route level
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)', // general in/out
        decelerate: 'var(--ease-decelerate)', // entrances
        accelerate: 'var(--ease-accelerate)', // exits
      },
      // Card elevation and the orange focus ring, driven from the token layer.
      boxShadow: {
        card: 'var(--shadow-card)',
        'focus-ring': 'var(--focus-ring)', // utility: shadow-focus-ring
      },
      ringColor: {
        DEFAULT: 'var(--ring)', // bare `ring` uses the orange accent
      },
    },
  },
  plugins: [],
};
