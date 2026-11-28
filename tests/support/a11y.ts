// Accessibility checks for component tests, on top of axe-core (https://github.com/dequelabs/axe-core).
//
//   const { container } = render(<Thing />);
//   await expectNoSeriousViolations(container);
//
// Every axe rule runs and every violation of impact "serious" or "critical" fails the test, with the rule, the help text and the
// elements, so the failure says what to fix. Impact "moderate" and "minor" are not reported (they are mostly advice about page
// structure: a region, a heading order, a skip link; a single component rendered alone cannot satisfy them).
//
// Only ONE rule is switched off: "color-contrast". jsdom has no layout and no painted colours, so axe cannot compute a contrast
// ratio there (it would report "incomplete" or throw on getComputedStyle with a pseudo-element). Colour contrast of the focus ring,
// the buttons and the text is therefore NOT verified by these tests: it is checked by the ratios written in docs/UI_PATTERNS.md and
// by the coordinator's axe run on the real pages in a real browser.
//
// A fragment is audited as it is: it needs no landmark and no <h1>. A page-level rule that still reports on a fragment is a real
// finding of the component (a dialog without a name, a button without a name, a label that points nowhere).
import axe from "axe-core";

type Impact = "minor" | "moderate" | "serious" | "critical" | null | undefined;

/** The rules that cannot run in jsdom. Keep this list at one entry: add to it only with the reason written here. */
const DISABLED_IN_JSDOM = { "color-contrast": { enabled: false } };

const REPORTED: Impact[] = ["serious", "critical"];

export type AxeViolation = { rule: string; impact: string; help: string; targets: string[] };

/** The serious and critical violations of an element (or of the whole document), as plain data. Exported for the helper's own test. */
export async function seriousViolations(target: Element | Document = document): Promise<AxeViolation[]> {
  const results = await axe.run(target as axe.ElementContext, { rules: DISABLED_IN_JSDOM, resultTypes: ["violations"] });
  return results.violations
    .filter((violation) => REPORTED.includes(violation.impact))
    .map((violation) => ({ rule: violation.id, impact: String(violation.impact), help: violation.help, targets: violation.nodes.map((node) => node.target.join(" ")) }));
}

/** Fails the test when axe finds a serious or critical violation in `container` (default: the whole document). */
export async function expectNoSeriousViolations(container: Element | Document = document): Promise<void> {
  const found = await seriousViolations(container);
  if (found.length === 0) return;
  const lines = found.map((violation) => `  - ${violation.rule} (${violation.impact}): ${violation.help}\n      ${violation.targets.join("\n      ")}`);
  throw new Error(`${found.length} serious or critical accessibility violation(s) (colour contrast is not checked in jsdom):\n${lines.join("\n")}`);
}
