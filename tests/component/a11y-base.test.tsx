// The accessibility base of Phase 3 (plan 3.4): the focus ring, .sr-only, reduced motion, the 44px tap targets, IconButton, and the 12px floor
// for text. jsdom paints nothing, so what can be proved here is arithmetic and structure: the contrast of the ring's colours is computed from the
// tokens in styles/shared.css (the numbers are in docs/UI_PATTERNS.md), the rules are read from the stylesheets, and the components are checked for their
// classes and their names. That the ring is SEEN, and how the page looks with 12px text, is for a real browser.
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { IconButton } from "../../components/ui/icon-button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { expectNoSeriousViolations, seriousViolations } from "../support/a11y";
import { focusedName, keyboardUser } from "../support/keyboard";

const root = join(__dirname, "..", "..");
const sharedCss = readFileSync(join(root, "styles/shared.css"), "utf8");
const uiCss = readFileSync(join(root, "components/ui/ui.css"), "utf8");

// ---------------------------------------------------------------- colour arithmetic (WCAG 2.x relative luminance)
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const token = (name: string) => { const hit = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(sharedCss); if (!hit) throw new Error(`token --${name} not found in shared.css`); return hit[1]; };

describe("the focus ring", () => {
  const rule = /:focus-visible\s*\{([^}]*)\}/.exec(sharedCss)?.[1] ?? "";

  it("is one rule for every focusable element: two tones, ink outside and paper white between it and the element", () => {
    expect(rule).toMatch(/outline:\s*3px solid var\(--ink\)\s*!important/);
    expect(rule).toMatch(/box-shadow:\s*0 0 0 2px var\(--paper\)\s*!important/);
    expect(rule).toMatch(/outline-offset:\s*2px/);
  });

  it("the band between the ring and the element is exactly as wide as the offset, so the two tones touch", () => {
    const offset = Number(/outline-offset:\s*(\d+)px/.exec(rule)?.[1]);
    const band = Number(/box-shadow:\s*0 0 0 (\d+)px/.exec(rule)?.[1]);
    expect(band).toBe(offset);
  });

  it("at least one of the two tones is 3:1 or better against every background the portal puts under a focused element", () => {
    const ink = token("ink"), paper = token("paper");
    const backgrounds = { page: token("ivory"), white: paper, "pale blue": token("carolina-pale"), "dark header and footer": token("maroon-dark"), "carolina (a hovered button)": token("carolina"), line: token("line") };
    for (const [name, background] of Object.entries(backgrounds)) {
      const best = Math.max(contrast(ink, background), contrast(paper, background));
      expect(best, `${name}: ${best.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the ring it replaced (carolina blue alone) was not enough on the page and on pale blue: the reason for two tones", () => {
    const carolina = token("carolina");
    expect(contrast(carolina, token("ivory"))).toBeLessThan(3);
    expect(contrast(carolina, token("carolina-pale"))).toBeLessThan(3);
  });

  it("the numbers written in docs/UI_PATTERNS.md are the computed ones", () => {
    const docs = readFileSync(join(root, "docs/UI_PATTERNS.md"), "utf8");
    for (const [a, b] of [["ink", "ivory"], ["ink", "paper"], ["paper", "maroon-dark"]] as const) expect(docs).toContain(contrast(token(a), token(b)).toFixed(1));
  });

  it("no rule in the shared or ui stylesheets takes the ring away without putting one back (outline none is only for the dialog panel, which names itself)", () => {
    const withoutRing = [...(sharedCss + uiCss).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^}]*outline:\s*(?:none|0)\b[^}]*\}/g)].map((hit) => hit[1].trim());
    expect(withoutRing).toEqual([".search input", '[role="dialog"]:focus,[role="dialog"]:focus-visible']);
  });
});

describe(".sr-only", () => {
  it("hides a text from the eye and keeps it for a screen reader (the standard clip pattern, not display:none)", () => {
    const rule = /\.sr-only\s*\{([^}]*)\}/.exec(sharedCss)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/width:\s*1px/);
    expect(rule).toMatch(/height:\s*1px/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it("the text stays in the accessibility tree", () => {
    render(<button><span className="sr-only">Delete the announcement</span><span aria-hidden="true">×</span></button>);
    expect(screen.getByRole("button", { name: "Delete the announcement" })).toBeInTheDocument();
  });
});

describe("reduced motion", () => {
  const block = /@media \(prefers-reduced-motion:reduce\)\{\s*([^}]*)\}/.exec(sharedCss)?.[1] ?? "";

  it("turns off every transition and animation of every element, with their delays, and stops loops", () => {
    expect(block).toMatch(/^\*,\*:before,\*:after\{/);
    for (const declaration of ["scroll-behavior:auto", "transition-duration:.01ms", "transition-delay:0s", "animation-duration:.01ms", "animation-delay:0s", "animation-iteration-count:1"]) {
      expect(block, declaration).toContain(`${declaration}!important`);
    }
  });

  it("what moves by itself in components/ui is switched off too: the skeleton sweep and the upload bar", () => {
    expect(uiCss).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.skeleton\{animation:none\}\}/);
    expect(uiCss).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.upload-bar>span\{transition:none\}\}/);
  });
});

describe("tap targets of 44px on a small screen", () => {
  it("Button: 44px at every width by default; the small one is 36px on a wide screen and 44px under 700px", () => {
    render(<><Button>Save</Button><Button size="sm">Edit</Button></>);
    const [normal, small] = screen.getAllByRole("button");
    expect(normal.className).toContain("min-h-11");
    expect(small.className).toContain("min-h-9");
    expect(small.className).toContain("max-[700px]:min-h-11");
    expect(small.className).toContain("max-[700px]:min-w-11");
  });

  it("IconButton: a 36px square, 44px under 700px", () => {
    render(<IconButton aria-label="Close">×</IconButton>);
    const button = screen.getByRole("button", { name: "Close" });
    expect(button.className).toContain("size-9");
    expect(button.className).toContain("max-[700px]:size-11");
  });

  it("Input and Textarea are 44px or more at every width", () => {
    render(<><Input aria-label="Name" /><Textarea aria-label="Notes" /></>);
    expect(screen.getByRole("textbox", { name: "Name" }).className).toContain("h-11");
    expect(screen.getByRole("textbox", { name: "Notes" }).className).toContain("min-h-24");
  });

  it("the plain inputs of the stylesheets (modals included) are 44px, the legacy close button 44px under 700px", () => {
    expect(sharedCss).toMatch(/\.modal input,\.modal select \{[^}]*min-height:44px/);
    expect(sharedCss).toMatch(/input,select,textarea\{min-height:44px/);
    expect(sharedCss).toMatch(/@media \(max-width:700px\)\{\s*\.modal-close\{min-width:44px;min-height:44px\}/);
  });
});

describe("IconButton", () => {
  it("is a button named by its aria-label, with type button (it never submits a form by accident)", () => {
    render(<form onSubmit={(event) => event.preventDefault()}><IconButton aria-label="Close the editor">×</IconButton></form>);
    const button = screen.getByRole("button", { name: "Close the editor" });
    expect(button).toHaveAttribute("type", "button");
  });

  it("the type can be changed, the click and the disabled state are the button's", async () => {
    const onClick = vi.fn();
    const user = keyboardUser();
    const view = render(<IconButton aria-label="Save" type="submit" onClick={onClick}>✓</IconButton>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "submit");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    view.rerender(<IconButton aria-label="Save" disabled onClick={onClick}>✓</IconButton>);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard (Tab, then Enter or Space)", async () => {
    const onClick = vi.fn();
    const user = keyboardUser();
    render(<IconButton aria-label="Open the menu" onClick={onClick}>☰</IconButton>);
    await user.tab();
    expect(focusedName()).toBe("Open the menu");
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not compile without an aria-label (the type requires it); an icon with a name passes axe, one without is found", async () => {
    // @ts-expect-error aria-label is required: an icon-only button with no name is a type error, not a runtime surprise
    const unnamed = <IconButton><svg aria-hidden="true" /></IconButton>;
    const view = render(<div><IconButton aria-label="Close">×</IconButton><svg aria-hidden="true" /></div>);
    await expectNoSeriousViolations(view.container);
    view.unmount();
    const bare = render(unnamed);
    expect((await seriousViolations(bare.container)).map((violation) => violation.rule)).toEqual(["button-name"]);
    bare.unmount();
  });

  it("forwards a ref and a class", () => {
    let node: HTMLButtonElement | null = null;
    render(<IconButton aria-label="Close" className="ml-auto" ref={(element) => { node = element; }}>×</IconButton>);
    expect(node).toBe(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("ml-auto");
  });
});

describe("no text under 12px in the shared pieces", () => {
  const px = (value: string, unit: string) => (unit === "rem" ? Number(value) * 16 : Number(value));
  const small = (text: string) => [...text.matchAll(/font(?:-size)?:\s*(?:[^;}]*?\s)?(\d*\.?\d+)(px|rem)\b/g)].map((hit) => ({ text: hit[0], size: px(hit[1], hit[2]) })).filter((hit) => hit.size < 12);

  it("styles/shared.css and components/ui/ui.css", () => {
    expect(small(sharedCss)).toEqual([]);
    expect(small(uiCss)).toEqual([]);
  });

  it("the classes of every component in components/ui", () => {
    const dir = join(root, "components/ui");
    const found: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(join(dir, file), "utf8");
      for (const hit of source.matchAll(/text-\[(\d*\.?\d+)(px|rem)\]/g)) if (px(hit[1], hit[2]) < 12) found.push(`${file}: ${hit[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("Button, Badge and Input have a text of 12px or more", () => {
    render(<><Button size="sm">Edit</Button><Badge>Group</Badge><Input aria-label="x" /></>);
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("text-xs");
    expect(screen.getByText("Group").className).toContain("text-xs");
  });

  it("the check itself sees a small size (a test that cannot fail proves nothing)", () => {
    expect(small(".x{font-size:10px}.y{font:italic 7px/1 serif}.z{font-size:.7rem}")).toHaveLength(3);
    expect(small(".x{font-size:12px}.y{font:600 12px var(--ui)}.z{font-size:.75rem}")).toHaveLength(0);
  });
});
