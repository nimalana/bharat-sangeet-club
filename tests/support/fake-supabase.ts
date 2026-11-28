// A fake Supabase client for component tests.
//
// The screens import `supabase` from lib/supabase. tests/component/setup.ts replaces that module
// with `fake.client`, so the real components run against this object. Nothing here knows about a
// screen: it records every call and answers what the test scripted.
//
//   import { fake, ok, fail, never, after, deferred } from "../support/fake-supabase";
//
//   fake.rpc("get_finance_summary").reply(ok({ available_cash: 120 }));
//   fake.from("finance_expenses").reply(ok([{ id: 1, ... }]));          // any operation on the table
//   fake.from("finance_documents", "insert").reply(ok({ id: 9 }));      // only inserts
//   fake.storage("finance-private", "remove").reply(ok([]));            // a refused delete
//   fake.rpc("pay_personal_reimbursement").replyOnce(fail("Already paid"));
//
//   fake.rpc("x").calls                         // every call to it, in order
//   fake.from("t", "update").calls[0].payload   // what was written
//   fake.calls                                  // everything, in order
//
// What a reply can be: an answer ({ data, error, count }), a function of the call that returns
// one, or one of the controls below (never, rejects, after, deferred). Calls nobody scripted get
// an empty answer and are listed in `fake.unscripted`.

type FakeError = { message: string; code?: string; details?: string; hint?: string };
export type Answer = { data?: unknown; error?: FakeError | null; count?: number | null; status?: number };

type Link = { method: string; args: unknown[] };
export type Call = {
  /** Order of the call among all calls since the last reset (1, 2, 3, ...). */
  seq: number;
  kind: "from" | "rpc" | "storage" | "auth";
  /** Table, function name, bucket, or "auth". */
  target: string;
  /** select | insert | update | delete | upsert for tables; the function or method name otherwise. */
  op: string;
  /** Every method chained on the query builder, in order: eq, order, limit, maybeSingle, ... */
  chain: Link[];
  /** The arguments of the call itself: the rpc arguments, or the storage method's arguments. */
  args: unknown[];
  /** What a table write sent (the first argument of insert / update / upsert); the rpc arguments for rpc. */
  payload: unknown;
  /** True if the chain used `method` (with these leading arguments, when given). */
  used(method: string, ...args: unknown[]): boolean;
  /** The arguments of every use of `method`. */
  uses(method: string): unknown[][];
};

type Control = { readonly __control: "never" | "rejects" | "after" | "deferred"; [key: string]: unknown };
type ReplyValue = Answer | Control;
export type Reply = ReplyValue | ((call: Call) => ReplyValue | Promise<ReplyValue>);

// ---------- ways to answer ----------

export const ok = (data: unknown = null, extra: Omit<Answer, "data" | "error"> = {}): Answer => ({ data, error: null, ...extra });
export const fail = (message: string, code?: string): Answer => ({ data: null, error: { message, ...(code ? { code } : {}) } });
export const withCount = (count: number, data: unknown = null): Answer => ({ data, error: null, count });
/** A call that never answers (a request that hangs). */
export const never: Control = { __control: "never" };
/** A call that rejects, as storage or a dropped connection can ("Failed to fetch"). */
export const rejects = (error: unknown = new TypeError("Failed to fetch")): Control => ({ __control: "rejects", error });
/** Answers after `ms` of (fake) time. */
export const after = (ms: number, reply: Reply): Control => ({ __control: "after", ms, reply });
/** An answer the test settles by hand: `const d = deferred(); ...reply(d.reply); d.resolve(ok(...))`. */
export function deferred() {
  let resolve!: (answer: Answer) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Answer>((res, rej) => { resolve = res; reject = rej; });
  const reply: Control = { __control: "deferred", promise };
  return { reply, resolve, reject, promise };
}

// ---------- internals ----------

const WRITE_OPS = new Set(["insert", "update", "upsert", "delete"]);
const TABLE_OPS = new Set(["select", ...WRITE_OPS]);

function isControl(value: unknown): value is Control {
  return typeof value === "object" && value !== null && "__control" in value;
}

async function settle(reply: Reply, call: Call): Promise<Answer> {
  const value = typeof reply === "function" ? await reply(call) : reply;
  if (isControl(value)) {
    switch (value.__control) {
      case "never": return new Promise<Answer>(() => {});
      case "rejects": throw value.error;
      case "after": return new Promise<Answer>((resolve, reject) => {
        setTimeout(() => { settle(value.reply as Reply, call).then(resolve, reject); }, value.ms as number);
      });
      case "deferred": return value.promise as Promise<Answer>;
    }
  }
  return value as Answer;
}

type Route = {
  reply(reply: Reply): Route;
  /** Used for exactly one matching call, before the standing reply. Can be called several times to queue. */
  replyOnce(reply: Reply): Route;
  readonly calls: Call[];
  readonly count: number;
};

function makeCall(seq: number, kind: Call["kind"], target: string, op: string, chain: Link[], args: unknown[], payload: unknown): Call {
  return {
    seq, kind, target, op, chain, args, payload,
    used: (method, ...wanted) => chain.some((link) => link.method === method && wanted.every((value, i) => JSON.stringify(link.args[i]) === JSON.stringify(value))),
    uses: (method) => chain.filter((link) => link.method === method).map((link) => link.args),
  };
}

function createFakeSupabase() {
  let seq = 0;
  const calls: Call[] = [];
  const unscripted: Call[] = [];
  const routes = new Map<string, { standing?: Reply; queue: Reply[] }>();
  const listeners = new Set<(event: string, session: unknown) => void>();
  let session: unknown = null;

  function slot(key: string) {
    let found = routes.get(key);
    if (!found) { found = { queue: [] }; routes.set(key, found); }
    return found;
  }
  function route(key: string): Route {
    const self: Route = {
      reply(reply) { slot(key).standing = reply; return self; },
      replyOnce(reply) { slot(key).queue.push(reply); return self; },
      get calls() { return calls.filter((call) => callKeys(call).includes(key)); },
      get count() { return this.calls.length; },
    };
    return self;
  }
  function callKeys(call: Call): string[] {
    if (call.kind === "from") return [`from:${call.target}:${call.op}`, `from:${call.target}`];
    if (call.kind === "rpc") return [`rpc:${call.target}`];
    if (call.kind === "storage") return [`storage:${call.target}:${call.op}`, `storage:${call.target}`, `storage:*:${call.op}`];
    return [`auth:${call.op}`];
  }
  function lookup(call: Call): Reply | undefined {
    for (const key of callKeys(call)) {
      const found = routes.get(key);
      if (found?.queue.length) return found.queue.shift();
    }
    for (const key of callKeys(call)) {
      const found = routes.get(key);
      if (found?.standing !== undefined) return found.standing;
    }
    return undefined;
  }

  function defaults(call: Call): Answer {
    if (call.kind === "storage") {
      const [first] = call.args;
      switch (call.op) {
        case "upload": return { data: { path: first }, error: null };
        case "remove": return { data: (first as string[]).map((name) => ({ name })), error: null };
        case "createSignedUrl": return { data: { signedUrl: `https://files.test/${call.target}/${first}?signed` }, error: null };
        case "createSignedUrls": return { data: (first as string[]).map((path) => ({ path, signedUrl: `https://files.test/${call.target}/${path}?signed`, error: null })), error: null };
        case "list": return { data: [], error: null };
        default: return { data: null, error: null };
      }
    }
    if (call.kind === "rpc") return { data: null, error: null };
    // Nobody signed in: the answer a real client gives, with `data` an object (a caller may read `data.session`).
    if (call.kind === "auth" && call.op === "getSession") return { data: { session: null }, error: null };
    return { data: call.op === "select" ? [] : null, error: null, count: null };
  }

  function run(call: Call): Promise<Answer> {
    calls.push(call);
    const reply = lookup(call);
    if (reply === undefined) unscripted.push(call);
    const finish = (answer: Answer) => normalise(call, answer ?? defaults(call));
    return settle(reply === undefined ? defaults(call) : reply, call).then(finish);
  }

  function normalise(call: Call, answer: Answer): Answer & { status: number } {
    let data = answer.data === undefined ? null : answer.data;
    let error = answer.error ?? null;
    const singles = call.chain.some((link) => link.method === "single" || link.method === "maybeSingle");
    if (singles && !error) {
      if (Array.isArray(data)) data = data[0] ?? null;
      if (data === null && call.used("single")) error = { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" };
    }
    // Supabase's storage client answers with a StorageError, which is an Error; the screens rely on `instanceof Error`
    // to tell a real failure from a plain object (the table and rpc clients answer with plain objects).
    if (error && call.kind === "storage" && !(error instanceof Error)) error = Object.assign(new Error(error.message), error);
    return { data, error, count: answer.count ?? null, status: error ? 400 : 200 };
  }

  // A query builder: any method can be chained (it is recorded), awaiting it sends the call.
  function builder(kind: "from" | "rpc", target: string, rpcArgs?: unknown) {
    const chain: Link[] = [];
    let op = kind === "rpc" ? target : "";
    let payload: unknown = kind === "rpc" ? rpcArgs : undefined;
    let sent: Promise<Answer> | null = null;
    const send = () => {
      if (!sent) {
        const verb = kind === "from" ? (op || "select") : op;
        const first = chain.find((link) => TABLE_OPS.has(link.method));
        sent = run(makeCall(++seq, kind, target, verb, chain, kind === "rpc" ? [rpcArgs] : first?.args ?? [], payload));
      }
      return sent;
    };
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") return (onFulfilled?: (value: Answer) => unknown, onRejected?: (reason: unknown) => unknown) => send().then(onFulfilled, onRejected);
        if (prop === "catch") return (onRejected?: (reason: unknown) => unknown) => send().catch(onRejected);
        if (prop === "finally") return (onFinally?: () => void) => send().finally(onFinally);
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          chain.push({ method: prop, args });
          if (kind === "from" && !op && TABLE_OPS.has(prop)) op = prop;
          if (kind === "from" && WRITE_OPS.has(prop) && payload === undefined) payload = args[0];
          return proxy;
        };
      },
    });
    return proxy;
  }

  const bucketApi = (bucket: string) => new Proxy({}, {
    get(_target, method) {
      if (typeof method === "symbol") return undefined;
      return (...args: unknown[]) => {
        if (method === "getPublicUrl") return { data: { publicUrl: `https://files.test/public/${bucket}/${String(args[0])}` } };
        return run(makeCall(++seq, "storage", bucket, method, [], args, args[0]));
      };
    },
  });

  const client = {
    from: (table: string) => builder("from", table),
    rpc: (name: string, args?: unknown) => builder("rpc", name, args ?? {}),
    storage: { from: (bucket: string) => bucketApi(bucket) },
    auth: {
      getSession: () => run(makeCall(++seq, "auth", "auth", "getSession", [], [], undefined)),
      getUser: () => run(makeCall(++seq, "auth", "auth", "getUser", [], [], undefined)),
      signOut: () => run(makeCall(++seq, "auth", "auth", "signOut", [], [], undefined)),
      signInWithOAuth: (options: unknown) => run(makeCall(++seq, "auth", "auth", "signInWithOAuth", [], [options], options)),
      signInWithPassword: (credentials: unknown) => run(makeCall(++seq, "auth", "auth", "signInWithPassword", [], [credentials], credentials)),
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        listeners.add(listener);
        calls.push(makeCall(++seq, "auth", "auth", "onAuthStateChange", [], [], undefined));
        return { data: { subscription: { unsubscribe: () => { listeners.delete(listener); } } } };
      },
    },
  };

  const api = {
    client,
    /** Every call since the last reset, in the order they were sent. */
    calls,
    /** Calls that no route answered (they got an empty answer). */
    unscripted,
    from: (table: string, op?: "select" | "insert" | "update" | "delete" | "upsert") => route(op ? `from:${table}:${op}` : `from:${table}`),
    rpc: (name: string) => route(`rpc:${name}`),
    storage: (bucket: string | "*", method: "upload" | "remove" | "createSignedUrl" | "createSignedUrls" | "list" | "download" | "move" | "copy") => route(`storage:${bucket}:${method}`),
    auth: (method: "getSession" | "getUser" | "signOut" | "signInWithOAuth" | "signInWithPassword") => route(`auth:${method}`),
    /** Makes getSession answer with a signed-in session for `user`. */
    signIn(user: { id: string; email?: string; [key: string]: unknown }) {
      session = { access_token: "fake-token", refresh_token: "fake-refresh", user: { app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z", ...user } };
      route("auth:getSession").reply(() => ({ data: { session }, error: null } as unknown as Answer));
      return session as { user: typeof user };
    },
    /** Delivers an auth event to every subscriber, as Supabase does (SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT). */
    emitAuth(event: string, nextSession: unknown) {
      for (const listener of [...listeners]) listener(event, nextSession);
    },
    get authSubscribers() { return listeners.size; },
    /** Calls of one kind, in order. */
    callsTo(kind: Call["kind"], target?: string) { return calls.filter((call) => call.kind === kind && (target === undefined || call.target === target)); },
    reset() {
      seq = 0; calls.length = 0; unscripted.length = 0; routes.clear(); listeners.clear(); session = null;
    },
  };
  return api;
}

/** The one fake the whole test run shares; tests/component/setup.ts installs it as lib/supabase and resets it after each test. */
export const fake = createFakeSupabase();
