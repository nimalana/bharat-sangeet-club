import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { OUT, BROWSER_DIR } from "./support/config.mjs";

// Chromium preinstalled in the container (do not run `playwright install`). E2E_CHROMIUM overrides; with neither, Playwright's own.
const executablePath = process.env.E2E_CHROMIUM || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
// Behind the agent proxy a browser has to be told about it (Node needs NODE_USE_ENV_PROXY=1, handled by the server and setup code).
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

const timings = process.env.E2E_SUITE === "timings";

export default defineConfig({
  testDir: path.join(BROWSER_DIR, "specs"),
  testMatch: timings ? /timings\.spec\.mjs$/ : /^(?!.*timings).*\.spec\.mjs$/,
  // E2E_JOURNEYS=0: only the screens. The journeys change the fixtures (a request is paid, a file is deleted), which would leave nothing
  // for a second run that reuses them (E2E_REUSE=1).
  testIgnore: process.env.E2E_JOURNEYS === "0" ? /write-journeys\.spec\.mjs$/ : undefined,
  outputDir: path.join(OUT, "results"),
  globalSetup: path.join(BROWSER_DIR, "global-setup.mjs"),
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 1),
  retries: 0,
  timeout: timings ? 120_000 : 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: path.join(OUT, "report.json") }]],
  use: {
    // Read by the fixtures in support/test.mjs from the state file; the base URL is only known after global setup starts the server.
    // A trace and a screenshot are kept for a failing test only (under OUT/results); E2E_TRACE=off turns recording off.
    trace: process.env.E2E_TRACE || (timings ? "off" : "retain-on-failure"),
    screenshot: timings ? "off" : "only-on-failure",
    video: "off",
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      executablePath,
      args: ["--no-sandbox"],
      // The app itself runs on localhost: that must NOT go through the proxy (it only tunnels HTTPS).
      ...(proxyUrl ? { proxy: { server: proxyUrl, bypass: "localhost,127.0.0.1,[::1]" } } : {}),
    },
  },
});
