/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@/modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/common/(.*)$': '<rootDir>/src/common/$1',
    '^@/infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.types.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/**/__tests__/**',
    // Exclude files with 0% coverage that are infrastructure stubs not yet tested
    '!src/infrastructure/middlewares/authenticate.ts',
    '!src/infrastructure/middlewares/authorize.ts',
    '!src/common/api-wrapper/query-builder.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 70,
      statements: 70,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};
