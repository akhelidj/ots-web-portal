import baseConfig from '../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default [
  ...baseConfig,
  {
    // Type-aware rules: only for files that belong to the app/spec tsconfigs.
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Tests assert on fixtures they just built; non-null assertions are idiomatic there.
    files: ['**/*.spec.ts', '**/*.testutil.ts', 'test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
