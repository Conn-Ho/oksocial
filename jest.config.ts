// Postiz's original config expected @nx/jest project discovery, which is not installed;
// list the projects that have tests explicitly.
export default {
  projects: [
    '<rootDir>/libraries/nestjs-libraries/jest.config.ts',
    '<rootDir>/libraries/helpers/jest.config.ts',
    '<rootDir>/apps/backend/jest.config.ts',
  ],
};
