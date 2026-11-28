// Phase 3.4 keyboard walkthrough on the Attendance screen (one of the four in the definition of done): a member checks in with the
// keyboard alone. Tab from the page reaches the code box (named), digits are typed, Tab reaches "Check in", Enter sends it, the answer
// is spoken from a live region and the focus is not lost to the top of the page. A refused code can be fixed and sent again without a
// mouse. user-event does the real key handling (Tab order, Enter on a button submits its form).
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import type { ClubRole } from "../../features/attendance/model";
import { setCacheOwner } from "../../lib/cache";
import { focusedName, keyboardUser } from "../support/keyboard";
import { notifySpy, userOf } from "../support/helpers";
import { fake, fail, ok, type Call } from "../support/fake-supabase";

const session = (id: number) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "open",
  opened_at: "2026-10-01T23:00:00Z", closes_at: "2026-10-02T00:00:00Z", closed_at: null, canceled_at: null, code_expires_at: null,
  created_at: "2026-09-01T00:00:00Z", counts_toward_metrics: true, live: null,
});
const BASE = { terms: ["2026-fall"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall", profiles: [] };

function renderAsMember() {
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, sessions: [session(1)] }));
  setCacheOwner("u-me");
  notifySpy();
  // (`role` here is the club role, not an ARIA role: a literal on this prop trips jsx-a11y/aria-role, a variable does not.)
  const role: ClubRole = "member";
  return render(<AttendancePage user={userOf("u-me")} role={role} groups={[]} initialScope="all" initialTab="overview" />);
}

/** Tab until the focus is on the named control (a keyboard user passes the header pickers first). Fails if it is never reached. */
async function tabTo(user: ReturnType<typeof keyboardUser>, name: string, limit = 12) {
  for (let step = 0; step < limit; step += 1) {
    if (document.activeElement && screenName(document.activeElement) === name) return;
    await user.tab();
  }
  expect(focusedName()).toBe(name);
}
function screenName(element: Element) {
  return element.getAttribute("aria-label") || (element as HTMLInputElement).labels?.[0]?.textContent?.trim() || element.textContent?.trim() || element.tagName.toLowerCase();
}

describe("a member checks in with the keyboard alone", () => {
  it("reaches the code box by Tab, types, tabs to the button, presses Enter, and hears the answer", async () => {
    fake.rpc("check_in_attendance").reply(ok(null));
    renderAsMember();
    const user = keyboardUser();
    await screen.findByLabelText("Attendance code");
    await tabTo(user, "Attendance code");
    expect(document.activeElement).toBe(screen.getByLabelText("Attendance code"));
    await user.keyboard("123456");
    expect(screen.getByLabelText("Attendance code")).toHaveValue("123456");
    await user.tab();
    expect(focusedName()).toBe("Check in");
    await user.keyboard("{Enter}");
    // One request, with the code as typed.
    await waitFor(() => expect(fake.rpc("check_in_attendance").count).toBe(1));
    expect(fake.rpc("check_in_attendance").calls[0].payload).toEqual({ p_code: "123456" });
    // The answer is in the live region (which was in the page before it had anything to say) ...
    const status = await screen.findByText("You are checked in. Your attendance is confirmed.");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("id", "attendance-code-result");
    // ... and the focus is still on the card, not dropped back to the top of the page.
    await waitFor(() => expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByLabelText("Attendance code").closest("form")!.contains(document.activeElement)).toBe(true);
  });

  it("a refused code is announced, the box is marked, and the same keys fix and send it again", async () => {
    fake.rpc("check_in_attendance").replyOnce(fail("That code has expired")).reply(ok(null));
    renderAsMember();
    const user = keyboardUser();
    await screen.findByLabelText("Attendance code");
    await tabTo(user, "Attendance code");
    await user.keyboard("111111");
    await user.keyboard("{Enter}");
    const refusal = await screen.findByText("That code has expired");
    expect(refusal).toHaveAttribute("role", "status");
    const input = screen.getByLabelText("Attendance code");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/That code has expired/);
    // The focus is on the form (the box or the button), so the person can correct the digits straight away.
    await waitFor(() => expect(input.closest("form")!.contains(document.activeElement)).toBe(true));
    input.focus();
    await user.clear(input);
    await user.keyboard("222222{Enter}");
    expect(await screen.findByText("You are checked in. Your attendance is confirmed.")).toBeInTheDocument();
    expect(fake.rpc("check_in_attendance").calls.map((call) => call.payload)).toEqual([{ p_code: "111111" }, { p_code: "222222" }]);
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
