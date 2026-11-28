// Phase 3.4 for the shell's own files (features/shell, dashboard, public, members, calendar): what the stylesheets of those areas promise.
// jsdom paints nothing, so this reads the CSS the way tests/component/a11y-base.test.tsx reads the shared one: no text under 12px (in the
// stylesheets and in the `text-[..]` classes of the components), no outline taken away without a replacement, the 44px tap targets of the
// touch layout, and the dialog root that the shell's margin rule must leave alone. How it LOOKS at 360px and 1280px is for the real browser.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const AREAS = ["shell", "dashboard", "public", "members", "calendar"] as const;
const css = (area: string) => readFileSync(join(root, `features/${area}/${area}.css`), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

const px = (value: string, unit: string) => (unit === "rem" ? Number(value) * 16 : Number(value));
const small = (text: string) => [...text.matchAll(/font(?:-size)?:\s*(?:[^;}]*?\s)?(\d*\.?\d+)(px|rem)\b/g)].map((hit) => ({ text: hit[0], size: px(hit[1], hit[2]) })).filter((hit) => hit.size < 12);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []);
}

describe("no text under 12px in the shell's areas", () => {
  it.each(AREAS)("the stylesheet of features/%s", (area) => {
    expect(small(strip(css(area)))).toEqual([]);
  });

  it("the classes of the components of those areas (text-[10px] and the like)", () => {
    const found: string[] = [];
    for (const area of AREAS) {
      for (const file of sourceFiles(join(root, "features", area))) {
        for (const hit of readFileSync(file, "utf8").matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) if (px(hit[1], hit[2]) < 12) found.push(`${file.replace(root, "")}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("the check itself sees a small size (a test that cannot fail proves nothing)", () => {
    expect(small(".x{font-size:10px}.y{font:italic 7px/1 serif}.z{font-size:.7rem}")).toHaveLength(3);
    expect(small(".x{font-size:12px}.y{font:600 12px var(--ui)}.z{font-size:.75rem}")).toHaveLength(0);
  });
});

describe("no outline is taken away without a replacement", () => {
  it.each(AREAS)("the stylesheet of features/%s has no outline:none or outline:0 (the ring of styles/shared.css is the focus style)", (area) => {
    expect(strip(css(area))).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });
});

describe("the touch layout (under 700px): 44px tap targets", () => {
  const block = (text: string, query: string) => [...strip(text).matchAll(new RegExp(`@media \\(max-width:${query}\\)\\{([\\s\\S]*?)\\n\\}`, "g"))].map((hit) => hit[1]).join("\n");

  it("the club mark and the account button of the top bar", () => {
    expect(block(css("shell"), "700px")).toMatch(/\.topbar \.brand,\.topbar \.role-button\{min-height:44px\}/);
    expect(block(css("shell"), "700px")).toMatch(/\.topbar \.role-button\{min-width:44px/);
  });

  it("the public header's club mark and sign-in button, the way back, and the two sign-in tabs", () => {
    const rules = block(css("public"), "700px");
    expect(rules).toMatch(/\.public-header \.brand,\.public-header \.primary\.small\{min-height:44px\}/);
    expect(rules).toMatch(/\.login-back\{min-height:44px/);
    expect(rules).toMatch(/\.auth-tabs button\{min-height:44px\}/);
  });

  it("the links of the overview", () => {
    expect(block(css("dashboard"), "700px")).toMatch(/\.measure-actions button,\.dashboard-beats button\{min-height:44px\}/);
  });

  it("an email address or a phone number on a member's card", () => {
    expect(block(css("members"), "700px")).toMatch(/\.member-card dd a\{[^}]*min-height:44px/);
  });

  it("the calendar's own controls were already 44px (the arrows, Today, the buttons of a date in the agenda) and the date itself, which opens its detail,", () => {
    const rules = block(css("calendar"), "700px");
    expect(rules).toMatch(/\.calendar-controls>button,\.calendar-controls div button\{min-width:44px;height:44px\}/);
    expect(rules).toMatch(/\.calendar-agenda-event>button:not\(\.calendar-event-open\)\{[^}]*width:44px;height:44px/);
    expect(rules).toMatch(/\.calendar-agenda-event \.calendar-event-open\{[^}]*min-height:44px/);
  });
});

describe("a dialog written where the shell draws its pages", () => {
  it("is not pushed aside by the margin the shell gives the content beside the sidebar (the Dialog's root is role=presentation)", () => {
    const rules = [...strip(css("shell")).matchAll(/\.portal-shell>:not\(\.topbar\)([^{]*)\{margin-left:(\d+)(?:px)?\}/g)];
    expect(rules).toHaveLength(3);
    for (const rule of rules) expect(rule[1]).toContain(':not([role="presentation"])');
  });
});
