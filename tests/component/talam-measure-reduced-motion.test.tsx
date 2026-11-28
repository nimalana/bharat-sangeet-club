// The talam beat strip for a person who asked for reduced motion: it does not move, the downbeat rests at 0.7 and the other
// beats at 0.35 (features/dashboard/components/talam-measure.tsx). Its own file because framer-motion reads the preference once
// per module load. Values taken from the full `motion` version, before the strip moved to `m` + LazyMotion.
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TalamMeasure } from "../../features/dashboard/components/talam-measure";

it("holds still at its resting opacities and the label does not count", async () => {
  window.matchMedia = ((query: string) => ({ matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  vi.spyOn(Math, "random").mockReturnValue(0);
  const { container } = render(<TalamMeasure nextWhen="Saturday" onNavigate={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  const beats = [...container.querySelectorAll<HTMLElement>(".talam-track-beat")];
  expect(beats[0]).toHaveStyle({ opacity: "0.7", transform: "none" });
  expect(beats[1]).toHaveStyle({ opacity: "0.35", transform: "none" });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(container.querySelector(".measure-track b")?.textContent).toBe("Beat 1 of 16");
  expect(beats[0]).toHaveStyle({ opacity: "0.7" });
  expect(beats[1]).toHaveStyle({ opacity: "0.35" });
});
