// Phase 3.4 on the Attendance stylesheet, read as text (jsdom does not lay anything out, so what it looks like at 12px is for a real
// browser): no text under 12px in attendance.css or in the classes of the attendance components, the 44px targets the sheet owns (the
// tabs, the check boxes of the dialogs), and the two fixes the check-in card already had (F1: the button's label colour, F2: the code
// field fitting the card at phone width), which this step must not lose.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const css = readFileSync(join(root, "features/attendance/attendance.css"), "utf8");

const px = (value: string, unit: string) => (unit === "rem" ? Number(value) * 16 : Number(value));
const small = (text: string) => [...text.matchAll(/font(?:-size)?:\s*(?:[^;}]*?\s)?(\d*\.?\d+)(px|rem)\b/g)].map((hit) => ({ text: hit[0], size: px(hit[1], hit[2]) })).filter((hit) => hit.size < 12);
/** The declarations of every rule (in or out of a @media block) whose selector is exactly `selector`, joined. */
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const hits = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\{([^}]*)\\}`, "g"))];
  return hits.map((hit) => hit[1]).join(";");
};

describe("no text under 12px in the attendance area", () => {
  it("attendance.css", () => {
    expect(small(css)).toEqual([]);
  });

  it("the classes of the attendance components", () => {
    const dir = join(root, "features/attendance/components");
    const found: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const hit of source.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) if (px(hit[1], hit[2]) < 12) found.push(`${file}: ${hit[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("the check itself sees a small size (a test that cannot fail proves nothing)", () => {
    expect(small(".x{font-size:9px}.y{font:italic 7px/1 serif}.z{font-size:.7rem}")).toHaveLength(3);
    expect(small(".x{font-size:12px}.y{font:600 12px var(--ui)}")).toHaveLength(0);
  });
});

describe("what the sheet owns", () => {
  it("the tabs and the check boxes of the dialogs are 44px tall", () => {
    expect(rule(".attendance-tabs button")).toMatch(/min-height:44px/);
    expect(rule(".attendance-modal .check-label")).toMatch(/min-height:44px/);
  });

  it("a status pill never breaks inside itself, and an email never widens its column", () => {
    expect(rule(".attendance-status")).toMatch(/white-space:nowrap/);
    expect(rule(".attendance-roster-row small")).toMatch(/overflow-wrap:anywhere/);
    expect(rule(".attendance-flags small")).toMatch(/overflow-wrap:anywhere/);
  });

  it("keeps the check-in card's two fixes: a button label that is not white on white, and a code field that fits at phone width", () => {
    expect(css).toMatch(/@layer utilities\{\.attendance-checkin button\{color:var\(--ink\)!important\}\}/);
    expect(css).toMatch(/@media \(max-width:680px\)\{\s*\.attendance-checkin\{grid-template-columns:minmax\(0,1fr\)\}/);
    expect(css).toMatch(/\.attendance-checkin input\{box-sizing:border-box;width:100%\}/);
  });
});
