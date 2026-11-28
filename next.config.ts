import type { NextConfig } from "next";

// Security headers (plan 4.4, P3-02). Every response carries them; the unit test tests/security-headers.test.mjs pins the list and
// the browser test tests/browser/specs/csp.spec.mjs drives the whole app against the policy and fails on any violation.
//
// The one thing that differs between deployments is the Supabase project: the browser talks to it directly (REST, Auth, Storage
// files, the Realtime socket), so the policy names its origin. It is read from NEXT_PUBLIC_SUPABASE_URL when `next build` computes
// the headers, which is the same value the client bundle is built with. Without a usable URL (the setup screen is all the app shows
// then) no Supabase source is added, and nothing is opened up in its place.
//
// What the policy allows, and why. Each line was found by running the whole app in a real browser against a policy that allowed
// nothing and reading what it reported (docs/KNOWN_GAPS.md, "What the security headers do not cover"):
//  * script-src 'unsafe-inline': the landing page is prerendered and rebuilt every five minutes, and Next puts the data the page
//    hydrates from into inline <script> tags (seven of them) whose text changes with every build and every public concert. A hash
//    cannot be written into a header ahead of time, and a nonce needs a render per request, which would turn the cached landing
//    page into a dynamic one. No 'unsafe-eval': Tone.js and wavesurfer.js run without it (checked), only `next dev` needs it.
//  * style-src 'unsafe-inline': wavesurfer.js writes a <style> element into the player it draws. React's own style attributes are
//    set through the CSSOM and are not blocked; the allowance stays for style attributes in server-rendered markup that Phase 3
//    components may add.
//  * worker-src blob:, connect-src blob:, media-src blob:: the recorder and the player. standardized-audio-context (under Tone.js)
//    loads an audio worklet from a blob URL when the recording chunk loads; wavesurfer.js turns a fetched take into a blob URL for
//    its <audio> element, and the studio previews a file the person has just chosen or recorded the same way.
//  * img-src blob: and data:: not used by any screen today. Reserved for the receipt preview of the roadmap (a file shown before it
//    is uploaded) and for icons inside component CSS. Nothing can execute from either.
//  * frame-src, media-src, img-src, connect-src for the Supabase origin: signed file links (receipts, library files, recordings,
//    PDFs in a frame) and every REST, Auth and Storage call. connect-src also has the project's realtime socket (wss), which no
//    screen opens yet.
//  * img-src HERO_PHOTO_URLS: the one picture still loaded from another origin, by its exact address (docs/ASSETS.md, P3-03).
const SUPABASE_URL = "NEXT_PUBLIC_SUPABASE_URL";

// Pictures the pages still load from another origin, each by its exact address. Empty once every picture is under public/
// (docs/ASSETS.md says what is needed); tests/security-headers.test.mjs fails if an entry here is not a picture of features/public.
const HERO_PHOTO_URLS = ["https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg"];

/** The http(s) and ws(s) origin of the Supabase project, or null when the URL is missing or not an http(s) URL. */
function supabaseOrigins(): { http: string; ws: string } | null {
  const raw = process.env[SUPABASE_URL];
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { http: url.origin, ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}` };
}

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigins();
  const http = supabase ? [supabase.http] : [];
  const ws = supabase ? [supabase.ws] : [];
  // `next dev` compiles with eval-based source maps and React Refresh; a production build never does.
  const development = process.env.NODE_ENV === "development";
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...http, ...HERO_PHOTO_URLS]],
    ["font-src", ["'self'"]],
    ["media-src", ["'self'", "blob:", ...http]],
    ["connect-src", ["'self'", "blob:", ...http, ...ws]],
    ["frame-src", http.length ? http : ["'none'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

// camera and microphone: the recording studio records audio and video from the person's own devices (use-recording-media.ts).
// Everything else a page can ask a device for is switched off.
const PERMISSIONS_POLICY = [
  "accelerometer=()", "camera=(self)", "display-capture=()", "geolocation=()", "gyroscope=()", "hid=()",
  "magnetometer=()", "microphone=(self)", "midi=()", "payment=()", "serial=()", "usb=()",
].join(", ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The CSP's frame-ancestors says the same; this one is for the browsers that only know the older header.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          // Google sign-in is a full-page redirect through Supabase (signInWithOAuth), not a popup, so this does not touch it; the
          // value is the strictest one that would still let a Google popup talk back to the page if one is ever used. Files opened
          // in a new tab are other origins and keep no link to the page (noopener).
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // No Strict-Transport-Security here: Vercel sends it on every HTTPS response (max-age=63072000). See docs/OWNER_CHECKLIST.md.
        ],
      },
    ];
  },
};

export default nextConfig;
