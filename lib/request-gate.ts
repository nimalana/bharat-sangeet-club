// Lets only the newest of several overlapping requests change the screen.
//
//   const isCurrent = gate.begin();
//   const answer = await load();
//   if (!isCurrent()) return;   // a newer request started, or the owner changed
//
// Responses can arrive out of order (a slow earlier search, a poll that was in
// flight when the scope changed). Without this, the older answer overwrites the
// newer one. `cancel()` makes every request that is still in flight stale, for
// example when the signed-in account changes.

export type RequestGate = {
  begin(): () => boolean;
  cancel(): void;
};

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      const mine = latest;
      return () => mine === latest;
    },
    cancel() {
      latest += 1;
    },
  };
}
