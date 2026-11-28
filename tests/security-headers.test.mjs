// The security headers of next.config.ts (plan 4.4, P3-02): which headers every page carries and what the Content-Security-Policy
// lets the browser load. The policy is built at `next build` time from NEXT_PUBLIC_SUPABASE_URL, so these tests build it for
// two different projects and for none, and read the text a browser reads. The browser test (tests/browser/specs/csp.spec.mjs)
// is the other half: it proves that this policy, as written, lets the whole app work.
import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config.ts";
import { heroPhotos } from "../features/public/hero-photos.ts";

const TEST_URL = "https://bldytniesexkwbtyinsi.supabase.co";
const OTHER_URL = "https://abcdefghijklmnopqrst.supabase.co";

// Runs headers() as `next build` would, with the given environment, and returns the header list of the "every path" rule.
async function built({ supabaseUrl, nodeEnv } = {}) {
  const before = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, env: process.env.NODE_ENV };
  if (supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  try {
    const rules = await nextConfig.headers();
    assert.equal(rules.length, 1, "one rule, for every path");
    assert.equal(rules[0].source, "/(.*)");
    return rules[0].headers;
  } finally {
    if (before.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = before.url;
    if (before.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before.env;
  }
}

const header = (list, key) => list.find((h) => h.key === key)?.value;

// "default-src 'self'; img-src 'self' data:" -> Map { "default-src" => ["'self'"], "img-src" => ["'self'", "data:"] }
function directives(csp) {
  const map = new Map();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!map.has(name), `directive ${name} is written twice`);
    map.set(name, sources);
  }
  return map;
}

test("every page gets each security header, with the value the plan asks for", async () => {
  const list = await built({ supabaseUrl: TEST_URL });
  assert.equal(header(list, "X-Content-Type-Options"), "nosniff");
  assert.equal(header(list, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(header(list, "X-Frame-Options"), "DENY");
  assert.equal(header(list, "Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.ok(header(list, "Content-Security-Policy"), "a Content-Security-Policy");
  assert.equal(header(list, "Content-Security-Policy-Report-Only"), undefined, "enforced, not report-only");
  assert.equal(new Set(list.map((h) => h.key)).size, list.length, "no header twice");
});

test("Permissions-Policy: the studio may use the microphone and camera of this origin, nothing else a page can ask a device for", async () => {
  const policy = header(await built({ supabaseUrl: TEST_URL }), "Permissions-Policy");
  const features = new Map(policy.split(",").map((part) => part.trim().split("=")));
  assert.equal(features.get("microphone"), "(self)");
  assert.equal(features.get("camera"), "(self)");
  for (const off of ["geolocation", "payment", "usb", "serial", "hid", "midi", "display-capture", "accelerometer", "gyroscope", "magnetometer"]) {
    assert.equal(features.get(off), "()", `${off} is off`);
  }
});

test("the policy names the Supabase project it was built with, over https and for the realtime socket", async () => {
  for (const url of [TEST_URL, OTHER_URL]) {
    const csp = directives(header(await built({ supabaseUrl: url }), "Content-Security-Policy"));
    const host = new URL(url).host;
    for (const name of ["connect-src", "img-src", "media-src", "frame-src"]) assert.ok(csp.get(name).includes(`https://${host}`), `${name} has https://${host}`);
    assert.ok(csp.get("connect-src").includes(`wss://${host}`), "connect-src has the realtime socket");
    // And only its own project: a build for one project must not mention the other.
    const other = new URL(url === TEST_URL ? OTHER_URL : TEST_URL).host;
    assert.ok(!JSON.stringify([...csp]).includes(other), `no trace of ${other}`);
  }
});

test("the policy closes what the app never needs", async () => {
  const csp = directives(header(await built({ supabaseUrl: TEST_URL }), "Content-Security-Policy"));
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'self'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.ok(!csp.get("script-src").includes("'unsafe-eval'"), "no unsafe-eval in script-src");
  assert.ok(!JSON.stringify([...csp]).includes("unsafe-eval"), "no unsafe-eval anywhere");
});

// The pictures the public pages load from another origin: every absolute `src` of features/public/hero-photos.ts.
const thirdPartyPictures = heroPhotos.map((photo) => photo.src).filter((src) => /^https?:\/\//.test(src));

test("no wildcard and no host other than the project and the third-party pictures: not *.supabase.co, not https:, not a bare *", async () => {
  const csp = directives(header(await built({ supabaseUrl: TEST_URL }), "Content-Security-Policy"));
  const allowed = new Set(["'self'", "'none'", "'unsafe-inline'", "data:", "blob:", TEST_URL, `wss://${new URL(TEST_URL).host}`, ...thirdPartyPictures]);
  for (const [name, sources] of csp) {
    for (const source of sources) assert.ok(allowed.has(source), `${name} lists ${source}, which is not on the list of what the app needs`);
  }
  // The inline allowance is for scripts and styles only; a picture, font, frame or connection source is never 'unsafe-inline'.
  for (const [name, sources] of csp) if (!["script-src", "style-src"].includes(name)) assert.ok(!sources.includes("'unsafe-inline'"), `${name} has no unsafe-inline`);
});

test("a picture shown from another origin is allowed by its exact address, in img-src only; once every picture is under public/ nothing is", async () => {
  const csp = directives(header(await built({ supabaseUrl: TEST_URL }), "Content-Security-Policy"));
  const external = (sources) => sources.filter((source) => /^https?:/.test(source) && !source.startsWith(TEST_URL));
  assert.deepEqual(external(csp.get("img-src")).sort(), [...thirdPartyPictures].sort(), "img-src names exactly the pictures the site loads from another origin");
  for (const [name, sources] of csp) if (name !== "img-src") assert.deepEqual(external(sources), [], `${name} lists no third-party address`);
  for (const photo of heroPhotos) assert.ok(/^(\/|https:\/\/)/.test(photo.src), `${photo.src} is a path under public/ or an https address`);
});

test("without a Supabase URL the policy opens nothing in its place (no frame source at all)", async () => {
  for (const supabaseUrl of [undefined, "", "not a url", "ftp://example.test"]) {
    const csp = directives(header(await built({ supabaseUrl }), "Content-Security-Policy"));
    assert.deepEqual(csp.get("frame-src"), ["'none'"], `frame-src for ${JSON.stringify(supabaseUrl)}`);
    assert.ok(!csp.get("connect-src").some((s) => /^(https?|wss?):/.test(s)), "connect-src has no host");
    assert.deepEqual(csp.get("img-src").filter((s) => /^(https?|wss?):/.test(s)).sort(), [...thirdPartyPictures].sort(), "img-src has no host but the third-party pictures");
  }
});

test("a local project over http gets ws for its socket, not wss", async () => {
  const csp = directives(header(await built({ supabaseUrl: "http://127.0.0.1:54321" }), "Content-Security-Policy"));
  assert.ok(csp.get("connect-src").includes("http://127.0.0.1:54321"));
  assert.ok(csp.get("connect-src").includes("ws://127.0.0.1:54321"));
});

test("unsafe-eval is for `next dev` only: a development server may have it, the production list never does", async () => {
  const dev = directives(header(await built({ supabaseUrl: TEST_URL, nodeEnv: "development" }), "Content-Security-Policy"));
  assert.ok(dev.get("script-src").includes("'unsafe-eval'"));
  for (const nodeEnv of [undefined, "production", "test"]) {
    const csp = directives(header(await built({ supabaseUrl: TEST_URL, nodeEnv }), "Content-Security-Policy"));
    assert.ok(!csp.get("script-src").includes("'unsafe-eval'"), `no unsafe-eval for NODE_ENV=${nodeEnv}`);
  }
});

test("the server does not announce itself", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});
