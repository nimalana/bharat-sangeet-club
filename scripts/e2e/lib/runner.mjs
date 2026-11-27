// A tiny sequential test runner. Tests run in the order they are written; a test may depend on
// state left by an earlier one in the same section (kept on `ctx.state`). A failing test records
// the error text plus the last HTTP requests, and the run goes on.
import { recentRequests } from "./httplog.mjs";

export class Runner {
  constructor({ only = [], verbose = true } = {}) {
    this.results = [];
    this.only = only;
    this.verbose = verbose;
    this.section = "";
  }

  setSection(name) {
    this.section = name;
    if (this.verbose) console.log(`\n== ${name}`);
  }

  selected() {
    return this.only.length === 0 || this.only.some((part) => this.section.toLowerCase().includes(part.toLowerCase()));
  }

  record(result) {
    this.results.push({ section: this.section, ...result });
    if (!this.verbose) return;
    const tag = { pass: "PASS", fail: "FAIL", skip: "SKIP", observation: "NOTE" }[result.status];
    console.log(`  ${tag}  ${result.name}${result.ms != null ? ` (${result.ms} ms)` : ""}`);
    if (result.status === "fail") console.log(`        ${String(result.error).split("\n").join("\n        ")}`);
    if (result.status === "observation" || result.status === "skip") console.log(`        ${String(result.detail || "").split("\n").join("\n        ")}`);
  }

  // A normal test: passes if fn resolves, fails if it throws.
  async test(name, fn) {
    if (!this.selected()) return;
    const started = performance.now();
    try {
      await fn();
      this.record({ name, status: "pass", ms: Math.round(performance.now() - started) });
      return true;
    } catch (error) {
      this.record({
        name, status: "fail", ms: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
        requests: recentRequests(4),
      });
      return false;
    }
  }

  // Records what happened without passing or failing (used for known or suspected issues).
  async observe(name, fn) {
    if (!this.selected()) return;
    const started = performance.now();
    try {
      const detail = await fn();
      this.record({ name, status: "observation", ms: Math.round(performance.now() - started), detail: typeof detail === "string" ? detail : JSON.stringify(detail, null, 2) });
    } catch (error) {
      this.record({ name, status: "fail", ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error), requests: recentRequests(4) });
    }
  }

  skip(name, detail) {
    if (!this.selected()) return;
    this.record({ name, status: "skip", detail });
  }

  summary() {
    const count = (status) => this.results.filter((r) => r.status === status).length;
    return { pass: count("pass"), fail: count("fail"), skip: count("skip"), observation: count("observation"), total: this.results.length };
  }
}
