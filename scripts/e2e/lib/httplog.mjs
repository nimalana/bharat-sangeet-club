// A fetch wrapper that remembers the most recent requests, so a failing test can show the
// exact request and response. Authorization and apikey headers are never recorded, and
// binary response bodies are not read.
const RING = [];
const MAX = 12;

function trim(text, limit = 700) {
  if (text == null) return "";
  const s = String(text);
  return s.length > limit ? `${s.slice(0, limit)}...(${s.length} chars)` : s;
}

function describeBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return trim(body);
  if (body instanceof URLSearchParams) return trim(body.toString());
  if (typeof Blob !== "undefined" && body instanceof Blob) return `<${body.type || "blob"} ${body.size} bytes>`;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return `<${body.byteLength} bytes>`;
  if (typeof body === "object" && typeof body.get === "function") return "<form data>";
  return "<body>";
}

export const loggedFetch = async (input, init = {}) => {
  const started = performance.now();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const entry = { method, url: url.replace(/(token=)[^&]+/, "$1<redacted>"), body: describeBody(init.body), status: 0, response: "", ms: 0 };
  RING.push(entry);
  if (RING.length > MAX) RING.shift();
  const response = await fetch(input, init);
  entry.status = response.status;
  entry.ms = Math.round(performance.now() - started);
  const type = response.headers.get("content-type") || "";
  if (/json|text/.test(type)) {
    try { entry.response = trim(await response.clone().text()); } catch { /* ignore */ }
  } else entry.response = `<${type || "no content-type"}>`;
  return response;
};

export function recentRequests(count = 4) {
  return RING.slice(-count).map((e) => ({ ...e }));
}
