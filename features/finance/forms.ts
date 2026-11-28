// Reading the finance forms. Pure: a FormData in, the values the api functions take out.
import type { PurchaseDetails } from "../../lib/api/finance";

/**
 * What the two purchase forms (a member's request, a club expense) collect. `last4` is the card digits, already trimmed (the
 * receipt upload needs the same text). An event's start is sent as an ISO instant (a date and time that is not valid throws, as it
 * always did); anything left empty is null; the category falls back to "Other".
 */
export function readPurchaseDetails(form: FormData, last4: string): PurchaseDetails {
  const subgroupValue = String(form.get("subgroup_id") || "");
  return {
    description: String(form.get("description") || ""),
    vendor: String(form.get("vendor") || ""),
    amount: Number(form.get("amount")),
    purchaseDate: String(form.get("purchase_date") || ""),
    category: String(form.get("category") || "Other"),
    cardLast4: last4,
    subgroupId: subgroupValue ? Number(subgroupValue) : null,
    clubEventId: form.get("club_event_id") ? Number(form.get("club_event_id")) : null,
    eventRelated: form.get("event_related") === "on",
    eventName: String(form.get("event_name") || ""),
    eventStartsAt: form.get("event_starts_at") ? new Date(String(form.get("event_starts_at"))).toISOString() : null,
    eventAttendeeCount: form.get("event_attendee_count") ? Number(form.get("event_attendee_count")) : null,
    eventSchedule: String(form.get("event_schedule") || ""),
  };
}
