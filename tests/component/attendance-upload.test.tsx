// Phase 3.1 on the absence form: the proof image goes up with its progress shown (uploadWithProgress + UploadProgress), the form is sent
// only after the proof is stored (the order the screen always had), a refused form takes the proof back out, a failed upload keeps
// what was typed and offers Retry, and a double press sends one upload. The test plays the storage server through installFakeXhr.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttendancePage } from "../../features/attendance/components/attendance-page";
import type { ClubRole } from "../../features/attendance/model";
import { setCacheOwner } from "../../lib/cache";
import { expectNoSeriousViolations } from "../support/a11y";
import { notifySpy, userOf } from "../support/helpers";
import { fail, fake, ok, type Call } from "../support/fake-supabase";
import { installFakeXhr } from "../support/fake-xhr";

const session = (id: number) => ({
  id, scope: "club", subgroup_id: null, subgroup_name: null, title: `Meeting ${id}`, starts_at: "2026-10-01T23:00:00Z", status: "closed",
  opened_at: null, closes_at: null, closed_at: null, canceled_at: null, code_expires_at: null, created_at: "2026-09-01T00:00:00Z",
  counts_toward_metrics: true, live: null,
});
const BASE = { terms: ["2026-fall"], term: "2026-fall", view_term: "2026-fall", summary_term: "2026-fall", profiles: [] };
const REASON = "I was ill and saw a doctor";
const rpcCount = (name: string) => fake.rpc(name).count;
const proof = (name = "note from doctor.png") => new File(["x".repeat(2000)], name, { type: "image/png" });

/** Opens the absence form as a member and fills it in, with a proof unless told not to. */
async function fillForm(options: { withProof?: boolean } = {}) {
  const xhr = installFakeXhr();
  fake.rpc("get_attendance_overview").reply((call: Call) => ok({ ...BASE, list_limit: (call.payload as { p_list_limit?: number }).p_list_limit ?? 100, sessions: [session(1)] }));
  const notify = notifySpy();
  setCacheOwner("u-me");
  const role: ClubRole = "member";
  const view = render(<AttendancePage user={userOf("u-me")} role={role} groups={[]} initialScope="all" initialTab="overview" />);
  fireEvent.click(await screen.findByRole("button", { name: "Submit absence form" }));
  const dialog = screen.getByRole("dialog", { name: "Absence form" });
  const form = within(dialog).getByRole("button", { name: "Submit form" }).closest("form") as HTMLFormElement;
  fireEvent.change(within(form).getByLabelText("Meeting"), { target: { value: "1" } });
  fireEvent.change(within(form).getByLabelText(/What happened/), { target: { value: REASON } });
  if (options.withProof !== false) fireEvent.change(within(form).getByLabelText(/Proof image/), { target: { files: [proof()] } });
  return { xhr, notify, form, dialog, view };
}
const sent = (xhr: ReturnType<typeof installFakeXhr>) => xhr.requests.filter((request) => request.sent);
const stored = (request: { url: string }) => decodeURIComponent(request.url.split("/object/attendance-excuses/")[1]);
const accept = (request: { url: string; respond: (status: number, body: unknown) => void }) => request.respond(200, { Id: "obj-1", Key: `attendance-excuses/${stored(request)}` });

describe("the proof image shows its progress", () => {
  it("a row named for the file, a progress bar that follows the bytes, 'Saving' when every byte has gone, and the form is sent only after", async () => {
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const { xhr, form, dialog, notify } = await fillForm();
    fireEvent.submit(form);
    const request = await xhr.waitForRequest();
    const list = within(dialog).getByRole("list", { name: "Proof image upload" });
    expect(within(list).getByText("note from doctor.png")).toBeInTheDocument();
    const bar = within(list).getByRole("progressbar", { name: "Uploading note from doctor.png" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    act(() => request.progress(1000, 2000));
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(within(list).getByRole("status")).toHaveTextContent("Uploading");
    act(() => request.progress(2000, 2000));
    expect(within(list).getByRole("status")).toHaveTextContent("Saving");
    // Nothing is submitted while the proof is on its way, and the button says the form is being sent.
    expect(rpcCount("submit_attendance_excuse")).toBe(0);
    expect(within(dialog).getByRole("button", { name: "Submitting…" })).toHaveAttribute("aria-busy", "true");
    accept(request);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    expect(rpcCount("submit_attendance_excuse")).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a form with no proof has no upload row and sends no upload", async () => {
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const { xhr, form, dialog, notify } = await fillForm({ withProof: false });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
    expect(sent(xhr)).toHaveLength(0);
  });

  it("a double press sends one upload, and one form", async () => {
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const { xhr, form, notify } = await fillForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    const request = await xhr.waitForRequest();
    accept(request);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    expect(sent(xhr)).toHaveLength(1);
    expect(rpcCount("submit_attendance_excuse")).toBe(1);
  });
});

describe("an upload that fails", () => {
  it("says so on its row and in a toast, keeps what was typed, and Retry sends the same form again", async () => {
    fake.rpc("submit_attendance_excuse").reply(ok(null));
    const { xhr, form, dialog, notify } = await fillForm();
    fireEvent.submit(form);
    (await xhr.waitForRequest()).respond(413, { message: "The object exceeded the maximum allowed size" });
    const list = await within(dialog).findByRole("list", { name: "Proof image upload" });
    await waitFor(() => expect(within(list).getByRole("status")).toHaveTextContent("Failed: The object exceeded the maximum allowed size"));
    expect(notify.find("The object exceeded the maximum allowed size").tone).toBe("error");
    expect(rpcCount("submit_attendance_excuse")).toBe(0);
    // The form is still there with what was typed, and can be sent again.
    expect(within(form).getByLabelText(/What happened/)).toHaveValue(REASON);
    expect(within(form).getByLabelText("Meeting")).toHaveValue("1");
    expect(within(form).getByRole("button", { name: "Submit form" })).toBeEnabled();
    // Retry (named after the file) is the same as pressing Submit: the file and the words are still in the form.
    fireEvent.click(within(list).getByRole("button", { name: "Retry note from doctor.png" }));
    await waitFor(() => expect(sent(xhr)).toHaveLength(2));
    expect(within(dialog).getByRole("progressbar", { name: "Uploading note from doctor.png" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Failed:/)).not.toBeInTheDocument();
    accept(xhr.last);
    await waitFor(() => expect(notify.find("Absence form submitted")).toBeTruthy());
    expect(rpcCount("submit_attendance_excuse")).toBe(1);
  });

  it("a dropped connection is a failed row too, in the words the portal uses for it, on the row and in the toast", async () => {
    const { xhr, form, dialog, notify } = await fillForm();
    fireEvent.submit(form);
    (await xhr.waitForRequest()).networkError();
    const list = await within(dialog).findByRole("list", { name: "Proof image upload" });
    await waitFor(() => expect(within(list).getByRole("status")).toHaveTextContent("Failed: The connection dropped. Check your internet and try again."));
    expect(notify.find("The connection dropped. Check your internet and try again.").tone).toBe("error");
    expect(rpcCount("submit_attendance_excuse")).toBe(0);
    expect(within(form).getByLabelText(/What happened/)).toHaveValue(REASON);
  });

  it("a form the server refuses takes the proof out again and clears the row, so the next try is a fresh one", async () => {
    fake.rpc("submit_attendance_excuse").reply(fail("You already submitted a form for this meeting"));
    const { xhr, form, dialog, notify } = await fillForm();
    fireEvent.submit(form);
    const request = await xhr.waitForRequest();
    accept(request);
    await waitFor(() => expect(notify.find("You already submitted a form for this meeting").tone).toBe("error"));
    expect(fake.storage("attendance-excuses", "remove").calls.map((call) => call.args[0])).toEqual([[stored(request)]]);
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
    expect(within(form).getByLabelText(/What happened/)).toHaveValue(REASON);
  });

  it("a refusal in the database's own raw words is replaced by a plain sentence", async () => {
    const { xhr, form, dialog, notify } = await fillForm();
    fireEvent.submit(form);
    (await xhr.waitForRequest()).respond(403, { message: 'new row violates row-level security policy for table "objects"' });
    const list = await within(dialog).findByRole("list", { name: "Proof image upload" });
    await waitFor(() => expect(within(list).getByRole("status")).toHaveTextContent("Failed: The proof image could not be uploaded."));
    expect(notify.find("The proof image could not be uploaded.").tone).toBe("error");
  });

  it("closing the form forgets the row", async () => {
    const { xhr, form, dialog } = await fillForm();
    fireEvent.submit(form);
    (await xhr.waitForRequest()).respond(500, { message: "boom" });
    await within(dialog).findByRole("list", { name: "Proof image upload" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Submit form" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close the absence form" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit absence form" }));
    expect(within(screen.getByRole("dialog")).queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("the form with an upload row passes axe", () => {
  it("while it uploads, and when it failed", async () => {
    const { xhr, form, dialog, view } = await fillForm();
    fireEvent.submit(form);
    const request = await xhr.waitForRequest();
    act(() => request.progress(500, 2000));
    await expectNoSeriousViolations(view.container);
    request.respond(500, { message: "boom" });
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("Failed: Boom"));
    await expectNoSeriousViolations(view.container);
  });
});
