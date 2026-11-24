import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ".local/browser-results",
  use: {
    baseURL: process.env.AOOS_BASE_URL || "http://127.0.0.1:3000",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    reducedMotion: "reduce",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: process.env.AOOS_LOCAL_TLS === "1",
    trace: "off",
    screenshot: "off",
    launchOptions: {
      ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {}),
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1080 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } },
  ],
});
