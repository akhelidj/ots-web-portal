import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  // Modern typescript-eslint recommended, layered explicitly (version-anchored to
  // the typescript-eslint package) rather than relying on the subset Nx bundles.
  // Scoped to TS files so JS handling stays with the Nx/JS config above.
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
  })),
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  // Surface eslint-disable comments that no longer suppress anything, so the
  // Phase 3 disable-directive cleanup has a live signal.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allowCircularSelfDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
