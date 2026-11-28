// Keyboard walkthroughs for component tests, on top of @testing-library/user-event.
//
//   const user = keyboardUser();
//   await user.tab();                                   // real Tab: focus moves as in a browser (user-event computes the tab order)
//   expect(focusedName()).toBe("Cancel");
//   await user.keyboard("{Escape}");
//   expect(await tabOrder(user, 4)).toEqual(["Cancel", "Delete", "Cancel", "Delete"]);   // the trap wraps
//
// With fake timers (vi.useFakeTimers()) pass { fakeTimers: true }, or user-event waits on a clock that never moves. (Testing Library
// only moves a fake clock for it when it finds a `jest` global; the helper gives it one that calls Vitest's clock. tests/component/setup.ts
// removes it after the test.)
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

export function keyboardUser(options: { fakeTimers?: boolean } = {}) {
  if (options.fakeTimers) vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime.bind(vi) });
  return userEvent.setup(options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime.bind(vi) } : {});
}

type User = ReturnType<typeof keyboardUser>;

/** What a person (or a screen reader) would call the focused element: its aria-label, else its own text, else its tag. */
export function focusedName(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "(page)";
  return element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName.toLowerCase();
}

/** Presses Tab `count` times and returns the name of the element focused after each press (Shift+Tab: pass { shift: true }). */
export async function tabOrder(user: User, count: number, options: { shift?: boolean } = {}): Promise<string[]> {
  const names: string[] = [];
  for (let step = 0; step < count; step += 1) {
    await (options.shift ? user.tab({ shift: true }) : user.tab());
    names.push(focusedName());
  }
  return names;
}
