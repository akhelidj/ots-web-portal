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
        primary: {
          DEFAULT: '#0B1A2A',
          light: '#1e334a',
        },
        accent: {
          DEFAULT: '#FF9800',
          hover: '#F57C00',
        },
        success: {
          DEFAULT: '#4CAF50',
          light: '#E8F5E9',
          dark: '#388E3C'
        },
        error: {
          DEFAULT: '#F44336',
          light: '#FFEBEE',
          dark: '#D32F2F'
        },
        warning: {
          DEFAULT: '#FFC107',
          light: '#FFF8E1',
          dark: '#F57F17'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
};
