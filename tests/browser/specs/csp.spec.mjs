// The security headers (P3-02) against a real browser and the real built app.
//
// Every other test of the suite already fails on a Content-Security-Policy violation, on a page that comes without the security
// headers and on a request to an origin that is not the app or its Supabase project (the guard in support/test.mjs). This file adds
// what those tests do not reach on their own:
//   * the headers as the running server sends them, for a page, a redirect, a 404 and a static file;
//   * the flows that need the policy to be exactly right: Google sign-in starting, a recording playing (wavesurfer.js), the studio
//     recording audio and video through the browser's fake devices and playing the drone (Tone.js), a library file and a receipt
//     opened in a new tab, and a receipt, a take and a PDF from a signed Storage address shown INSIDE a page (an <img>, <audio>,
//     <video> and <iframe>), which is what the preview dialog of Phase 3 does;
//   * the other direction: the policy refuses what it should (a picture, script, frame, connection, socket, form, object, <base>
//     and eval from a stranger), and the page cannot be put in somebody else's frame;
//   * the Permissions-Policy is the one the browser parsed.
// A "refused" probe is allowed through the guard on purpose and says why; a refusal nobody expected still fails the test.
import { test, expect } from "../support/test.mjs";
import { fx } from "../support/smoke.mjs";
import { loadState } from "../support/state.mjs";
import { SESSION_KEY } from "../support/config.mjs";
import { expectLandmarks, openScreen } from "../support/screens.mjs";

const STRANGER = "blocked.invalid"; // never resolves: a probe that reaches the network at all is a failure of its own

// What a probe aimed at the stranger leaves in the guard besides the violation itself: a console line, a failed request, a request to an origin
// that is not the app's.
function expectRefusedProbes(guard) {
  const about = /blocked\.invalid/;
  guard.allow({ kind: "csp", text: about, reason: "a probe aimed at a stranger: the browser must report the refusal" });
  guard.allow({ kind: "csp", text: /script-src: blocked eval/, reason: "a probe that calls eval(): script-src without unsafe-eval must report the refusal" });
  guard.allow({ kind: "console", text: /Content Security Policy|Refused to/, reason: "the browser logs each refusal of a probe aimed at a stranger" });
  guard.allow({ kind: "requestfailed", url: about, reason: "a request the policy refused fails with 'csp'" });
  guard.allow({ kind: "origin", url: about, reason: "the probe asks for an address that is not the app's" });
}

// A signed Storage address for a file, asked for inside the page with the session the app holds (as the app's own client does).
async function signedAddress(page, bucket, path) {
  const state = loadState();
  return page.evaluate(async ({ base, key, sessionKey, bucket, path }) => {
    const token = JSON.parse(window.localStorage.getItem(sessionKey) || "{}").access_token;
    const response = await fetch(`${base}/storage/v1/object/sign/${bucket}/${path}`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 120 }),
    });
    if (!response.ok) throw new Error(`signing ${bucket}/${path} answered ${response.status}`);
    return `${base}/storage/v1${(await response.json()).signedURL}`;
  }, { base: state.supabaseUrl, key: state.supabaseKey, sessionKey: SESSION_KEY, bucket, path });
}

// ---------------------------------------------------------------------------------------------------------------- the headers

test.describe("the headers as the running server sends them", () => {
  test.use({ role: "anon" });

  for (const path of ["/", "/?page=groups", "/meetings", "/there-is-no-such-page", "/unc-bharat-sangeet-logo.jpg"]) {
    test(`${path} carries every security header`, async ({ request }) => {
      const state = loadState();
      const response = await request.get(path, { maxRedirects: 0 });
      const header = (name) => response.headers()[name];
      const origin = new URL(state.supabaseUrl);
      expect(header("content-security-policy"), "an enforced Content-Security-Policy header").toBeTruthy();
      const csp = Object.fromEntries(header("content-security-policy").split(";").map((part) => { const [name, ...sources] = part.trim().split(/\s+/); return [name, sources]; }));

      expect(header("x-content-type-options")).toBe("nosniff");
      expect(header("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(header("x-frame-options")).toBe("DENY");
      expect(header("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
      expect(header("permissions-policy")).toContain("microphone=(self)");
      expect(header("x-powered-by")).toBeUndefined();
      expect(header("content-security-policy-report-only"), "enforced, not report-only").toBeUndefined();
      expect(csp["default-src"]).toEqual(["'self'"]);
      expect(csp["object-src"]).toEqual(["'none'"]);
      expect(csp["frame-ancestors"]).toEqual(["'none'"]);
      expect(csp["script-src"]).not.toContain("'unsafe-eval'");
      // The Supabase project this build talks to, over https for everything and wss for the realtime socket.
      for (const directive of ["img-src", "media-src", "connect-src", "frame-src"]) expect(csp[directive], directive).toContain(origin.origin);
      expect(csp["connect-src"]).toContain(`wss://${origin.host}`);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------- sign-in

test.describe("a visitor", () => {
  test.use({ role: "anon" });

  test("Google sign-in starts: the page goes to the project's authorize address, back to this origin, and the policy blocks nothing", async ({ page, context, baseURL }) => {
    const state = loadState();
    let authorize = null;
    await context.route(/\/auth\/v1\/authorize/, (route) => { authorize = route.request().url(); return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Google would ask here</h1>" }); });
    await page.goto("/");
    await page.getByRole("button", { name: /Member sign in/ }).first().click();
    await page.getByRole("button", { name: /Continue with Google/ }).click();
    await expect(page.getByRole("heading", { name: "Google would ask here" })).toBeVisible();
    const url = new URL(authorize);
    expect(url.origin).toBe(new URL(state.supabaseUrl).origin);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(new URL(baseURL).origin);
  });
});

// ---------------------------------------------------------------------------------------------------------------- recordings

test.describe("a member and the recordings", () => {
  test.use({ role: "member", permissions: ["microphone", "camera"] });

  test("a recording plays from its signed address: the waveform is drawn and Play starts", async ({ page }) => {
    const t = fx().titles;
    await openScreen(page, "recordings");
    await page.locator(".recording-card", { hasText: t.recording }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: t.recording })).toBeVisible();
    const play = dialog.getByRole("button", { name: "Play" });
    await expect(play, "wavesurfer has fetched and decoded the take").toBeEnabled({ timeout: 20_000 });
    // wavesurfer.js draws into a shadow root and writes its own <style> element there (style-src 'unsafe-inline').
    const drawn = await dialog.locator(".waveform-canvas > div").evaluate((host) => ({ canvases: host.shadowRoot.querySelectorAll("canvas").length, styles: host.shadowRoot.querySelectorAll("style").length }));
    expect(drawn.styles, "wavesurfer's <style> element is in place").toBeGreaterThanOrEqual(1);
    expect(drawn.canvases, "the waveform is drawn").toBeGreaterThanOrEqual(1);
    await play.click();
    await expect(dialog.locator(".waveform-time")).toContainText("/");
  });

  test("the studio records audio and video from the browser's devices, previews each take and plays the drone", async ({ page }) => {
    await openScreen(page, "recordings");
    await page.getByRole("button", { name: /New recording/ }).click();
    const studio = page.getByRole("dialog");

    await studio.getByRole("tab", { name: "Record audio" }).click();
    await studio.getByRole("button", { name: /Start recording/ }).click();
    await expect(studio.getByRole("button", { name: /Stop recording/ })).toBeVisible();
    await page.waitForTimeout(1500);
    await studio.getByRole("button", { name: /Stop recording/ }).click();
    // The take is previewed from a blob: address: wavesurfer fetches it (connect-src) and plays it (media-src).
    await expect(studio.locator(".recording-preview-card .waveform-play")).toBeEnabled({ timeout: 20_000 });
    await studio.locator(".recording-preview-card .waveform-play").click();
    await studio.getByRole("button", { name: "Retake" }).click();

    await studio.getByRole("tab", { name: "Record video" }).click();
    await studio.getByRole("button", { name: /Start recording/ }).click();
    await expect(studio.getByRole("button", { name: /Stop recording/ })).toBeVisible();
    await page.waitForTimeout(1500);
    await studio.getByRole("button", { name: /Stop recording/ }).click();
    await expect(studio.locator(".recording-preview-card video")).toBeVisible();
    await expect.poll(() => studio.locator(".recording-preview-card video").evaluate((video) => video.readyState), { message: "the recorded video has loaded from its blob: address" }).toBeGreaterThanOrEqual(1);
    await studio.getByRole("button", { name: "Retake" }).click();

    await studio.getByRole("tab", { name: "Upload file" }).click();
    await studio.locator("input[type=file]").first().setInputFiles({ name: "take.wav", mimeType: "audio/wav", buffer: Buffer.alloc(44 + 16_000) });
    await expect(studio.getByText("take.wav")).toBeVisible();

    // Tone.js: the audio context, the transport and a synth, with no eval and no worker the policy refuses.
    await studio.getByRole("button", { name: "Start drone" }).click();
    await expect(studio.getByRole("button", { name: "Stop drone" })).toBeVisible();
    await page.waitForTimeout(1200);
    await studio.getByRole("button", { name: "Stop drone" }).click();
    await expect(studio.getByRole("button", { name: "Start drone" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------------------- files from Storage

test.describe("files from Storage", () => {
  test.describe("shown inside a page (what the preview dialog of Phase 3 does)", () => {
    test.use({ role: "member" });

    test("a receipt in an <img>, a take in <audio> and <video>, a PDF in an <iframe>, and each as a blob: address", async ({ page, guard }) => {
      const state = loadState();
      const { ids } = fx();
      await openScreen(page, "home");
      const receipt = await signedAddress(page, "finance-private", ids.reqToPay.receipt.path);
      const pdf = await signedAddress(page, "club-resources", ids.fileKeptPath);
      const takePath = await page.evaluate(async ({ base, key, sessionKey, id }) => {
        const token = JSON.parse(window.localStorage.getItem(sessionKey) || "{}").access_token;
        const response = await fetch(`${base}/rest/v1/recordings?id=eq.${id}&select=storage_path`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
        return (await response.json())[0]?.storage_path;
      }, { base: state.supabaseUrl, key: state.supabaseKey, sessionKey: SESSION_KEY, id: ids.recording });
      const take = await signedAddress(page, "recordings", takePath);

      const outcome = await page.evaluate(async ({ receipt, pdf, take }) => {
        const settle = (element, event) => new Promise((resolve) => {
          element.addEventListener(event, () => resolve("ok"));
          element.addEventListener("error", () => resolve("error"));
          setTimeout(() => resolve("timeout"), 15_000);
        });
        const add = (element) => { document.body.append(element); return element; };
        const result = {};
        result.img = await settle(add(Object.assign(document.createElement("img"), { src: receipt })), "load");
        result.audio = await settle(add(Object.assign(document.createElement("audio"), { src: take, preload: "auto" })), "loadedmetadata");
        result.video = await settle(add(Object.assign(document.createElement("video"), { src: take, preload: "auto" })), "loadedmetadata");
        result.iframe = await settle(add(Object.assign(document.createElement("iframe"), { src: pdf, width: 400, height: 300 })), "load");
        // The same files fetched and shown from a blob: address, as a preview that downloads first would.
        const blobOf = async (address) => URL.createObjectURL(await (await fetch(address)).blob());
        result.blobImg = await settle(add(Object.assign(document.createElement("img"), { src: await blobOf(receipt) })), "load");
        result.blobVideo = await settle(add(Object.assign(document.createElement("video"), { src: await blobOf(take), preload: "auto" })), "loadedmetadata");
        return result;
      }, { receipt, pdf, take });

      expect(outcome).toEqual({ img: "ok", audio: "ok", video: "ok", iframe: "ok", blobImg: "ok", blobVideo: "ok" });
      expect(page.frames().some((frame) => frame.url().startsWith(`${new URL(state.supabaseUrl).origin}/storage/v1/object/sign/club-resources/`)), "the PDF frame went to its signed address").toBe(true);
      expect(guard.cspViolations, "nothing the preview needs was refused").toEqual([]);
    });

    test("the project's realtime socket opens; any other socket is refused", async ({ page, guard }) => {
      const state = loadState();
      expectRefusedProbes(guard);
      await openScreen(page, "home");
      const outcome = await page.evaluate(({ base, key, stranger }) => {
        const open = (address) => new Promise((resolve) => {
          const socket = new WebSocket(address);
          socket.onopen = () => { resolve("open"); socket.close(); };
          socket.onerror = () => resolve("refused");
          setTimeout(() => resolve("timeout"), 15_000);
        });
        return Promise.all([open(`${base.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`), open(`wss://${stranger}/`)]);
      }, { base: state.supabaseUrl, key: state.supabaseKey, stranger: STRANGER });
      expect(outcome).toEqual(["open", "refused"]);
      expect(guard.cspViolations.map((v) => v.effectiveDirective)).toEqual(["connect-src"]);
    });
  });

  test.describe("opened in a new tab, as the screens do today", () => {
    test.use({ role: "executive" });

    test("a receipt and a library file open on their signed addresses (the page keeps no link to the tab)", async ({ page, context }) => {
      const t = fx().titles;
      const base = new URL(loadState().supabaseUrl).origin;
      await openScreen(page, "finances");
      await page.getByRole("tab", { name: "reimbursements" }).click();
      const popup = context.waitForEvent("page");
      await page.locator(".reimbursement-card", { hasText: t.reqToPay }).locator(".document-chip").first().click();
      const receiptTab = await popup;
      await receiptTab.waitForURL(new RegExp(`^${base.replace(/\./g, "\\.")}/storage/v1/object/sign/finance-private/`));
      expect(await receiptTab.evaluate(() => window.opener), "noopener: the tab cannot reach the portal").toBeNull();
      await receiptTab.close();

      await openScreen(page, "documents");
      await page.getByRole("button", { name: new RegExp(t.fileKept.replace(/[[\]]/g, "\\$&")) }).click();
      const second = context.waitForEvent("page");
      await page.getByRole("dialog").getByRole("button", { name: /Open file/ }).click();
      const fileTab = await second;
      await fileTab.waitForURL(new RegExp(`^${base.replace(/\./g, "\\.")}/storage/v1/object/sign/club-resources/`));
      await fileTab.close();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------- the other direction

test.describe("what the policy refuses", () => {
  test.use({ role: "member" });

  test("a picture, a script, a frame, a connection, a form, an object, a <base> and eval from a stranger are each reported and refused", async ({ page, guard }) => {
    expectRefusedProbes(guard);
    await openScreen(page, "home");
    // The probes add elements to the page: wait until the portal has finished hydrating, or the page's own startup meets them half-way.
    await expectLandmarks(page, "home", "member", fx());
    const fetched = await page.evaluate(async (stranger) => {
      const add = (element) => { document.body.append(element); return element; };
      add(Object.assign(document.createElement("img"), { src: `https://${stranger}/x.png` }));
      add(Object.assign(document.createElement("script"), { src: `https://${stranger}/x.js` }));
      add(Object.assign(document.createElement("iframe"), { src: `https://${stranger}/` }));
      add(Object.assign(document.createElement("object"), { data: `https://${stranger}/x.swf` }));
      add(Object.assign(document.createElement("link"), { rel: "stylesheet", href: `https://${stranger}/x.css` }));
      add(Object.assign(document.createElement("audio"), { src: `https://${stranger}/x.mp3` }));
      const form = add(Object.assign(document.createElement("form"), { action: `https://${stranger}/post`, method: "post" }));
      form.requestSubmit?.();
      document.head.append(Object.assign(document.createElement("base"), { href: `https://${stranger}/` }));
      return fetch(`https://${stranger}/`).then(() => "allowed", () => "refused");
    }, STRANGER);
    // eval() called by the page's own code, in a task of its own. It must not run inside page.evaluate: while the browser's debugging
    // protocol is executing a call, V8 lets that call eval (checked: an inline script started from page.evaluate got "2" for eval('1+1')).
    await page.evaluate(() => {
      document.body.append(Object.assign(document.createElement("script"), {
        textContent: "setTimeout(function () { try { window.__evalProbe = String(eval('1 + 1')); } catch (error) { window.__evalProbe = 'refused'; } }, 20);",
      }));
    });
    await page.waitForFunction(() => window.__evalProbe !== undefined);
    const evaluated = await page.evaluate(() => window.__evalProbe);
    await page.waitForTimeout(500);
    expect({ fetched, evaluated }).toEqual({ fetched: "refused", evaluated: "refused" });
    const directives = new Set(guard.cspViolations.map((v) => v.effectiveDirective));
    for (const expected of ["img-src", "script-src-elem", "frame-src", "object-src", "style-src-elem", "media-src", "form-action", "base-uri", "connect-src", "script-src"]) {
      expect(directives, `a ${expected} violation was reported`).toContain(expected);
    }
    expect(guard.cspViolations.every((v) => v.disposition === "enforce"), "every one of them is enforced, none report-only").toBe(true);
  });

  test("Permissions-Policy: the microphone and camera of this origin are allowed, everything else a page can ask a device for is off", async ({ page }) => {
    await openScreen(page, "home");
    const allowed = await page.evaluate(() => {
      const policy = document.permissionsPolicy || document.featurePolicy;
      return Object.fromEntries(["microphone", "camera", "geolocation", "payment", "usb", "serial", "hid", "midi", "display-capture", "accelerometer", "gyroscope", "magnetometer"].map((name) => [name, policy.allowsFeature(name)]));
    });
    expect(allowed).toEqual({ microphone: true, camera: true, geolocation: false, payment: false, usb: false, serial: false, hid: false, midi: false, "display-capture": false, accelerometer: false, gyroscope: false, magnetometer: false });
  });

  test("the portal cannot be put in another site's frame, by X-Frame-Options and by frame-ancestors alone", async ({ page, context, guard, baseURL }) => {
    guard.allow({ kind: "origin", url: /framer\.test/, reason: "the page that tries to frame the portal is somebody else's" });
    guard.allow({ kind: "console", text: /Refused to (display|frame)|frame-ancestors|X-Frame-Options|Content Security Policy/, reason: "the browser logs the refusal to frame the portal" });
    guard.allow({ kind: "csp", text: /frame-ancestors/, reason: "the refusal to frame the portal is reported" });
    guard.allow({ kind: "headers", text: /without x-frame-options/, reason: "the second half of this test takes the older header away on purpose" });
    guard.allow({ kind: "requestfailed", url: new RegExp(new URL(baseURL).host), reason: "the refused frame's navigation is cancelled by the browser" });
    await context.route("http://framer.test/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><iframe id="portal" src="${baseURL}/"></iframe>` }));

    // What the frame inside the other site shows: its address and whether any of the portal's own words are in it.
    const framed = async () => {
      await page.goto("http://framer.test/");
      await page.waitForTimeout(2500);
      const inside = page.frames().filter((frame) => frame !== page.mainFrame());
      const portalWords = await Promise.all(inside.map(async (frame) => (await frame.content().catch(() => "")).includes("Bharat Sangeet")));
      return { urls: inside.map((frame) => frame.url()), showsPortal: portalWords.some(Boolean) };
    };

    const both = await framed();
    expect(both.urls.length, "the other site has its frame").toBe(1);
    expect(both.urls.some((url) => url.startsWith(baseURL)), `a frame that loaded the portal: ${both.urls}`).toBe(false);
    expect(both.showsPortal, "the portal is not in the frame").toBe(false);

    // Without X-Frame-Options the Content-Security-Policy alone must still refuse.
    await context.route((url) => url.href.startsWith(baseURL), async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["x-frame-options"];
      return route.fulfill({ response, headers });
    });
    const csp = await framed();
    expect(csp.urls.length, "the other site has its frame").toBe(1);
    expect(csp.urls.some((url) => url.startsWith(baseURL)), `a frame that loaded the portal: ${csp.urls}`).toBe(false);
    expect(csp.showsPortal, "the portal is not in the frame").toBe(false);
  });
});
