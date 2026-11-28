// F3 of the browser check: a signed-in person must not see the prerendered public landing page before the portal. What jsdom can pin:
//  - the layout writes the early script into the <head>, exactly as features/shell/saved-session.ts has it (React would escape a quote or an
//    ampersand in a script's text, which would break it: the string has none);
//  - the script marks <html> (data-saved-session) when localStorage holds a saved sign-in, by the same rule as hasSavedSession(), and does
//    nothing when it does not, when the storage cannot be read, or when something else is stored;
//  - the stylesheet hides the landing page under that mark and nothing else;
//  - the shell removes the mark when the session check has answered, whichever way (signed in, signed out, nothing configured), and not before.
// Whether the landing is really not painted is for the real browser (a screenshot of the first frames with a saved session in place).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "../../app/layout";
import { PublicSite } from "../../features/public/components/public-site";
import { SAVED_SESSION_ATTRIBUTE, SAVED_SESSION_SCRIPT } from "../../features/shell/saved-session";
import { hasSavedSession } from "../../lib/api/auth";
import { fake, never, ok } from "../support/fake-supabase";
import { openPortal, renderPortal } from "../support/portal";

const root = join(__dirname, "..", "..");
const marked = () => document.documentElement.hasAttribute(SAVED_SESSION_ATTRIBUTE);
const runScript = () => new Function(SAVED_SESSION_SCRIPT)();

describe("the layout", () => {
  const html = renderToString(<RootLayout><p>page</p></RootLayout>);

  it("puts the early script, as it is written, in the head", () => {
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain(`<script>${SAVED_SESSION_SCRIPT}</script>`);
  });

  it("keeps the language of the page and the body around the children", () => {
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<p>page</p>");
  });

  it("the script has no character that React would write as an entity", () => {
    expect(SAVED_SESSION_SCRIPT).not.toMatch(/["'&<>]/);
  });
});

describe("the script", () => {
  it("marks the page when a sign-in is saved, and says which attribute", () => {
    expect(SAVED_SESSION_ATTRIBUTE).toBe("data-saved-session");
    window.localStorage.setItem("sb-abcdefgh-auth-token", "{}");
    runScript();
    expect(document.documentElement.getAttribute(SAVED_SESSION_ATTRIBUTE)).toBe("1");
    document.documentElement.removeAttribute(SAVED_SESSION_ATTRIBUTE);
  });

  it.each([
    ["nothing stored", {}],
    ["other keys", { theme: "dark", "sb-abcdefgh-auth-token-code-verifier": "x", "sb--auth-token": "x", "xsb-a-auth-token": "x" }],
  ])("does nothing when %s is in the storage", (_label, stored) => {
    for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value);
    runScript();
    expect(marked()).toBe(false);
  });

  it.each(["sb-a-auth-token", "sb-bldytniesexkwbtyinsi-auth-token", "sb-a-b-c-auth-token", "sb-a-auth-token-code-verifier", "sb--auth-token", "token", "x-sb-a-auth-token"])("agrees with hasSavedSession() about the key %s", (key) => {
    window.localStorage.setItem(key, "x");
    runScript();
    expect(marked()).toBe(hasSavedSession());
    document.documentElement.removeAttribute(SAVED_SESSION_ATTRIBUTE);
  });

  it("does nothing, and does not throw, when the storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    try { expect(runScript).not.toThrow(); } finally { Object.defineProperty(window, "localStorage", original); }
    expect(marked()).toBe(false);
  });
});

describe("the stylesheet", () => {
  const css = readFileSync(join(root, "features/public/public.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("hides the landing page under the mark, and only that", () => {
    expect(css).toMatch(/html\[data-saved-session\] \.public-site\{visibility:hidden\}/);
    expect(css.match(/data-saved-session/g)).toHaveLength(1);
  });

  it("the landing page is the element that carries that class", () => {
    const view = render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    expect(view.container.querySelector("main")).toHaveClass("public-site");
  });
});

describe("the shell takes the mark off when the session check has answered", () => {
  it("not before: while the saved session is still being read the page stays marked", async () => {
    document.documentElement.setAttribute(SAVED_SESSION_ATTRIBUTE, "1");
    window.localStorage.setItem("sb-abcdefgh-auth-token", "{}");
    fake.auth("getSession").reply(never);
    renderPortal({ publicConcerts: [] });
    // The shell itself draws its loading screen, not the landing page, for a browser that holds a saved sign-in (after hydration).
    await screen.findByText("Opening the club archive…");
    expect(marked()).toBe(true);
  });

  it("signed in: the mark is gone when the portal is up", async () => {
    document.documentElement.setAttribute(SAVED_SESSION_ATTRIBUTE, "1");
    openPortal();
    await screen.findByText(/Welcome back/);
    expect(marked()).toBe(false);
  });

  it("a saved sign-in that does not hold: the mark is gone and the landing page is drawn, not hidden", async () => {
    document.documentElement.setAttribute(SAVED_SESSION_ATTRIBUTE, "1");
    window.localStorage.setItem("sb-abcdefgh-auth-token", "{}");
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal({ publicConcerts: [] });
    expect(await screen.findByRole("button", { name: "Member sign in →" })).toBeInTheDocument();
    await waitFor(() => expect(marked()).toBe(false));
  });

  it("nobody signed in, nothing saved: there never was a mark, and there is none", async () => {
    fake.auth("getSession").reply(ok({ session: null }));
    renderPortal({ publicConcerts: [] });
    expect(await screen.findByRole("button", { name: "Member sign in →" })).toBeInTheDocument();
    expect(marked()).toBe(false);
  });

  it("no Supabase project at all: the setup screen, and no mark", async () => {
    document.documentElement.setAttribute(SAVED_SESSION_ATTRIBUTE, "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    renderPortal();
    await waitFor(() => expect(marked()).toBe(false));
  });
});
