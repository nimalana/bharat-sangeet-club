// F5: once the portal is drawn and the browser is idle, the files of the lazy screens a person can open are fetched, one per idle moment, so the first visit to
// Members or the Calendar is as quick as the second. features/shell/screen-loaders.ts names the files; here it is replaced by a table that records which were asked for.
// What no test here can say: that the fetched file is really in the browser's cache and that the first open is instant (tests/browser, the timings suite).
import { act, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdlePrefetch } from "../../features/shell/hooks/use-idle-prefetch";
import type { ClubRole } from "../../lib/sections";
import { fake, ok } from "../support/fake-supabase";
import { bootstrapAnswer, openPortal, renderPortal } from "../support/portal";

const probe = vi.hoisted(() => {
  const calls: string[] = [];
  const failing = new Set<string>();
  /** Files whose fetch is still on its way: `arrive()` lets them come in. */
  const held = new Set<string>();
  const arrivals: (() => void)[] = [];
  const names = ["attendance", "members", "calendar", "finance", "resources", "recordings", "clubArchive", "ownProfile", "completeProfile", "calendarDialogs"];
  // What a screen's file would hold: an empty module, except for the one a test draws (see "the lazy screens ask for their file through the same table").
  const modules: Record<string, unknown> = { members: { MembersPage: () => "The members page, as a stub" } };
  const arrive = () => { for (const resolve of arrivals.splice(0)) resolve(); };
  const screenLoaders = Object.fromEntries(names.map((name) => [name, () => {
    calls.push(name);
    if (failing.has(name)) return Promise.reject(new Error(`${name}: the file could not be fetched`));
    if (held.has(name)) return new Promise((resolve) => { arrivals.push(() => resolve(modules[name] ?? {})); });
    return Promise.resolve(modules[name] ?? {});
  }]));
  return { calls, failing, held, arrive, screenLoaders };
});
vi.mock("../../features/shell/screen-loaders", () => ({ screenLoaders: probe.screenLoaders }));

type Slot = { id: number; run: () => void; options?: { timeout?: number } };
let slots: Slot[] = [];
let cancelled: number[] = [];

/** One idle moment of the browser: runs the oldest waiting callback, then lets what it started finish (the next callback is asked for when a file has arrived). */
async function idleMoment() {
  const slot = slots.shift();
  if (!slot) throw new Error("nothing was waiting for an idle moment");
  await act(async () => { slot.run(); await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function untilQuiet() { while (slots.length) await idleMoment(); }
const connection = (value: { saveData?: boolean; effectiveType?: string }) => Object.defineProperty(navigator, "connection", { value, configurable: true });

const MEMBER_PLAN = ["calendar", "members", "attendance", "resources", "recordings", "finance", "ownProfile"];
const MANAGER_PLAN = [...MEMBER_PLAN, "calendarDialogs", "clubArchive"];

beforeEach(() => {
  probe.calls.length = 0;
  probe.failing.clear();
  probe.held.clear();
  slots = [];
  cancelled = [];
  let next = 1;
  vi.stubGlobal("requestIdleCallback", (run: () => void, options?: { timeout?: number }) => { slots.push({ id: next, run, options }); return next++; });
  vi.stubGlobal("cancelIdleCallback", (id: number) => { cancelled.push(id); slots = slots.filter((slot) => slot.id !== id); });
});
afterEach(() => { Reflect.deleteProperty(navigator, "connection"); });

const mount = (ready: boolean, role: ClubRole) => renderHook((props: { ready: boolean; role: ClubRole }) => useIdlePrefetch(props.ready, props.role), { initialProps: { ready, role } });

describe("the idle prefetch", () => {
  it("asks for nothing until the browser is idle", () => {
    mount(true, "member");
    expect(probe.calls).toEqual([]);
    expect(slots).toHaveLength(1);
  });

  it("fetches what a member can open, most likely first, one file per idle moment", async () => {
    mount(true, "member");
    await idleMoment();
    expect(probe.calls).toEqual(["calendar"]);
    await idleMoment();
    expect(probe.calls).toEqual(["calendar", "members"]);
    await untilQuiet();
    expect(probe.calls).toEqual(MEMBER_PLAN);
  });

  it("not the club archive, the calendar's forms or the first-sign-in step for a member (they are not theirs to open or are shown once)", async () => {
    mount(true, "member");
    await untilQuiet();
    for (const name of ["clubArchive", "calendarDialogs", "completeProfile"]) expect(probe.calls).not.toContain(name);
  });

  it.each(["executive", "admin"] as const)("adds the calendar's forms and the club archive manager for an %s", async (role) => {
    mount(true, role);
    await untilQuiet();
    expect(probe.calls).toEqual(MANAGER_PLAN);
  });

  it("asks the browser for a deadline, so a page that is never idle still gets its files", () => {
    mount(true, "member");
    expect(slots[0].options?.timeout).toBeGreaterThan(0);
  });

  it("waits for the portal to be drawn (a person who is pending, rejected, deactivated, or not signed in fetches nothing)", async () => {
    const view = mount(false, "member");
    expect(slots).toHaveLength(0);
    view.rerender({ ready: true, role: "member" });
    expect(slots).toHaveLength(1);
    await untilQuiet();
    expect(probe.calls).toEqual(MEMBER_PLAN);
  });

  it("stops when the person leaves (sign-out, or the portal going away): what was waiting is cancelled and a callback already due does nothing", async () => {
    const view = mount(true, "member");
    await idleMoment();
    const waiting = slots[0];
    view.rerender({ ready: false, role: "member" });
    expect(cancelled).toContain(waiting.id);
    expect(slots).toHaveLength(0);
    waiting.run();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(probe.calls).toEqual(["calendar"]);
    expect(slots).toHaveLength(0);
  });

  it("stops when the person leaves while a file is still on its way: when it arrives nothing more is asked for", async () => {
    probe.held.add("calendar");
    const view = mount(true, "member");
    await idleMoment();
    view.rerender({ ready: false, role: "member" });
    await act(async () => { probe.arrive(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(slots).toHaveLength(0);
    expect(probe.calls).toEqual(["calendar"]);
  });

  it("stops when the hook unmounts", () => {
    const view = mount(true, "member");
    view.unmount();
    expect(slots).toHaveLength(0);
    expect(cancelled).toHaveLength(1);
  });

  it("starts the plan of the new role when the role changes", async () => {
    const view = mount(true, "member");
    await untilQuiet();
    probe.calls.length = 0;
    view.rerender({ ready: true, role: "executive" });
    await untilQuiet();
    expect(probe.calls).toEqual(MANAGER_PLAN);
  });

  describe("a connection that should not be spent on a guess", () => {
    it("the browser says the person wants less data (saveData)", () => {
      connection({ saveData: true, effectiveType: "4g" });
      mount(true, "member");
      expect(slots).toHaveLength(0);
    });

    it.each(["2g", "slow-2g"])("a %s connection", (effectiveType) => {
      connection({ effectiveType });
      mount(true, "member");
      expect(slots).toHaveLength(0);
    });

    it("a 4g connection that does not ask to save data is fetched on", async () => {
      connection({ saveData: false, effectiveType: "4g" });
      mount(true, "member");
      await untilQuiet();
      expect(probe.calls).toEqual(MEMBER_PLAN);
    });
  });

  describe("a file that cannot be fetched", () => {
    it("is not an error here (no unhandled rejection, no message) and the others are still fetched", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        probe.failing.add("calendar");
        mount(true, "member");
        await untilQuiet();
        expect(probe.calls).toEqual(MEMBER_PLAN);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).not.toHaveBeenCalled();
      } finally { process.off("unhandledRejection", unhandled); }
    });

    it("is asked for again the next time the person is ready (nothing remembers the failure)", async () => {
      probe.failing.add("members");
      const view = mount(true, "member");
      await untilQuiet();
      probe.failing.clear();
      probe.calls.length = 0;
      view.rerender({ ready: false, role: "member" });
      view.rerender({ ready: true, role: "member" });
      await untilQuiet();
      expect(probe.calls).toContain("members");
    });
  });

  describe("a browser without requestIdleCallback (Safari)", () => {
    it("falls back to a timer of a couple of seconds, so it still waits for the page to settle", async () => {
      vi.stubGlobal("requestIdleCallback", undefined);
      vi.useFakeTimers();
      mount(true, "member");
      await vi.advanceTimersByTimeAsync(1000);
      expect(probe.calls).toEqual([]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(probe.calls).toEqual(["calendar"]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(probe.calls).toEqual(["calendar", "members"]);
    });

    it("cancels the timer when the person leaves", async () => {
      vi.stubGlobal("requestIdleCallback", undefined);
      vi.useFakeTimers();
      const view = mount(true, "member");
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(probe.calls).toEqual([]);
    });
  });
});

describe("in the portal", () => {
  it("a member who has signed in is offered nothing until the browser is idle, then the files of the screens they can open", async () => {
    openPortal({ role: "member" });
    await screen.findByText(/Welcome back/);
    expect(probe.calls).toEqual([]);
    await untilQuiet();
    expect(probe.calls).toEqual(MEMBER_PLAN);
  });

  it("an executive's plan includes the calendar's forms and the archive manager", async () => {
    openPortal({ role: "executive" });
    await screen.findByText(/Welcome back/);
    await untilQuiet();
    expect(probe.calls).toEqual(MANAGER_PLAN);
  });

  it.each(["pending", "rejected", "deactivated"])("a %s account fetches nothing", async (status) => {
    fake.signIn({ id: "u-me", email: "u-me@x.test" });
    fake.rpc("get_portal_bootstrap").reply(ok({ ...bootstrapAnswer("member"), profile: { full_name: "Asha Rao", role: "member", status } }));
    renderPortal();
    await screen.findByRole("button", { name: /sign out/i });
    await untilQuiet();
    expect(probe.calls).toEqual([]);
  });

  it("the landing page of a visitor who is not signed in fetches nothing", async () => {
    renderPortal();
    await screen.findByRole("button", { name: /member sign in/i });
    await untilQuiet();
    expect(probe.calls).toEqual([]);
  });

  it("the lazy screens ask for their file through the same table, so what was fetched is what is drawn", async () => {
    openPortal({ role: "member", page: "members" });
    expect(await screen.findByText("The members page, as a stub")).toBeInTheDocument();
    expect(probe.calls).toContain("members");
  });
});

describe("the first load", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

  it("the table names every file as a function with a literal path, which is what the bundler cuts into a file of its own", () => {
    const table = read("features/shell/screen-loaders.ts");
    const entries = [...table.matchAll(/^\s+\w+: \(\) => import\("(\.\.\/[^"]+)"\),$/gm)];
    expect(entries).toHaveLength(10);
  });

  it("nothing but the table imports a lazy screen: the lazy wrappers and the prefetch go through it", () => {
    for (const file of ["features/shell/components/lazy-screens.tsx", "features/shell/hooks/use-idle-prefetch.ts"]) {
      expect(read(file), file).not.toMatch(/\bimport\(/);
      expect(read(file), file).not.toMatch(/from "\.\.\/\.\.\/(attendance|members|calendar|finance|resources|recordings)\//);
    }
  });
});
