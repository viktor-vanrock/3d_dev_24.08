import { defineConfig } from "@playwright/test";

// Внешний config запускается из этой папки, поэтому корень web задаётся явно в
// `PORTAL_WEB_ROOT` (команда запуска приведена в evidence).
const webRoot = process.env.PORTAL_WEB_ROOT ?? process.cwd();

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    cwd: webRoot,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
