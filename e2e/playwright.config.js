// Playwright end-to-end configuration.
// Starts the real backend (port 3000) and the Vite frontend (port 5173, proxying /api to the backend).
// The database settings come from backend/.env, or from DB_* / JWT_SECRET environment variables in CI.
const { defineConfig, devices } = require('@playwright/test');

const reuse = !process.env.CI;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // tests share one database
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node src/index.js',
      cwd: '../backend',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: reuse,
      timeout: 60_000
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: '../frontend',
      url: 'http://localhost:5173',
      reuseExistingServer: reuse,
      timeout: 60_000
    }
  ]
});
