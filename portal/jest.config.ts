/* eslint-disable */
export default {
  displayName: 'portal',
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../coverage/portal',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json', 'mjs'],
  // Keep the tsconfig path aliases working inside tests.
  moduleNameMapper: {
    '^@portal/(.*)$': '<rootDir>/src/app/$1',
    '^@app-env/(.*)$': '<rootDir>/src/environments/$1',
  },
};
