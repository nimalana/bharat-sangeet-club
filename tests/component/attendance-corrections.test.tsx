// The small correction controls of the Attendance screen (features/attendance/components/attendance-corrections.tsx): edit,
// delete or void a meeting, clear a mark, change the policy levels, withdraw an absence form. Their requests go through
// lib/api/attendance.ts; this file pins what each one sends, says and leaves on screen, one control at a time.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClearMarkButton, SessionCorrections, ThresholdSettings, WithdrawExcuseButton } from "../../features/attendance/components/attendance-corrections";
import { notifySpy } from "../support/helpers";
import { fail, fake, ok } from "../support/fake-supabase";

const RAW = 'new row violates check constraint "attendance_check"';
const dialog = () => screen.getByRole("dialog");
const meeting = (over: Record<string, unknown> = {}) => ({ id: 5, title: "Opening meeting", starts_at: "2026-10-01T12:00:00Z", status: "draft" as const, ...over });

function renderCorrections(over: Record<string, unknown> = {}) {
  const notify = notifySpy();
  const onChanged = vi.fn();
  const view = render(<SessionCorrections session={meeting(over) as Parameters<typeof SessionCorrections>[0]["session"]} onChanged={onChanged} />);
  return { notify, onChanged, ...view };
}

describe("a meeting's corrections: which ones it offers", () => {
  it("a draft can be edited or deleted, not voided", () => {
    renderCorrections();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void meeting" })).not.toBeInTheDocument();
  });

  it("a closed meeting can be voided, not edited or deleted", () => {
    renderCorrections({ status: "closed" });
    expect(screen.getByRole("button", { name: "Void meeting" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("an open meeting has none", () => {
    const { container } = renderCorrections({ status: "open" });
    expect(container).toBeEmptyDOMElement();
  });

  it("a canceled one says why it was voided, when it says; otherwise it shows nothing", () => {
    const { container, unmount } = renderCorrections({ status: "canceled", cancel_reason: "Created twice" });
    expect(screen.getByText("Voided: Created twice")).toBeInTheDocument();
    unmount();
    const second = renderCorrections({ status: "canceled", cancel_reason: null });
    expect(second.container).toBeEmptyDOMElement();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("editing a meeting that has not opened", () => {
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    return within(dialog()).getByRole("button", { name: "Save changes" }).closest("form")!;
  };

  it("starts from the meeting; saving sends the trimmed title and the time as UTC, says so as a success, closes and reports the change", async () => {
    fake.rpc("update_attendance_session").reply(ok(null));
    const { notify, onChanged } = renderCorrections();
    const form = open();
    expect(within(form).getByLabelText("Title")).toHaveValue("Opening meeting");
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "  Opening night  " } });
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "2026-11-02T18:30" } });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Meeting updated").tone).toBe("success"));
    const sent = fake.rpc("update_attendance_session").calls[0].payload as { p_session_id: number; p_title: string; p_starts_at: string };
    expect(sent.p_session_id).toBe(5);
    expect(sent.p_title).toBe("Opening night");
    expect(sent.p_starts_at).toBe(new Date("2026-11-02T18:30").toISOString());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a time that is not a time is refused before anything is sent, without the error tone", () => {
    const { notify } = renderCorrections();
    const form = open();
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "" } });
    fireEvent.submit(form);
    expect(notify.toasts()).toEqual([{ message: "Choose when the meeting starts.", tone: undefined }]);
    expect(fake.rpc("update_attendance_session").count).toBe(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a refusal says the fallback sentence as an error, keeps the dialog, frees the button and reports nothing", async () => {
    fake.rpc("update_attendance_session").reply(fail(RAW));
    const { notify, onChanged } = renderCorrections();
    fireEvent.submit(open());
    await waitFor(() => expect(notify.find("That change could not be saved.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a refusal in the database's own words is shown as it is said", async () => {
    fake.rpc("update_attendance_session").reply(fail("This meeting has already opened"));
    const { notify } = renderCorrections();
    fireEvent.submit(open());
    await waitFor(() => expect(notify.find("This meeting has already opened").tone).toBe("error"));
  });
});

describe("deleting a meeting that has not opened", () => {
  it("asks first; confirming sends the delete, says so as a success and reports the change", async () => {
    fake.rpc("delete_attendance_session").reply(ok(null));
    const { notify, onChanged } = renderCorrections();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(within(dialog()).getByText("Delete this meeting?")).toBeInTheDocument();
    expect(fake.rpc("delete_attendance_session").count).toBe(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete meeting" }));
    await waitFor(() => expect(notify.find("Meeting deleted").tone).toBe("success"));
    expect(fake.rpc("delete_attendance_session").calls[0].payload).toEqual({ p_session_id: 5 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("Cancel sends nothing", () => {
    renderCorrections();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.rpc("delete_attendance_session").count).toBe(0);
  });

  it("a refusal keeps the dialog and says the fallback sentence", async () => {
    fake.rpc("delete_attendance_session").reply(fail(RAW));
    const { notify, onChanged } = renderCorrections();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete meeting" }));
    await waitFor(() => expect(notify.find("That change could not be saved.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("voiding a closed meeting", () => {
  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "Void meeting" }));
    return within(dialog()).getByLabelText("Reason").closest("form")!;
  };

  it("needs a reason of three characters before it can be sent", () => {
    renderCorrections({ status: "closed" });
    const form = open();
    const send = () => within(form).getByRole("button", { name: "Void meeting" });
    expect(send()).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "ab " } });
    expect(send()).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "abc" } });
    expect(send()).toBeEnabled();
  });

  it("sends the trimmed reason, says it no longer counts as a success, closes, reports the change and forgets the reason", async () => {
    fake.rpc("void_attendance_session").reply(ok(null));
    const { notify, onChanged } = renderCorrections({ status: "closed" });
    const form = open();
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "  Created twice  " } });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Meeting voided. It no longer counts toward attendance.").tone).toBe("success"));
    expect(fake.rpc("void_attendance_session").calls[0].payload).toEqual({ p_session_id: 5, p_reason: "Created twice" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Void meeting" }));
    expect(within(dialog()).getByLabelText("Reason")).toHaveValue("");
  });

  it("a refusal keeps the dialog and the reason typed, and says the fallback sentence", async () => {
    fake.rpc("void_attendance_session").reply(fail(RAW));
    const { notify } = renderCorrections({ status: "closed" });
    const form = open();
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Created twice" } });
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("That change could not be saved.").tone).toBe("error"));
    expect(within(dialog()).getByLabelText("Reason")).toHaveValue("Created twice");
  });
});

describe("clearing a mark", () => {
  const renderClear = () => {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<ClearMarkButton sessionId={5} memberId="u-dev" memberName="Dev Nair" onChanged={onChanged} />);
    return { notify, onChanged };
  };

  it("asks first, naming the member; confirming sends the clear, says so, closes and reports the change", async () => {
    fake.rpc("clear_attendance_status").reply(ok(null));
    const { notify, onChanged } = renderClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    expect(within(dialog()).getByText("Clear the mark for Dev Nair?")).toBeInTheDocument();
    expect(fake.rpc("clear_attendance_status").count).toBe(0);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Clear mark" }));
    await waitFor(() => expect(notify.find("Mark cleared")).toBeTruthy());
    expect(notify.toasts()).toEqual([{ message: "Mark cleared", tone: undefined }]);
    expect(fake.rpc("clear_attendance_status").calls[0].payload).toEqual({ p_session_id: 5, p_member_id: "u-dev" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a refusal says the fallback sentence as an error and keeps the dialog", async () => {
    fake.rpc("clear_attendance_status").reply(fail(RAW));
    const { notify, onChanged } = renderClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear attendance mark for Dev Nair" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Clear mark" }));
    await waitFor(() => expect(notify.find("The mark could not be cleared.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("changing the policy levels", () => {
  const renderThresholds = () => {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<ThresholdSettings warning={2} critical={3} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Change thresholds" }));
    const form = within(dialog()).getByRole("button", { name: "Save thresholds" }).closest("form")!;
    const set = (warning: string, critical: string) => {
      fireEvent.change(within(form).getByLabelText("Warning at"), { target: { value: warning } });
      fireEvent.change(within(form).getByLabelText("Review at"), { target: { value: critical } });
    };
    return { notify, onChanged, form, set };
  };

  it("starts from the levels in force", () => {
    const { form } = renderThresholds();
    expect(within(form).getByLabelText("Warning at")).toHaveValue(2);
    expect(within(form).getByLabelText("Review at")).toHaveValue(3);
  });

  it("sends both whole numbers, says so, closes and reports the change", async () => {
    fake.rpc("set_attendance_thresholds").reply(ok(null));
    const { notify, onChanged, form, set } = renderThresholds();
    set("3", "5");
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Attendance thresholds updated")).toBeTruthy());
    expect(notify.toasts()).toEqual([{ message: "Attendance thresholds updated", tone: undefined }]);
    expect(fake.rpc("set_attendance_thresholds").calls[0].payload).toEqual({ p_warning: 3, p_critical: 5 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a review level equal to the warning level", "3", "3"],
    ["a review level below the warning level", "4", "3"],
    ["a warning level of 0", "0", "2"],
    ["a fraction", "2.5", "4"],
    ["a missing number", "", "4"],
  ])("refuses %s before anything is sent, without the error tone", (_name, warning, critical) => {
    const { notify, form, set } = renderThresholds();
    set(warning, critical);
    fireEvent.submit(form);
    expect(notify.toasts()).toEqual([{ message: "The review level must be higher than the warning level.", tone: undefined }]);
    expect(fake.rpc("set_attendance_thresholds").count).toBe(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a review level one above the warning level is allowed", async () => {
    fake.rpc("set_attendance_thresholds").reply(ok(null));
    const { form, set } = renderThresholds();
    set("1", "2");
    fireEvent.submit(form);
    await waitFor(() => expect(fake.rpc("set_attendance_thresholds").calls[0].payload).toEqual({ p_warning: 1, p_critical: 2 }));
  });

  it("a refusal says the fallback sentence as an error, keeps the dialog and reports nothing", async () => {
    fake.rpc("set_attendance_thresholds").reply(fail(RAW));
    const { notify, onChanged, form, set } = renderThresholds();
    set("3", "5");
    fireEvent.submit(form);
    await waitFor(() => expect(notify.find("Thresholds could not be saved.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("withdrawing an absence form", () => {
  const renderWithdraw = () => {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<WithdrawExcuseButton excuseId={4} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    return { notify, onChanged };
  };

  it("asks first; confirming sends the withdrawal, says so, closes and reports the change", async () => {
    fake.rpc("withdraw_attendance_excuse").reply(ok(null));
    const { notify, onChanged } = renderWithdraw();
    expect(within(dialog()).getByText("Withdraw this absence form?")).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(notify.find("Absence form withdrawn")).toBeTruthy());
    expect(notify.toasts()).toEqual([{ message: "Absence form withdrawn", tone: undefined }]);
    expect(fake.rpc("withdraw_attendance_excuse").calls[0].payload).toEqual({ p_excuse_id: 4 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a refusal says the fallback sentence as an error and keeps the dialog", async () => {
    fake.rpc("withdraw_attendance_excuse").reply(fail(RAW));
    const { notify, onChanged } = renderWithdraw();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(notify.find("The form could not be withdrawn.").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
