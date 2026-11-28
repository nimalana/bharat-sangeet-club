// One smoke test per screen a role can reach: open the screen by its address, wait for its content, check what the role must not see,
// take the baseline screenshots. The browser guard (support/test.mjs) fails the test on any console error, page error or unexpected HTTP 4xx/5xx.
import { test, expect } from "./test.mjs";
import { loadState } from "./state.mjs";
import { NAV, expectAbsences, expectLandmarks, openScreen, profileKind } from "./screens.mjs";
import { shoot } from "./shots.mjs";

export const fx = () => loadState().fx;

// `options.expected(guard)` lists the refusals this screen is allowed to hit (each with a reason).
export function smokeScreen(role, screen, options = {}) {
  const kind = profileKind(role);
  const define = options.fixme ? test.fixme : test;
  define(`${role} opens ${screen} and sees what it should${options.fixme ? ` [finding ${options.fixme}]` : ""}`, async ({ page, guard }) => {
    options.expected?.(guard);
    await openScreen(page, screen);
    await expectLandmarks(page, screen, kind, fx());
    await expectAbsences(page, screen, kind, fx());
    await options.after?.(page, { guard, fx: fx() });
    if (options.shot !== false) await shoot(page, { role, screen, run: fx().run });
  });
}

export function navTest(role, expectedLabels, refusedScreens = []) {
  test(`${role}: the navigation lists exactly what this role may open${refusedScreens.length ? " and the rest is refused" : ""}`, async ({ page }) => {
    await openScreen(page, "home");
    const nav = page.getByRole("navigation", { name: "Portal navigation" });
    await expect(nav.getByRole("button")).toHaveText(expectedLabels);
    for (const screen of refusedScreens) {
      await openScreen(page, screen);
      await expect(page.getByRole("heading", { name: /is not available to your account/ })).toBeVisible();
      await expect(page.getByText("Ask a club administrator if you think you should have access.")).toBeVisible();
    }
  });
}

export { NAV };
