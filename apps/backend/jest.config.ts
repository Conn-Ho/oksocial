/* eslint-disable */
// Unit tests of the backend's own code (controllers): ts-jest + the tsconfig path aliases, like
// libraries/nestjs-libraries/jest.config.ts.
import { pathsToModuleNameMapper } from 'ts-jest';
const { compilerOptions } = require('../../tsconfig.base.json');

export default {
  displayName: 'backend',
  rootDir: '../..',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/apps/backend/tsconfig.spec.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  testMatch: ['<rootDir>/apps/backend/src/**/*.spec.ts'],
  coverageDirectory: '<rootDir>/coverage/apps/backend',
};
