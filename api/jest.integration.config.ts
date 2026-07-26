/* eslint-disable */
// Integration test config — runs *.integration.spec.ts against the dedicated test
// Postgres (docker-compose.test.yml). Separate from the unit `test` target so unit
// tests never require a database.
//
// - setupFiles: applies the DB safety guard per worker BEFORE PrismaClient is built
//   (sets process.env.DATABASE_URL to the validated test DB, or hard-fails).
// - globalSetup: resets the test schema once via `prisma db push --force-reset`.
export default {
  displayName: 'api-integration',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
            dynamicImport: true,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/**/*.integration.spec.ts'],
  setupFiles: ['<rootDir>/test/integration-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  // A DB round-trip is slower than a unit test; give it headroom.
  testTimeout: 30000,
  coverageDirectory: '../coverage/api-integration',
};
