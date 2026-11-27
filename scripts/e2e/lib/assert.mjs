// Assertions that explain themselves. `res` is a supabase-js result: { data, error }.

const text = (value) => { try { return JSON.stringify(value); } catch { return String(value); } };

export function describeError(error) {
  if (!error) return "no error";
  const code = error.code || error.statusCode || error.status || "";
  return `${error.message || error.error || text(error)}${code ? ` [${code}]` : ""}`;
}

export function ok(condition, message) {
  if (!condition) throw new Error(message);
}

export function equal(actual, expected, message) {
  if (text(actual) !== text(expected)) throw new Error(`${message}: expected ${text(expected)}, got ${text(actual)}`);
}

export function near(actual, expected, message, tolerance = 0.005) {
  if (Math.abs(Number(actual) - Number(expected)) > tolerance) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// The call must succeed. Returns data.
export function succeeded(res, label) {
  if (res.error) throw new Error(`${label} failed: ${describeError(res.error)}`);
  return res.data;
}

// The call must be refused with an error. `match` is a RegExp or substring checked against the message.
export function refused(res, label, match) {
  if (!res.error) throw new Error(`${label} should have been refused but succeeded (data: ${text(res.data)?.slice(0, 300)})`);
  if (match) {
    const message = `${res.error.message || ""} ${res.error.details || ""} ${res.error.hint || ""}`;
    const hit = match instanceof RegExp ? match.test(message) : message.toLowerCase().includes(String(match).toLowerCase());
    if (!hit) throw new Error(`${label} was refused, but with a different message: ${describeError(res.error)} (expected ${match})`);
  }
  return res.error;
}

// A row-level-security style refusal: either an error, or a write/read that touched no rows.
export function nothingHappened(res, label) {
  if (res.error) return res.error;
  const rows = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0;
  if (rows !== 0) throw new Error(`${label} should have affected no rows but returned ${text(res.data)?.slice(0, 300)}`);
  return null;
}

export function rowsOf(res, label) {
  const data = succeeded(res, label);
  return Array.isArray(data) ? data : data == null ? [] : [data];
}

// RPCs declared `returns table(...)` come back as an array of one row.
export function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}
