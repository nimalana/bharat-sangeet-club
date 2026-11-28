// The stylesheets and classes of the content area (recordings, resources) keep the floor of Phase 3.4: no text under 12px, a hit area of
// 44px on a phone, a visible focus when a rule takes the outline away, and nothing that makes a side panel the containing block of the
// dialogs opened inside it. jsdom paints nothing, so these read the source; what the page looks like is the coordinator's browser check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = ["features/recordings/recordings.css", "features/resources/components/resources.module.css", "features/resources/resources.css"];
const sources = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
});
const TSX = [...sources("features/recordings"), ...sources("features/resources")].filter((path) => path.endsWith(".tsx"));

const px = (value: string, unit: string) => (unit === "rem" ? Number(value) * 16 : Number(value));
const small = (text: string) => [...text.matchAll(/font(?:-size)?:\s*(?:[^;}]*?\s)?(\d*\.?\d+)(px|rem)\b/g)].map((hit) => ({ text: hit[0], size: px(hit[1], hit[2]) })).filter((hit) => hit.size < 12);
const withoutOutline = (text: string) => [...text.matchAll(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\b[^}]*\}/g)].map((hit) => hit[1].trim());
// The selectors of the rules that remove the outline, minus those whose first class has a focus rule (`.x:focus`, `.x:focus-within`,
// `.x:focus-visible`) that draws something instead: a shadow, a border colour or an outline of its own.
const withoutFocusStyle = (text: string) => {
  const drawn = [...text.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)].filter((rule) => /box-shadow|border-color|outline:\s*\d/.test(rule[2])).map((rule) => rule[1]);
  return withoutOutline(text).flatMap((selector) => selector.split(",")).map((part) => part.trim()).filter((part) => {
    const base = /\.[\w-]+/.exec(part)?.[0];
    return !base || !drawn.some((focus) => focus.includes(base));
  });
};

describe("no text under 12px in the content area", () => {
  it.each(CSS)("%s", (path) => { expect(small(read(path))).toEqual([]); });

  it("the text-[...] classes of the area's components", () => {
    const found: string[] = [];
    for (const path of TSX) for (const hit of readFileSync(join(root, path), "utf8").matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) if (px(hit[1], hit[2]) < 12) found.push(`${path}: ${hit[0]}`);
    expect(found).toEqual([]);
  });

  it("the check itself sees a small size (a test that cannot fail proves nothing)", () => {
    expect(small(".x{font-size:10px}.y{font:italic 7px/1 serif}.z{font-size:.7rem}")).toHaveLength(3);
    expect(small(".x{font-size:12px}.y{font:600 12px var(--ui)}.z{font-size:.75rem}")).toHaveLength(0);
  });
});

describe("a rule that takes the outline away puts a focus style back", () => {
  it.each(CSS)("%s", (path) => { expect(withoutFocusStyle(read(path))).toEqual([]); });

  it("the check itself sees a rule without one", () => {
    expect(withoutFocusStyle(".a input{outline:0}.b{outline:3px solid red}")).toEqual([".a input"]);
    expect(withoutFocusStyle(".a input{outline:0}.a:focus-within{box-shadow:0 0 0 3px blue}")).toEqual([]);
    expect(withoutFocusStyle(".a input{outline:0}.b:focus{box-shadow:0 0 0 3px blue}")).toEqual([".a input"]);
  });
});

describe("a hit area of 44px on a phone (resources)", () => {
  const css = read("features/resources/components/resources.module.css");
  const phone = [...css.matchAll(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/g)].map((hit) => hit[1]).join("\n");

  it("the close buttons and the folder path are 44px high below 700px", () => {
    expect(phone).toMatch(/\.iconButton \{[^}]*width: 44px[^}]*height: 44px/);
    expect(phone).toMatch(/\.breadcrumbRow button \{[^}]*min-height: 44px/);
  });

  it("the buttons, tabs, toggle, fields and rows are 44px high at every width", () => {
    expect(css).toMatch(/\.addButton, \.primaryButton, \.secondaryButton \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.tabs button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.viewToggle button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.search input \{[^}]*height: 44px/);
    expect(css).toMatch(/\.selectWrap select \{[^}]*height: 44px/);
    expect(css).toMatch(/\.form input, \.form select \{[^}]*min-height: 44px/);
  });
});

describe("the side panels", () => {
  const css = read("features/resources/components/resources.module.css");

  it("their reveal does not keep a transform once it has run (a transform makes the panel the containing block of the dialogs opened inside it)", () => {
    const panel = /\.composer, \.detailPanel \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(panel).toMatch(/animation: reveal [^;]*\bbackwards\b/);
    expect(panel).not.toMatch(/animation:[^;]*\b(both|forwards)\b/);
    expect(panel).not.toMatch(/(^|[;{\s])(transform|filter|backdrop-filter|will-change|contain):/);
  });

  it("they stop moving for a person who asks for less motion", () => {
    expect(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.composer, \.detailPanel[^}]*animation: none/.test(css)).toBe(true);
  });

  it("they sit against the right edge, as tall as the screen, and take the whole width on a phone", () => {
    expect(css).toMatch(/\.composer, \.detailPanel \{[^}]*justify-self: end[^}]*height: 100dvh[^}]*margin: -1rem -1rem -1rem 0/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.composer, \.detailPanel \{ width: calc\(100% \+ 2rem\); margin-left: -1rem; \}/);
  });
});
