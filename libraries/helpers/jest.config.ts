/* eslint-disable */
// Unit tests for oksocial's server code. Postiz ships no tests and the root config expects @nx/jest,
// which is not installed, so this config is self-contained: ts-jest + the tsconfig path aliases.
import { pathsToModuleNameMapper } from 'ts-jest';
const { compilerOptions } = require('../../tsconfig.base.json');

export default {
  displayName: 'helpers',
  rootDir: '../..',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/libraries/helpers/tsconfig.spec.json', isolatedModules: true },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  testMatch: ['<rootDir>/libraries/helpers/src/**/*.spec.ts'],
  coverageDirectory: '<rootDir>/coverage/libraries/helpers',
};
