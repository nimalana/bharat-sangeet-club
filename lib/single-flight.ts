// Lets one action run at a time.
//
//   const flight = createSingleFlight();
//   const outcome = await flight.run(async () => save());
//   if (!outcome.ran) return;   // another run was still in progress
//
// Component state (`busy`) only changes after the next render, so a quick
// second click can still start the action twice. This flag changes at once.

export type SingleFlight = {
  readonly busy: boolean;
  run<T>(work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
};

export function createSingleFlight(): SingleFlight {
  let busy = false;
  return {
    get busy() { return busy; },
    async run<T>(work: () => Promise<T>) {
      if (busy) return { ran: false as const };
      busy = true;
      try {
        return { ran: true as const, value: await work() };
      } finally {
        busy = false;
      }
    },
  };
}
