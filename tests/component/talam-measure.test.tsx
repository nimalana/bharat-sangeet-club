// The talam beat strip on the dashboard (features/dashboard/components/talam-measure.tsx).
//
// It animates with framer-motion's `m` component under LazyMotion (animation features only) instead of the full
// `motion` component, to keep the layout/drag/gesture code out of the first load of `/`. These tests pin what a
// person sees, taken from the full `motion` version before the change (the same run on both gave the same markup and
// the same in-between values at every step): the current beat grows and brightens, the others rest at 0.28, the
// label counts, and the strip moves on every 700 ms. They fail when `m.*` has no features (LazyMotion removed or
// given no animation set): the beats then never get a style.
// The reduced-motion case is in talam-measure-reduced-motion.test.tsx (the preference is read once per module).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TalamMeasure } from "../../features/dashboard/components/talam-measure";

const beats = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".talam-track-beat")];
const label = (container: HTMLElement) => container.querySelector(".measure-track b")?.textContent;
// In steps of 50 ms, each inside its own act(): one big step would only render the state change of a tick at its end.
const advance = async (ms: number) => { for (let left = ms; left > 0; left -= 50) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(50, left)); }); };

describe("TalamMeasure", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0); // Teentaal: 16 beats in four groups of four
  });

  // framer-motion keeps one animation frame loop for the whole module. A test that ends with a frame still
  // scheduled on the fake clock would leave the loop waiting for a frame that never comes, and the next test
  // would see no animation: unmount, then let the pending frame run out before the clock is restored.
  afterEach(async () => {
    cleanup();
    await vi.advanceTimersByTimeAsync(100);
  });

  it("shows the chosen talam, with the first beat as the downbeat", () => {
    const { container } = render(<TalamMeasure nextWhen="Saturday" onNavigate={() => {}} />);
    expect(container.querySelector(".measure-index")?.textContent).toBe("TALA / TAAL16TeentaalHindustani");
    expect(container.querySelectorAll(".talam-division")).toHaveLength(4);
    expect(beats(container)).toHaveLength(16);
    expect(beats(container)[0]).toHaveClass("downbeat");
    expect(beats(container)[1]).not.toHaveClass("downbeat");
    expect(label(container)).toBe("Beat 1 of 16");
  });

  it("animates the current beat up and the others down, and the label fades in", async () => {
    const { container } = render(<TalamMeasure nextWhen="Saturday" onNavigate={() => {}} />);
    await advance(100); // 0.18 s transition under way: values between the rest state and the target
    const midway = Number.parseFloat(beats(container)[1].style.opacity);
    expect(midway).toBeGreaterThan(0.28);
    expect(midway).toBeLessThan(0.5);
    await advance(300); // settled
    expect(beats(container)[0]).toHaveStyle({ opacity: "1", transform: "scaleY(1.45)" });
    expect(beats(container)[1]).toHaveStyle({ opacity: "0.28", transform: "none" });
    expect(beats(container)[15]).toHaveStyle({ opacity: "0.28", transform: "none" });
    expect(container.querySelector(".measure-track b")).toHaveStyle({ opacity: "1" });
  });

  it("moves to the next beat every 700 ms and the one it leaves returns to rest", async () => {
    const { container } = render(<TalamMeasure nextWhen="Saturday" onNavigate={() => {}} />);
    await advance(300);
    expect(label(container)).toBe("Beat 1 of 16");
    await advance(700); // 1000 ms: the tick at 700 ms and its transition are done
    expect(label(container)).toBe("Beat 2 of 16");
    expect(beats(container)[1]).toHaveStyle({ opacity: "1", transform: "scaleY(1.45)" });
    expect(beats(container)[0]).toHaveStyle({ opacity: "0.28", transform: "none" });
    await advance(700);
    expect(label(container)).toBe("Beat 3 of 16");
    expect(beats(container)[2]).toHaveStyle({ opacity: "1", transform: "scaleY(1.45)" });
    expect(beats(container)[1]).toHaveStyle({ opacity: "0.28", transform: "none" });
  });

  it("stops moving while the page is hidden", async () => {
    const { container } = render(<TalamMeasure nextWhen="Saturday" onNavigate={() => {}} />);
    await advance(300);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(3000);
    expect(label(container)).toBe("Beat 1 of 16");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(1000);
    expect(label(container)).toBe("Beat 2 of 16");
  });
});
