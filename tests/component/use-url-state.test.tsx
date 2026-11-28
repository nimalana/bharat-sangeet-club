// lib/hooks/use-url-state.ts: screen state kept in the address bar. What the screens that adopt it rely on: the value is read from the
// address after mount (no hydration mismatch, no window access while rendering); a missing or invalid parameter is the default and never
// throws; setting the default removes the parameter; other parameters (?page=) and the hash are kept; Back and Forward restore the value;
// the changes of one tick are ONE history entry; and a value that is already there writes nothing.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { oneOf, positiveInteger, useUrlState } from "../../lib/hooks/use-url-state";
import { usePortalNavigation } from "../../features/shell/hooks/use-portal-navigation";
import { sectionFromSearch } from "../../lib/sections";

const TABS = ["overview", "meetings", "excuses"] as const;
type Tab = (typeof TABS)[number];
const parseTab = oneOf(TABS);

const at = (url: string) => window.history.replaceState({}, "", url);
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const flushTick = () => act(async () => { await Promise.resolve(); });

function TabScreen({ mode = "push" }: { mode?: "push" | "replace" }) {
  const [tab, setTab] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: mode });
  return <>
    <p data-testid="tab">{tab}</p>
    {TABS.map((name) => <button key={name} onClick={() => setTab(name)}>{name}</button>)}
  </>;
}
const shownTab = () => screen.getByTestId("tab").textContent;

describe("reading the address", () => {
  it("is the default when the parameter is absent", () => {
    at("/?page=attendance");
    render(<TabScreen />);
    expect(shownTab()).toBe("overview");
  });

  it("is the value the address holds, read after mount", () => {
    at("/?page=attendance&tab=meetings");
    render(<TabScreen />);
    expect(shownTab()).toBe("meetings");
  });

  it("a screen that mounts on the client has the address's value in its very first render (no flash of the default)", () => {
    at("/?tab=excuses");
    const rendered: Tab[] = [];
    function Probe() {
      const [tab] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: "push" });
      rendered.push(tab);
      return null;
    }
    render(<Probe />);
    expect(rendered[0]).toBe("excuses");
    expect(new Set(rendered)).toEqual(new Set(["excuses"]));
  });

  it.each(["zzz", "", "MEETINGS", "meetings%20", "constructor", "__proto__"])("ignores an invalid value (%j): the default, no error", (bad) => {
    at(`/?tab=${bad}`);
    render(<TabScreen />);
    expect(shownTab()).toBe("overview");
  });

  it("ignores a value that makes parse throw, and one that parse answers null or undefined for", () => {
    at("/?a=boom&b=nothing&c=null");
    function Probe() {
      const [a] = useUrlState("a", { parse: () => { throw new Error("bad"); }, defaultValue: "A-default", history: "push" });
      const [b] = useUrlState<string>("b", { parse: () => undefined, defaultValue: "B-default", history: "push" });
      const [c] = useUrlState<string>("c", { parse: () => null, defaultValue: "C-default", history: "push" });
      return <p data-testid="out">{[a, b, c].join(",")}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("out")).toHaveTextContent("A-default,B-default,C-default");
  });

  it("an empty parameter (?view=) is not a value: the default, even where the default is not empty", () => {
    at("/?view=");
    function Probe() {
      const [view] = useUrlState("view", { defaultValue: "grid", history: "replace" });
      return <p data-testid="out">{view}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("out")).toHaveTextContent("grid");
  });

  it("keeps a value that is falsy but valid (0, empty text from parse)", () => {
    at("/?n=0");
    function Probe() {
      const [n] = useUrlState<number>("n", { parse: (raw) => Number(raw), defaultValue: 5, history: "push" });
      return <p data-testid="out">{n}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("out")).toHaveTextContent("0");
  });

  it("does not write to the address, however it was read", () => {
    at("/?tab=bad&page=attendance");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<TabScreen />);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(address()).toBe("/?tab=bad&page=attendance");
  });

  it("text and numbers: the default parse is the text itself, positiveInteger and oneOf are strict", () => {
    expect(positiveInteger("7")).toBe(7);
    for (const bad of ["0", "-1", "1.5", "7abc", "007", "", "99999999999999999999", "9007199254740993"]) expect(positiveInteger(bad)).toBeUndefined();
    expect(positiveInteger("9007199254740991")).toBe(9007199254740991);
    expect(oneOf(["a", "b"] as const)("b")).toBe("b");
    expect(oneOf(["a", "b"] as const)("c")).toBeUndefined();
    at("/?q=sa%20re");
    function Probe() {
      const [q] = useUrlState("q", { defaultValue: "", history: "replace" });
      return <p data-testid="out">{q}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("out")).toHaveTextContent("sa re");
  });
});

describe("server rendering", () => {
  it("renders the default on the server without touching window", () => {
    at("/?tab=meetings");
    vi.stubGlobal("window", undefined);
    const html = renderToString(<TabScreen />);
    vi.unstubAllGlobals();
    expect(html).toContain(">overview<");
  });

  it("hydrates the server's markup without a mismatch and then shows what the address holds", async () => {
    at("/?tab=meetings");
    vi.stubGlobal("window", undefined);
    const html = renderToString(<TabScreen />);
    vi.unstubAllGlobals();
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { hydrateRoot(container, <TabScreen />); });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=tab]")?.textContent).toBe("meetings");
    container.remove();
  });
});

describe("writing the address", () => {
  it("push: a new entry with ?tab=, the other parameters and the hash kept, in their order", async () => {
    at("/portal?page=documents&folder=12#top");
    const push = vi.spyOn(window.history, "pushState");
    const before = window.history.length;
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "meetings" }));
    await flushTick();
    expect(address()).toBe("/portal?page=documents&folder=12&tab=meetings#top");
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.history.length).toBe(before + 1);
    expect(shownTab()).toBe("meetings");
    expect(sectionFromSearch(window.location.search)).toBe("documents");
  });

  it("replace: the current entry is overwritten", async () => {
    at("/?page=attendance");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const before = window.history.length;
    render(<TabScreen mode="replace" />);
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(address()).toBe("/?page=attendance&tab=excuses");
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.history.length).toBe(before);
    expect(shownTab()).toBe("excuses");
  });

  it("setting the default removes the parameter, and the address of a screen in its usual state is clean", async () => {
    at("/?page=attendance&tab=meetings");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "overview" }));
    await flushTick();
    expect(address()).toBe("/?page=attendance");
    expect(shownTab()).toBe("overview");
  });

  it("with nothing else in the address, setting the default leaves the bare path with no ?", async () => {
    at("/portal?tab=meetings");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "overview" }));
    await flushTick();
    expect(address()).toBe("/portal");
    expect(window.location.href.endsWith("/portal")).toBe(true);
  });

  it("text is written the way URLSearchParams writes it and read back unchanged", async () => {
    at("/?page=members");
    function Search() {
      const [q, setQ] = useUrlState("q", { defaultValue: "", history: "replace" });
      return <><p data-testid="out">{q}</p><button onClick={() => setQ("a b&c=d")}>set</button></>;
    }
    render(<Search />);
    fireEvent.click(screen.getByRole("button", { name: "set" }));
    await flushTick();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("a b&c=d");
    expect(screen.getByTestId("out")).toHaveTextContent("a b&c=d");
  });

  it("serialize writes the value, parse reads it back (an id, a month)", async () => {
    at("/");
    function Month() {
      const [month, setMonth] = useUrlState<{ y: number; m: number }>("month", {
        parse: (raw) => { const hit = /^(\d{4})-(\d{2})$/.exec(raw); return hit ? { y: Number(hit[1]), m: Number(hit[2]) } : undefined; },
        serialize: ({ y, m }) => `${y}-${String(m).padStart(2, "0")}`,
        defaultValue: { y: 2026, m: 1 },
        history: "push",
      });
      return <><p data-testid="out">{month.y}/{month.m}</p><button onClick={() => setMonth({ y: 2026, m: 11 })}>nov</button></>;
    }
    render(<Month />);
    fireEvent.click(screen.getByRole("button", { name: "nov" }));
    await flushTick();
    expect(address()).toBe("/?month=2026-11");
    expect(screen.getByTestId("out")).toHaveTextContent("2026/11");
  });

  it("a value that is already in the address writes nothing", async () => {
    at("/?tab=meetings");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "meetings" }));
    await flushTick();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("the default, when the address has no parameter, writes nothing; an explicit usual value is not rewritten either", async () => {
    at("/?page=attendance");
    const push = vi.spyOn(window.history, "pushState");
    const view = render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "overview" }));
    await flushTick();
    expect(push).not.toHaveBeenCalled();
    view.unmount();
    at("/?tab=overview");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "overview" }));
    await flushTick();
    expect(push).not.toHaveBeenCalled();
    expect(address()).toBe("/?tab=overview");
  });
});

describe("Back and Forward", () => {
  it("restore the value of the entry they return to", async () => {
    at("/?page=attendance");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "meetings" }));
    await flushTick();
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(shownTab()).toBe("excuses");
    act(() => window.history.back());
    await waitFor(() => expect(shownTab()).toBe("meetings"));
    act(() => window.history.back());
    await waitFor(() => expect(shownTab()).toBe("overview"));
    act(() => window.history.forward());
    await waitFor(() => expect(shownTab()).toBe("meetings"));
  });

  it("a popstate to an address with an invalid value shows the default", async () => {
    at("/?tab=meetings");
    render(<TabScreen />);
    act(() => { window.history.pushState({}, "", "/?tab=nonsense"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(shownTab()).toBe("overview");
  });

  it("stops listening when the screen goes away", () => {
    at("/?tab=meetings");
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<TabScreen />);
    const ours = (calls: unknown[][]) => calls.map(([type]) => type).filter((type) => type === "popstate" || type === "url-state-written").sort();
    const added = ours(add.mock.calls);
    expect(added).toEqual(["popstate", "url-state-written"]);
    view.unmount();
    expect(ours(remove.mock.calls)).toEqual(added);
  });

  it("setValue called where there is no window does nothing, now or later", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    const grabbed: Array<(next: Tab) => void> = [];
    function Grab() {
      const [, set] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: "push" });
      useEffect(() => { grabbed.push(set); }, [set]);
      return null;
    }
    render(<Grab />);
    vi.stubGlobal("window", undefined);
    expect(() => grabbed[0]("meetings")).not.toThrow();
    vi.unstubAllGlobals();
    await flushTick();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the changes of one tick", () => {
  function Two({ firstMode = "push", secondMode = "push" }: { firstMode?: "push" | "replace"; secondMode?: "push" | "replace" }) {
    const [tab, setTab] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: firstMode });
    const [folder, setFolder] = useUrlState<number | null>("folder", { parse: positiveInteger, defaultValue: null, history: secondMode });
    return <>
      <p data-testid="out">{tab}/{String(folder)}</p>
      <button onClick={() => { setTab("meetings"); setFolder(12); }}>both</button>
      <button onClick={() => { setTab("meetings"); setTab("excuses"); }}>same key twice</button>
      <button onClick={() => { setTab("meetings"); setTab("overview"); }}>there and back</button>
    </>;
  }

  it("two keys set together are written as ONE entry, and one Back undoes both", async () => {
    at("/?page=documents");
    const push = vi.spyOn(window.history, "pushState");
    render(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "both" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(address()).toBe("/?page=documents&tab=meetings&folder=12");
    expect(screen.getByTestId("out")).toHaveTextContent("meetings/12");
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("overview/null"));
    expect(address()).toBe("/?page=documents");
  });

  it("the same key set twice: the last value wins, one entry", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    render(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "same key twice" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(address()).toBe("/?tab=excuses");
  });

  it("set and set back in one tick writes nothing", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    render(<Two />);
    fireEvent.click(screen.getByRole("button", { name: "there and back" }));
    await flushTick();
    expect(push).not.toHaveBeenCalled();
    expect(address()).toBe("/");
  });

  it("if one of them asks for push the entry is pushed; if all replace, it replaces", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const view = render(<Two firstMode="replace" secondMode="push" />);
    fireEvent.click(screen.getByRole("button", { name: "both" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    view.unmount();
    at("/");
    push.mockClear();
    render(<Two firstMode="replace" secondMode="replace" />);
    fireEvent.click(screen.getByRole("button", { name: "both" }));
    await flushTick();
    expect(push).not.toHaveBeenCalled();
    expect(replace.mock.calls.length).toBeGreaterThan(0);
    expect(address()).toBe("/?tab=meetings&folder=12");
  });

  it("a replace asked for after a push in the same tick does not turn the entry into a replace", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<Two firstMode="push" secondMode="replace" />);
    fireEvent.click(screen.getByRole("button", { name: "both" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("changes in two ticks are two entries", async () => {
    at("/");
    const push = vi.spyOn(window.history, "pushState");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "meetings" }));
    await flushTick();
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe("the hook", () => {
  it("two screens that use the same key stay in step", async () => {
    at("/");
    function Pair() {
      return <><TabScreen /><Mirror /></>;
    }
    function Mirror() {
      const [tab] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: "push" });
      return <p data-testid="mirror">{tab}</p>;
    }
    render(<Pair />);
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(screen.getByTestId("mirror")).toHaveTextContent("excuses");
  });

  it("setValue is the same function on every render, and an object made by parse keeps its identity until the address changes", async () => {
    at("/?pair=1-2");
    const setters = new Set<unknown>();
    const values = new Set<unknown>();
    const parsePair = (raw: string) => { const [a, b] = raw.split("-").map(Number); return { a, b }; };
    const none = { a: 0, b: 0 };
    function Probe() {
      const [pair, setPair] = useUrlState("pair", { parse: parsePair, defaultValue: none, serialize: (p) => `${p.a}-${p.b}`, history: "push" });
      const [, force] = useState(0);
      setters.add(setPair);
      values.add(pair);
      return <button onClick={() => force((n) => n + 1)}>again</button>;
    }
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    expect(setters.size).toBe(1);
    expect(values.size).toBe(1);
  });

  it("setValue uses the options of the latest render (a default that depends on a prop)", async () => {
    at("/");
    function Probe({ usual }: { usual: string }) {
      const [value, setValue] = useUrlState("view", { defaultValue: usual, history: "replace" });
      return <><p data-testid="out">{value}</p><button onClick={() => setValue("list")}>list</button></>;
    }
    const view = render(<Probe usual="grid" />);
    view.rerender(<Probe usual="list" />);
    fireEvent.click(screen.getByRole("button", { name: "list" }));
    await flushTick();
    // "list" is the usual value now: it is not written
    expect(address()).toBe("/");
    expect(screen.getByTestId("out")).toHaveTextContent("list");
  });

  it("works under StrictMode", async () => {
    at("/?tab=meetings");
    const push = vi.spyOn(window.history, "pushState");
    render(<StrictMode><TabScreen /></StrictMode>);
    expect(shownTab()).toBe("meetings");
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(push).toHaveBeenCalledTimes(1);
    expect(shownTab()).toBe("excuses");
  });

  it("does not change how ?page= works: the shell's own readers see the same page before and after", async () => {
    at("/?page=documents&folder=3");
    render(<TabScreen />);
    fireEvent.click(screen.getByRole("button", { name: "excuses" }));
    await flushTick();
    expect(sectionFromSearch(window.location.search)).toBe("documents");
    expect(new URLSearchParams(window.location.search).get("folder")).toBe("3");
  });

  it("lives with the shell's own navigation: a tab does not change the page, a page change leaves the tab behind, and Back brings both back", async () => {
    at("/?page=attendance");
    function Both() {
      const nav = usePortalNavigation({ user: null, loadData: () => {} });
      const [tab, setTab] = useUrlState<Tab>("tab", { parse: parseTab, defaultValue: "overview", history: "push" });
      return <>
        <p data-testid="out">{nav.section}/{tab}</p>
        <button onClick={() => setTab("meetings")}>tab</button>
        <button onClick={() => nav.navigate("documents")}>page</button>
      </>;
    }
    render(<Both />);
    fireEvent.click(screen.getByRole("button", { name: "tab" }));
    await flushTick();
    expect(screen.getByTestId("out")).toHaveTextContent("attendance/meetings");
    fireEvent.click(screen.getByRole("button", { name: "page" }));
    await flushTick();
    expect(address()).toBe("/?page=documents");
    expect(screen.getByTestId("out")).toHaveTextContent("documents/overview");
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("attendance/meetings"));
    expect(address()).toBe("/?page=attendance&tab=meetings");
  });
});
