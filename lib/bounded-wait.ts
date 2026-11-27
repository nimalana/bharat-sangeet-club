// Waiting for a refresh, but not for ever.
//
// After a change is saved the screen re-reads its lists. The dialog that made
// the change stays busy until that read is done, so a read that hangs (a slow
// network, a request the browser has not timed out yet) would leave the dialog
// stuck on a change that already went through. waitAtMost stops waiting after
// `ms`; the read itself is not cancelled and still updates the screen when it
// finishes.

export const REFRESH_WAIT_MS = 15_000;

export type WaitResult = "settled" | "timeout";

// Resolves "settled" as soon as `work` settles, or "timeout" after `ms`, whichever comes first.
// A rejection that arrives in time is passed on to the caller as it always was; one that arrives
// after the timeout has nobody to tell and is dropped.
export function waitAtMost(work: PromiseLike<unknown>, ms: number): Promise<WaitResult> {
  return new Promise<WaitResult>((resolve, reject) => {
    let over = false;
    const timer = setTimeout(() => { over = true; resolve("timeout"); }, ms);
    Promise.resolve(work).then(
      () => { if (over) return; over = true; clearTimeout(timer); resolve("settled"); },
      (error: unknown) => { if (over) return; over = true; clearTimeout(timer); reject(error); },
    );
  });
}
