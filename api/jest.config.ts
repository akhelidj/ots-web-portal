/* eslint-disable */
export default {
  displayName: 'api',
  preset: '../jest.preset.js',
  testEnvironment: 'node',
  // @swc/jest is the Nx-recommended transform for NestJS: fast, and the swc
  // options below enable the legacy decorator + metadata emit that Nest's DI
  // relies on (equivalent to tsc's emitDecoratorMetadata).
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
  coverageDirectory: '../coverage/api',
};
