import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    hookTimeout: 180_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://placeholder',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234',
      BETTER_AUTH_URL: 'http://localhost:5000',
      CLIENT_URL: 'http://localhost:3000',
      SUPER_ADMIN_EMAIL: 'boss@example.com',
    },
  },
});
