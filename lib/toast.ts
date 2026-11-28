// What a toast says about itself. A failure must not wear the tick that marks
// a success, so every toast has a tone. The caller knows it and says it:
//
//   notify("Payment voided");                       // success (also fine untagged)
//   notify(friendlyError(error), "error");          // failure: ALWAYS tagged
//
// Text that comes from the database (error.message, friendlyError(...)) cannot
// be read for its tone: most of what the migrations raise ("Only administrators
// can change member roles", "session is not open") has none of the usual words
// of a failure. Every call that passes such text, or a message built around it,
// must pass "error"; tests/component/toast-tone.test.tsx fails when one does not,
// and tests/toast.test.mjs runs the real messages of the migrations through it.
//
// A message sent without a tone is only a fallback for the fixed messages
// written in the screens: it is read for the ordinary words of a failure
// ("could not be loaded", "must be", "Choose a file"). Do not rely on it for
// anything that is not a fixed sentence in this repository.

export type ToastTone = "success" | "error";
export type Notify = (message: string, tone?: ToastTone) => void;

const FAILURE_WORDS = /\b(?:could not|couldn't|can ?not|can't|unable|unavailable|failed|failure|error|went wrong|try again|not (?:found|allowed|permitted|authori[sz]ed|available|connected|saved|supported)|must|violates|permission|expired|invalid|dropped)\b/i;
// A request to the person ("Choose a file to upload"), or "No ..." from a check that found nothing.
const ASKS_FOR_SOMETHING = /^(?:please\b|choose\b|select\b|enter\b|upload\b|give\b|complete\b|fill\b|pick\b|no\b)/i;

export function toastTone(message: string, tone?: ToastTone): ToastTone {
  if (tone) return tone;
  const text = message.trim();
  return FAILURE_WORDS.test(text) || ASKS_FOR_SOMETHING.test(text) ? "error" : "success";
}

export const toastMark: Record<ToastTone, string> = { success: "✓", error: "!" };

// A confirmation fades after 2.8 s. A failure says what to do next, so it does not fade at all: it stays until the person dismisses it
// or the next failure replaces it (Infinity: the provider sets no timer for it).
export const toastDuration = (tone: ToastTone) => (tone === "error" ? Infinity : 2800);

// ---------------------------------------------------------------- the stack of toasts on screen

/** At most this many toasts are on screen at once. */
export const TOAST_LIMIT = 3;

export type ToastItem = { id: number; message: string; tone: ToastTone };

/**
 * Puts `item` on the stack (a list, oldest first) and says what left it. Pure: the provider calls it and clears the timers of `removed`.
 *  - a failure replaces the failure before it (one failure is on screen at a time: the newest says what to do now);
 *  - the same confirmation again replaces its earlier copy instead of showing twice;
 *  - past `limit`, the oldest toast that is not a failure goes first (a failure is only dropped when nothing else can be).
 */
export function pushToast(list: readonly ToastItem[], item: ToastItem, limit: number = TOAST_LIMIT): { list: ToastItem[]; removed: number[] } {
  const removed: number[] = [];
  const next = list.filter((shown) => {
    const replaced = item.tone === "error" ? shown.tone === "error" : shown.tone === item.tone && shown.message === item.message;
    if (replaced) removed.push(shown.id);
    return !replaced;
  });
  next.push(item);
  while (next.length > limit) {
    const oldest = next.findIndex((shown) => shown.tone !== "error");
    const [dropped] = next.splice(oldest === -1 ? 0 : oldest, 1);
    removed.push(dropped.id);
  }
  return { list: next, removed };
}
