// The tone of a toast, checked where the person sees it: a sentence that comes from the database is shown as a failure.
//
// Replaces tests/toast-call-sites.test.mjs. That test read every notify(...) call in app/, components/ and lib/ as text and
// failed when a call that showed database text did not say "error". What each of its four tests protected, and where it is
// checked now:
//
//  "every notify() that shows database text passes "error"" -- the one that matters. The words of a database message say
//    nothing about whether it is a failure (81 of the 157 messages the migrations raise would read as a success), so a call
//    that forgets "error" shows a failure with the tick of a success.
//    -> every screen's tests script a failing answer whose sentence has no failure word in it ("Everything has been
//       saved") and require the toast to be an error: finance.test.tsx ("a failure that shows the database's own sentence
//       is announced as an error"), attendance.test.tsx ("tone of every failure on the screen"), shell-feedback.test.tsx
//       (the contact information, the recording upload), people-recordings.test.tsx, resources-library.test.tsx, and this
//       file for everything else: the Admin page, groups, the calendar, member access, announcements, and the
//       edit / archive / delete controls of recordings, notation and library items.
//       toast.test.mjs still runs the real messages of the migrations through the tone rules.
//       Each of the 51 call sites that show database text was also switched to "untagged" in turn (a temporary change, never
//       committed) and the whole component suite was run: every one of them makes a test here or in the files above fail.
//  "the scan sees the calls it is meant to check" -- a check of the scan itself; with no scan there is nothing to check.
//  "a message held in a variable states its tone" -- the same rule for a message built elsewhere (a stored-file problem, a
//    partly saved upload); those are the "the file could not be deleted" and "saved, but the receipt failed" tests of the
//    files above, which all require "error".
//  "a tone is only ever one of the two the toast knows" -- `ToastTone` in lib/toast.ts is a union of the two, so tsc refuses
//    anything else; no test is needed.
//
// How a toast is read: through the shell, the toast element itself (alert role, "error" class, no tick). For a control that
// is given `notify`, the tone the control asked for.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberAccessActions } from "../../features/admin/components/member-access";
import { AnnouncementActions } from "../../features/announcements/components/announcement-actions";
import { ClubArchiveManager, type ClubArchiveItem } from "../../features/recordings/components/club-archive-manager";
import { NoteActions, RecordingManageBar, type ManagedNote, type ManagedRecording } from "../../features/recordings/components/recording-manage";
import { ResourceActions, type ManagedResource } from "../../components/resources/resource-actions";
import { GroupPeople } from "../../features/groups/components/group-people";
import { notifySpy, userOf } from "../support/helpers";
import { fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

// A sentence the database really raises, with none of the words that make text read as a failure.
const CHEERFUL = "Everything has been saved";
const EXECUTIVE = "executive" as const;

// ---------------------------------------------------------------------------------------------------------------
// Through the shell
// ---------------------------------------------------------------------------------------------------------------

const member = (id: string, name: string, role = "member") => ({ id, full_name: name, email: `${id}@x.test`, role, status: "active", phone: "1", class_year: "2027", specialty: "Vocal", joined_at: "2025-08-01" });
const GROUP = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null };

/** The toast on screen for this sentence is a failure: announced as an alert, wearing no tick. */
async function expectFailureToast(sentence: string) {
  // A success toast carries a tick in the same element, so the sentence is matched as a part of it.
  const shown = await screen.findByText(new RegExp(sentence));
  expect(shown).toHaveAttribute("role", "alert");
  expect(shown).toHaveClass("toast", "error");
  expect(shown).not.toHaveTextContent(/^✓/);
}

describe("the Admin page announces a database sentence as a failure", () => {
  async function openAdmin() {
    fake.from("profiles", "select").reply(ok([member("u-me", "Asha Rao", "admin"), member("u-2", "Bala Menon")]));
    openPortal({ role: "admin", page: "admin", boot: { groups: [GROUP] } });
    await screen.findByText("Bala Menon");
  }

  it("changing a permission", async () => {
    fake.rpc("admin_change_member_role").reply(fail(CHEERFUL));
    await openAdmin();
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    await expectFailureToast(CHEERFUL);
  });

  it("saving a member's profile", async () => {
    fake.rpc("admin_update_member_profile").reply(fail(CHEERFUL));
    await openAdmin();
    const row = screen.getByLabelText("Permission for Bala Menon").closest(".admin-member-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Edit member" }).closest("form")!);
    await expectFailureToast(CHEERFUL);
    // The editor stays open, so what was typed is not lost.
    expect(screen.getByRole("heading", { name: "Edit member" })).toBeInTheDocument();
  });

  it("posting an announcement", async () => {
    fake.from("announcements", "insert").reply(fail(CHEERFUL));
    await openAdmin();
    fireEvent.submit(screen.getByRole("heading", { name: "Post announcement" }).closest("form")!);
    await expectFailureToast(CHEERFUL);
  });

  it("a success is announced as a success, so the checks above are not just 'every toast is an error'", async () => {
    fake.rpc("admin_change_member_role").reply(ok(null));
    await openAdmin();
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    const shown = await screen.findByText(/Bala Menon is now executive/);
    expect(shown).toHaveAttribute("role", "status");
    expect(shown).toHaveClass("toast", "success");
  });
});

describe("Groups announce a database sentence as a failure", () => {
  it("creating a group", async () => {
    fake.from("subgroups", "select").reply(ok([GROUP]));
    fake.rpc("create_subgroup").reply(fail(CHEERFUL));
    openPortal({ role: "executive", page: "groups", boot: { groups: [GROUP] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ New group" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Create a group" }).closest("form")!);
    await expectFailureToast(CHEERFUL);
  });

  it("posting a group update", async () => {
    fake.from("subgroups", "select").reply(ok([GROUP]));
    fake.from("announcements", "insert").reply(fail(CHEERFUL));
    openPortal({ role: "executive", page: "groups", boot: { groups: [GROUP] } });
    fireEvent.click(await screen.findByRole("button", { name: /Hindustani Vocal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Post update" }));
    fireEvent.submit(screen.getByRole("heading", { name: "Post a group update" }).closest("form")!);
    await expectFailureToast(CHEERFUL);
  });
});

describe("the calendar announces a database sentence as a failure", () => {
  it("removing a date", async () => {
    const soon = { id: 3, title: "Diwali concert", description: "", starts_at: new Date().toISOString(), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null };
    fake.from("events", "select").reply(ok([soon]));
    fake.from("events", "delete").reply(fail(CHEERFUL));
    openPortal({ role: "executive", page: "calendar", boot: { events: [soon] } });
    // The date is on the month grid and in the agenda below it; either button removes it.
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete Diwali concert" }))[0]);
    await expectFailureToast(CHEERFUL);
    expect(window.confirm).toHaveBeenCalledWith("Remove this date from the calendar?");
    expect(fake.from("events", "delete").calls[0].used("eq", "id", 3)).toBe(true);
  });

  const soon = { id: 3, title: "Diwali concert", description: "", starts_at: new Date().toISOString(), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null };

  it("adding a date", async () => {
    fake.from("events", "insert").reply(fail(CHEERFUL));
    openPortal({ role: "executive", page: "calendar", boot: { events: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add important date" }));
    const form = screen.getByRole("heading", { name: "Add an important date" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Open mic" } });
    fireEvent.change(within(form).getByLabelText("Date and time"), { target: { value: "2026-12-01T19:00" } });
    fireEvent.submit(form);
    await expectFailureToast(CHEERFUL);
    // The form stays open so nothing typed is lost.
    expect(screen.getByRole("heading", { name: "Add an important date" })).toBeInTheDocument();
  });

  it("saving a change to a date that was removed meanwhile (no row changes) says so, as a failure", async () => {
    fake.from("events", "select").reply(ok([soon]));
    fake.from("events", "update").reply(ok([]));
    openPortal({ role: "executive", page: "calendar", boot: { events: [soon] } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit Diwali concert" }))[0]);
    fireEvent.submit(screen.getByRole("heading", { name: "Edit this date" }).closest("form")!);
    await expectFailureToast("This date could not be saved. It may have been removed.");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Controls that are given `notify`
// ---------------------------------------------------------------------------------------------------------------

/** Opens a confirmation dialog and presses its confirm button. */
function confirm(open: string, confirmLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: open }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: confirmLabel }));
}
const toneOf = (notify: ReturnType<typeof notifySpy>, sentence: string) => notify.find(sentence).tone;

describe("member access: a database sentence is a failure, and the dialog stays open", () => {
  const active = { id: "u-2", full_name: "Bala Menon", email: "u-2@x.test", status: "active" as const };
  const gone = { ...active, status: "deactivated" as const };

  it.each([
    ["deactivating", "admin_deactivate_member", active, "Deactivate", "Deactivate"],
    ["reactivating", "admin_reactivate_member", gone, "Reactivate", "Reactivate"],
    ["deleting", "admin_delete_member", gone, "Delete", "Delete account"],
  ] as const)("%s", async (_what, rpc, person, open, confirmLabel) => {
    fake.rpc(rpc).reply(fail(CHEERFUL));
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<MemberAccessActions member={person} isSelf={false} onChanged={onChanged} notify={notify} />);
    confirm(open, confirmLabel);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("announcements: pinning and deleting", () => {
  const announcement = { id: 4, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, subgroup_id: null };
  function renderActions() {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<AnnouncementActions user={userOf("u-me")} groups={[]} announcement={announcement} onChanged={onChanged} notify={notify} />);
    return { notify, onChanged };
  }

  it("a database sentence while pinning is a failure", async () => {
    fake.from("announcements", "update").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin Rehearsal moved" }));
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence while deleting is a failure", async () => {
    fake.from("announcements", "delete").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderActions();
    confirm("Delete Rehearsal moved", "Delete announcement");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("club recordings: a database sentence while deleting is a failure", () => {
  const ITEM: ClubArchiveItem = {
    id: 11, title: "Spring concert", description: "", storage_path: "u-1/spring.mp4", visibility: "members", event_date: null, raga: null, tala: null,
    created_at: "2026-04-01T00:00:00Z", is_public: false, subgroup_id: null,
  };

  it("the row cannot be deleted", async () => {
    fake.from("recordings", "select").reply(ok([]));            // not shared with a group's recording room
    fake.from("archive_items", "delete").reply(fail(CHEERFUL));
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<ClubArchiveManager items={[ITEM]} groups={[]} onAdd={vi.fn()} onChanged={onChanged} notify={notify} />);
    confirm("Delete", "Delete recording");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence while saving an edit is a failure, and the dialog stays open", async () => {
    fake.from("archive_items", "update").reply(fail(CHEERFUL));
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<ClubArchiveManager items={[ITEM]} groups={[]} onAdd={vi.fn()} onChanged={onChanged} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("an edit that changes no row (no permission) says so, as a failure", async () => {
    fake.from("archive_items", "update").reply(ok([]));
    const notify = notifySpy();
    render(<ClubArchiveManager items={[ITEM]} groups={[]} onAdd={vi.fn()} onChanged={vi.fn()} notify={notify} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, "You do not have permission to edit this recording.")).toBe("error"));
  });
});

describe("a group's recording: editing and deleting", () => {
  const RECORDING: ManagedRecording = {
    id: 1, title: "Varnam take", description: "", uploaded_by: "u-me", storage_path: "u-me/take.mp3", status: "published", recording_kind: "practice",
    raga: null, tala: null, sruthi: null, tempo: null,
  };
  function renderBar() {
    const notify = notifySpy();
    const onChanged = vi.fn();
    const onRemoved = vi.fn();
    render(<RecordingManageBar recording={RECORDING} user={userOf("u-me")} canManage={false} notes={[]} notify={notify} onChanged={onChanged} onRemoved={onRemoved} />);
    return { notify, onChanged, onRemoved };
  }

  it("a database sentence while saving the details is a failure, and the dialog stays open", async () => {
    fake.from("recordings", "update").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save details" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("an edit that changes no row (no permission) says so, as a failure", async () => {
    fake.from("recordings", "update").reply(ok([]));
    const { notify } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save details" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, "You do not have permission to edit this recording.")).toBe("error"));
  });

  it.each([["archiving", "Archive"], ["restoring", "Restore"]])("a database sentence while %s is a failure", async (_what, open) => {
    fake.from("recordings", "update").reply(fail(CHEERFUL));
    const notify = notifySpy();
    const onRemoved = vi.fn();
    render(<RecordingManageBar recording={{ ...RECORDING, status: open === "Restore" ? "archived" : "published" }} user={userOf("u-me")} canManage={false} notes={[]} notify={notify} onChanged={vi.fn()} onRemoved={onRemoved} />);
    confirm(open, open);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a database sentence while deleting the row is a failure", async () => {
    fake.from("recordings", "delete").reply(fail(CHEERFUL));
    const { notify, onRemoved } = renderBar();
    confirm("Delete", "Delete recording");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a delete that removes no row says so, as a failure", async () => {
    fake.from("recordings", "delete").reply(ok([]));
    const { notify } = renderBar();
    confirm("Delete", "Delete recording");
    await waitFor(() => expect(toneOf(notify, "The recording could not be deleted.")).toBe("error"));
  });
});

describe("a notation item: renaming and deleting", () => {
  const NOTE: ManagedNote = { id: 3, recording_id: 1, title: "Sargam", note_type: "text", body: "S R G M", storage_path: null, mime_type: null, uploaded_by: "u-me" };
  function renderNote() {
    const notify = notifySpy();
    const onChanged = vi.fn();
    render(<NoteActions note={NOTE} user={userOf("u-me")} canManage={false} notify={notify} onChanged={onChanged} />);
    return { notify, onChanged };
  }

  it("a database sentence while saving is a failure", async () => {
    fake.from("recording_notes", "update").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderNote();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence while deleting is a failure", async () => {
    fake.from("recording_notes", "delete").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderNote();
    confirm("Delete", "Delete");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("a library item: edit, pin, visibility, archive and delete", () => {
  const ITEM: ManagedResource = {
    id: 4, node_kind: "link", title: "Syllabus", description: "", parent_id: null, visibility: "members",
    storage_bucket: null, storage_path: null, external_url: "https://example.org/syllabus", status: "ready", is_pinned: false,
  };
  function renderActions() {
    const notify = notifySpy();
    const onChanged = vi.fn();
    const onRemoved = vi.fn();
    render(<ResourceActions item={ITEM} canManage isExecutive childCount={0} notify={notify} onChanged={onChanged} onRemoved={onRemoved} />);
    return { notify, onChanged, onRemoved };
  }

  it("a database sentence while saving an edit is a failure, and the dialog stays open", async () => {
    fake.from("resources", "update").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: "Save changes" }).closest("form")!);
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence while pinning is a failure", async () => {
    fake.from("resources", "update").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a pin or an edit that changes no row (no permission) says so, as a failure", async () => {
    fake.from("resources", "update").reply(ok([]));
    const { notify } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(toneOf(notify, "You do not have permission to pin this resource.")).toBe("error"));
  });

  it("a database sentence while changing who can see it is a failure", async () => {
    fake.rpc("set_resource_visibility").reply(fail(CHEERFUL));
    const { notify, onChanged } = renderActions();
    confirm("Limit to executives", "Limit to executives");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a database sentence while archiving is a failure", async () => {
    fake.rpc("set_resource_archived").reply(fail(CHEERFUL));
    const { notify, onRemoved } = renderActions();
    confirm("Archive", "Archive");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("a database sentence while deleting is a failure", async () => {
    fake.from("resources", "delete").reply(fail(CHEERFUL));
    const { notify, onRemoved } = renderActions();
    confirm("Delete", "Delete");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

describe("adding a member: the list of club members cannot be loaded", () => {
  it("a database sentence is a failure", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.from("profiles", "select").reply(fail(CHEERFUL));
    const notify = notifySpy();
    render(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={{ id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "approval", archived_at: null }} myRole={null} isMember={false} onGroupChanged={vi.fn()} onLeft={vi.fn()} notify={notify} />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add member" }));
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
  });
});

describe("group settings: a database sentence is a failure", () => {
  const GROUP_ROW = { id: 7, name: "Hindustani Vocal", description: "Weekly practice", enrollment_mode: "approval" as const, archived_at: null };
  function renderPeople() {
    const notify = notifySpy();
    const onGroupChanged = vi.fn();
    render(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={GROUP_ROW} myRole={null} isMember={false} onGroupChanged={onGroupChanged} onLeft={vi.fn()} notify={notify} />);
    return { notify, onGroupChanged };
  }
  async function saveSettings(change?: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Group settings" }));
    const dialog = screen.getByRole("dialog");
    if (change) fireEvent.change(within(dialog).getByLabelText("How members join"), { target: { value: change } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Save" }).closest("form")!);
  }

  it("the name and description cannot be saved", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.rpc("update_subgroup").reply(fail(CHEERFUL));
    const { notify, onGroupChanged } = renderPeople();
    await saveSettings();
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onGroupChanged).not.toHaveBeenCalled();
  });

  it("the joining mode cannot be changed", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.rpc("update_subgroup").reply(ok(null));
    fake.rpc("set_subgroup_enrollment_mode").reply(fail(CHEERFUL));
    const { notify, onGroupChanged } = renderPeople();
    await saveSettings("open");
    await waitFor(() => expect(toneOf(notify, CHEERFUL)).toBe("error"));
    expect(onGroupChanged).not.toHaveBeenCalled();
  });
});
