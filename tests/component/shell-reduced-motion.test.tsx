// Phase 3.4: a scroll started by script follows "reduce motion" (the CSS rule in styles/shared.css stops transitions and `scroll-behavior`, but not
// `window.scrollTo({ behavior: "smooth" })`). The two places in the shell's areas that scroll by script: choosing a page (use-portal-navigation.ts)
// and the club mark of the public site (public-site.tsx).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublicSite } from "../../features/public/components/public-site";
import { openPortal } from "../support/portal";

const nav = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Portal navigation" })).getByRole("button", { name }));
/** matchMedia that answers "yes" to prefers-reduced-motion: reduce only. */
const prefersReducedMotion = () => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));

describe("choosing a page scrolls to the top", () => {
  it("smoothly, as always", async () => {
    openPortal();
    await screen.findByText(/Welcome back/);
    nav("Members");
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  });

  it("at once for a person who asked for less motion", async () => {
    prefersReducedMotion();
    openPortal();
    await screen.findByText(/Welcome back/);
    nav("Members");
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });

  it("smoothly when the browser cannot say (matchMedia throws)", async () => {
    vi.stubGlobal("matchMedia", () => { throw new Error("no matchMedia"); });
    openPortal();
    await screen.findByText(/Welcome back/);
    nav("Members");
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  });
});

describe("the club mark of the public site scrolls to the top", () => {
  it("smoothly, as always", () => {
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    fireEvent.click(within(document.querySelector(".public-header") as HTMLElement).getByRole("button", { name: /Bharat Sangeet/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
  });

  it("at once for a person who asked for less motion", () => {
    prefersReducedMotion();
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    fireEvent.click(within(document.querySelector(".public-header") as HTMLElement).getByRole("button", { name: /Bharat Sangeet/ }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
  });
});
