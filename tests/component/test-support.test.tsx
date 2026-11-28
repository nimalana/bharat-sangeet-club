// tests/support/a11y.ts and tests/support/keyboard.ts: the helpers every Phase 3 test uses. If they stopped looking, every
// accessibility test that follows would pass for nothing, so each promise is tested here:
//   - a markup with a serious problem (a field with no label, a button with no name) FAILS expectNoSeriousViolations
//     and the failure names the rule;
//   - clean markup passes;
//   - only serious and critical violations count (a skipped heading level is moderate: not reported);
//   - colour contrast is the one rule that is off (jsdom cannot compute it);
//   - tabOrder walks the real tab order, Shift+Tab goes back, and the focused name is the aria-label first.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations, seriousViolations } from "../support/a11y";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";

describe("expectNoSeriousViolations", () => {
  it("passes for markup with names and labels", async () => {
    const { container } = render(<main><h1>Title</h1><label>Name<input /></label><button>Save</button><svg role="img" aria-label="The club mark" /></main>);
    await expectNoSeriousViolations(container);
  });

  it("fails for a field without a label and a button without a name, and says which rules", async () => {
    const { container } = render(<div><input /><button /></div>);
    const found = await seriousViolations(container);
    expect(found.map((violation) => violation.rule).sort()).toEqual(["button-name", "label"]);
    expect(found.every((violation) => violation.impact === "critical")).toBe(true);
    await expect(expectNoSeriousViolations(container)).rejects.toThrow(/label \(critical\)/);
  });

  it("does not report moderate findings (a skipped heading level) and does not run colour contrast", async () => {
    const { container } = render(<div><h1>One</h1><h4 style={{ color: "#fff", background: "#fff" }}>Four, white on white</h4></div>);
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe("keyboard helpers", () => {
  it("tabOrder follows the real tab order and Shift+Tab goes back; the name is the aria-label, else the text", async () => {
    render(<div><button aria-label="Close">×</button><a href="/x">Read more</a><input aria-label="Search" /><button disabled>Never</button></div>);
    const user = keyboardUser();
    expect(focusedName()).toBe("(page)");
    // After the last control the focus leaves the page (the browser's own toolbar), as in a browser: "(page)"; the next Tab starts again.
    expect(await tabOrder(user, 5)).toEqual(["Close", "Read more", "Search", "(page)", "Close"]);
    expect(await tabOrder(user, 2, { shift: true })).toEqual(["(page)", "Search"]);
  });
});
