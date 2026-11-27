// What a toast says about itself. A failure must not wear the tick that marks
// a success, so every toast has a tone. Callers that know it pass it:
//
//   notify("Payment voided");                       // success
//   notify(friendlyError(error), "error");          // failure
//
// A message sent without a tone is read for the ordinary words of a failure
// ("could not be loaded", "must be", "Choose a file"), so the many fixed
// messages in the screens come out right without every call being edited.
// Text that comes from the database is not predictable; pass "error" for it.

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

// Failures stay a little longer: they say what to do next.
export const toastDuration = (tone: ToastTone) => (tone === "error" ? 6000 : 2800);
