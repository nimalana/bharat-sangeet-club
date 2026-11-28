// Builds the app for the test project and serves it with `next start` on a free port.
//
// NEXT_PUBLIC_* values are inlined at build time, so the build must know the port (NEXT_PUBLIC_SITE_URL) and
// the test project's URL and key. Node needs NODE_USE_ENV_PROXY=1 behind the agent proxy: the build prerenders
// the public concert list and `next start` revalidates it, both with Node's fetch.
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, existsSync, rmSync } from "node:fs";
import { OUT, ROOT } from "./config.mjs";

const NEXT_BIN = path.join(ROOT, "node_modules/next/dist/bin/next");

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function appEnv(cfg, port) {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: cfg.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: cfg.key,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    NODE_USE_ENV_PROXY: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function build(cfg, port) {
  mkdirSync(OUT, { recursive: true });
  // A clean build: Next keeps fetched data (the public concert list, 5 minutes) in .next/cache between builds, which would show the
  // concerts of an earlier run instead of the ones just seeded.
  rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  const log = openSync(path.join(OUT, "build.log"), "w");
  const result = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: ROOT, env: appEnv(cfg, port), stdio: ["ignore", log, log] });
  closeSync(log);
  if (result.status !== 0) {
    const tail = readFileSync(path.join(OUT, "build.log"), "utf8").split("\n").slice(-40).join("\n");
    throw new Error(`next build failed (exit ${result.status}). Last lines of ${path.join(OUT, "build.log")}:\n${tail}`);
  }
}

export async function start(cfg, port) {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("There is no build to serve: run without E2E_SKIP_BUILD.");
  const log = openSync(path.join(OUT, "server.log"), "w");
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT, env: appEnv(cfg, port), stdio: ["ignore", log, log], detached: true,
  });
  closeSync(log);
  let exited = null;
  child.once("exit", (code) => { exited = code; });
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited !== null) throw new Error(`next start exited with code ${exited}. See ${path.join(OUT, "server.log")}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { stop(child); throw new Error(`next start did not answer within 60 s. See ${path.join(OUT, "server.log")}`); }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { child, url };
}

export function stop(child) {
  if (!child || child.killed) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
}
