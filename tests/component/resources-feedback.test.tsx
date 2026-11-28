// Phase 3 on the resource library: what a person sees while files go up (a row per file, its bar, Saving, Uploaded or the reason), that a
// button pressed twice sends one request, that nothing closes a panel while it is busy, that a form keeps what was typed when the save
// fails, that a first read that failed is an error with Try again (and never the empty shelf), the address (?q=, ?folder=) and the
// shared dialogs the two side panels and the preview are made of.
//
// Uploads go through the fake XMLHttpRequest as it is (no bridge to the fake client): a test answers the request itself, so it can say how
// many bytes have left (`request.progress`) and when the server answered (`request.respond`).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResourceLibrary } from "../../features/resources/components/resource-library";
import { setCacheOwner } from "../../lib/cache";
import type { GroupRole, MembershipStatus } from "../../lib/db";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, withCount, type Call } from "../support/fake-supabase";
import { expectNoSeriousViolations } from "../support/a11y";
import { installFakeXhr } from "../support/fake-xhr";
import { focusedName, keyboardUser } from "../support/keyboard";

// ---------------------------------------------------------------------------------------------------------------
// Data and scripting (the small part of tests/component/resources-library.test.tsx these tests need)
// ---------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: number };
const res = (id: number, title: string, over: Record<string, unknown> = {}): Row => ({
  id, node_kind: "file", media_kind: "document", title, description: null, parent_id: null, subgroup_id: null, visibility: "members",
  storage_bucket: "club-resources", storage_path: `u-1/${id}-${title}`, external_url: null, original_filename: title, mime_type: "application/pdf",
  byte_size: 2048, checksum_sha256: null, event_id: null, occurred_on: null, season_label: null, status: "ready", is_pinned: false, import_id: null,
  created_by: "u-1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z", ...over,
});
const folderRow = (id: number, title: string, over: Record<string, unknown> = {}) =>
  res(id, title, { node_kind: "folder", media_kind: null, storage_bucket: null, storage_path: null, mime_type: null, byte_size: null, original_filename: null, ...over });
const linkRow = (id: number, title: string) =>
  res(id, title, { node_kind: "link", media_kind: null, storage_bucket: null, storage_path: null, mime_type: null, byte_size: null, original_filename: null, external_url: "https://docs.example.org/rep" });

function scriptLibrary(over: { rows?: Row[]; byId?: Record<number, Row | null> } = {}) {
  const world = { rows: [] as Row[], byId: {} as Record<number, Row | null>, ...over };
  fake.from("resources", "select").reply((call: Call) => {
    const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
    if (options.head) return withCount(0);
    if (call.used("maybeSingle")) return ok(world.byId[call.uses("eq").find(([column]) => column === "id")?.[1] as number] ?? null);
    if (call.used("in", "id") || call.used("eq", "node_kind", "folder")) return ok([]);
    return ok(world.rows, { count: world.rows.length });
  });
  return world;
}
function scriptUploads() {
  let nextId = 100;
  fake.from("resources", "insert").reply((call) => ok({ ...(call.payload as object), id: ++nextId, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }));
  fake.from("resources", "update").reply((call) => ok({ id: call.uses("eq")[0][1], status: (call.payload as { status: string }).status }));
  fake.from("resource_imports", "insert").reply(ok({ id: "imp-1" }));
  fake.from("resource_imports", "update").reply(ok(null));
}

type Options = { role?: "member" | "executive" | "admin"; groups?: Array<{ id: number; name: string }>; memberships?: Array<{ subgroup_id: number; status: MembershipStatus; membership_role: GroupRole }> };
function renderLibrary(options: Options = {}) {
  const notify = notifySpy();
  setCacheOwner("u-me");
  const view = render(<ResourceLibrary user={userOf("u-me")} role={options.role ?? "executive"} groups={options.groups ?? []} memberships={options.memberships ?? []} events={[]} initialScope="all" />);
  return { notify, ...view };
}
const listReads = () => fake.from("resources", "select").calls.filter((call) => call.used("range"));
const rowButton = (title: string) => screen.findByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
const SEARCH = "Search title, filename, or description";

function fileAt(name: string, size = 10, type = "application/pdf") { return new File(["x".repeat(size)], name, { type }); }
async function chooseFiles(files: File[], entry: RegExp = /Upload files/) {
  fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
  fireEvent.click(screen.getByRole("button", { name: entry }));
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files } });
}
async function openForm(entry: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
  fireEvent.click(screen.getByRole("button", { name: entry }));
}
const startButton = () => screen.getByRole("button", { name: "Start upload" });
// A press on the dimmed area around a dialog: the shared Dialog closes on the click that follows a press that began there.
const pressBeside = (panel: HTMLElement) => { fireEvent.mouseDown(panel.parentElement!); fireEvent.click(panel.parentElement!); };

// ---------------------------------------------------------------------------------------------------------------
// Files going up
// ---------------------------------------------------------------------------------------------------------------

describe("uploading files: a row per file", () => {
  it("shows each file waiting, then its bar while its bytes go, Saving once they have all left, then Uploaded; three go at a time", async () => {
    const xhr = installFakeXhr();
    scriptLibrary();
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles([fileAt("a.pdf"), fileAt("b.pdf"), fileAt("c.pdf"), fileAt("d.pdf")]);
    const rows = within(screen.getByRole("list", { name: "Files being uploaded" }));
    expect(rows.getAllByText("Waiting")).toHaveLength(4);
    fireEvent.click(startButton());
    await waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(3));
    expect(rows.getAllByText("Waiting")).toHaveLength(1);
    const requestOf = (name: string) => xhr.requests.find((request) => request.url.endsWith(`/${name}`))!;
    act(() => requestOf("a.pdf").progress(250, 1000));
    expect(screen.getByRole("progressbar", { name: "Uploading a.pdf" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByRole("progressbar", { name: "Uploading b.pdf" })).toHaveAttribute("aria-valuenow", "0");
    act(() => requestOf("a.pdf").progress(1000, 1000));
    expect(screen.getByRole("progressbar", { name: "Uploading a.pdf" })).toHaveAttribute("aria-valuetext", "Saving");
    await act(async () => { requestOf("a.pdf").respond(200, { Id: "1", Key: "club-resources/x" }); });
    await waitFor(() => expect(rows.getByText("Uploaded")).toBeInTheDocument());
    expect(screen.getByText("1 of 4 complete")).toBeInTheDocument();
    // The file that waited starts as soon as one of the three is done.
    await waitFor(() => expect(requestOf("d.pdf")).toBeTruthy());
    for (const name of ["b.pdf", "c.pdf", "d.pdf"]) await act(async () => { requestOf(name).respond(200, { Id: name, Key: `club-resources/${name}` }); });
    await waitFor(() => expect(notify.find("4 files uploaded")).toBeTruthy());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Start upload pressed twice sends one batch", async () => {
    const xhr = installFakeXhr();
    scriptLibrary();
    scriptUploads();
    renderLibrary();
    await chooseFiles([fileAt("a.pdf"), fileAt("b.pdf")]);
    const start = startButton();
    act(() => { start.click(); start.click(); });
    await waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2));
    await act(async () => { await Promise.resolve(); });
    expect(fake.from("resource_imports", "insert").calls).toHaveLength(1);
    expect(fake.from("resources", "insert").calls).toHaveLength(2);
    expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
    for (const request of xhr.requests) await act(async () => { request.respond(200, { Id: "1", Key: "club-resources/x" }); });
    await waitFor(() => expect(fake.from("resource_imports", "update").calls).toHaveLength(1));
  });

  it("a refused file says why in its row; the others are uploaded; the panel stays so that the failed file can be reset and sent again", async () => {
    const xhr = installFakeXhr();
    scriptLibrary();
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles([fileAt("good.pdf"), fileAt("big.pdf")]);
    fireEvent.click(startButton());
    await waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2));
    const requestOf = (name: string) => xhr.requests.find((request) => request.url.endsWith(`/${name}`))!;
    await act(async () => { requestOf("good.pdf").respond(200, { Id: "1", Key: "club-resources/good.pdf" }); });
    await act(async () => { requestOf("big.pdf").respond(413, { message: "The object exceeded the maximum allowed size", statusCode: "413" }); });
    await waitFor(() => expect(notify.find("1 file uploaded; 1 failed").tone).toBe("error"));
    const rows = within(screen.getByRole("list", { name: "Files being uploaded" }));
    expect(rows.getByText("Failed: The object exceeded the maximum allowed size")).toBeInTheDocument();
    expect(rows.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add resource" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset failed" }));
    await waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(3));
    await act(async () => { requestOf("big.pdf"); xhr.last.respond(200, { Id: "2", Key: "club-resources/big.pdf" }); });
    await waitFor(() => expect(notify.find("1 file uploaded")).toBeTruthy());
  });

  it("the hidden file input is named and cannot be reached with Tab; the button that opens it can", async () => {
    scriptLibrary();
    renderLibrary();
    await chooseFiles([]);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("aria-label", "Files to upload");
    expect(input.tabIndex).toBe(-1);
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeEnabled();
  });
});

describe("saving a folder or a link", () => {
  it("a folder form sent twice before the button is disabled creates one folder", async () => {
    const answer = deferred();
    scriptLibrary();
    fake.from("resources", "insert").reply(answer.reply);
    const { notify } = renderLibrary();
    await openForm(/Create folder/);
    const form = screen.getByLabelText("Folder name").closest("form")!;
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Concerts" } });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await waitFor(() => expect(fake.from("resources", "insert").calls).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(fake.from("resources", "insert").calls).toHaveLength(1);
    await act(async () => { answer.resolve(ok(folderRow(50, "Concerts"))); });
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    expect(fake.from("resources", "insert").calls).toHaveLength(1);
  });

  it("a link form sent twice before the button is disabled saves one link", async () => {
    const answer = deferred();
    scriptLibrary();
    fake.from("resources", "insert").reply(answer.reply);
    const { notify } = renderLibrary();
    await openForm(/Add link/);
    const form = screen.getByLabelText("Link title").closest("form")!;
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "docs.example.org/rep" } });
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await waitFor(() => expect(fake.from("resources", "insert").calls).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(fake.from("resources", "insert").calls).toHaveLength(1);
    await act(async () => { answer.resolve(ok(linkRow(51, "Repertoire"))); });
    await waitFor(() => expect(notify.messages().length).toBeGreaterThan(0));
    expect(fake.from("resources", "insert").calls).toHaveLength(1);
  });

  it("while a save is on the way nothing closes the panel; a save that fails keeps what was typed and the panel open", async () => {
    const answer = deferred();
    scriptLibrary();
    fake.from("resources", "insert").reply(answer.reply);
    renderLibrary();
    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "docs.example.org/rep" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "The pieces we are working on" } });
    fireEvent.submit(screen.getByLabelText("Link title").closest("form")!);
    const panel = await screen.findByRole("dialog", { name: "Add resource" });
    await screen.findByRole("button", { name: "Saving…" });
    // Busy: Escape, the close button, Cancel and a click beside the panel do nothing.
    fireEvent.keyDown(document, { key: "Escape" });
    pressBeside(panel);
    expect(screen.getByRole("button", { name: "Close add resource" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Add resource" })).toBeInTheDocument();
    await act(async () => { answer.resolve(fail("The service is busy. Try again in a moment.")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("The service is busy. Try again in a moment.");
    expect(screen.getByLabelText("Link title")).toHaveValue("Repertoire");
    expect(screen.getByLabelText("Web address")).toHaveValue("docs.example.org/rep");
    expect(screen.getByLabelText(/Description/)).toHaveValue("The pieces we are working on");
    expect(screen.getByRole("button", { name: "Save resource" })).toBeEnabled();
    // Free again: Escape closes it.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a confirmed delete sent twice before the buttons are disabled deletes once", async () => {
    const answer = deferred();
    scriptLibrary({ rows: [linkRow(5, "Repertoire sheet")] });
    fake.from("resources", "delete").reply(answer.reply);
    const { notify } = renderLibrary();
    fireEvent.click(await rowButton("Repertoire sheet"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete this link?" });
    const yes = within(confirm).getByRole("button", { name: "Delete" });
    act(() => { yes.click(); yes.click(); });
    await waitFor(() => expect(fake.from("resources", "delete").calls).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(fake.from("resources", "delete").calls).toHaveLength(1);
    await act(async () => { answer.resolve(ok([{ id: 5 }])); });
    await waitFor(() => expect(notify.find("The link was deleted")).toBeTruthy());
    expect(fake.from("resources", "delete").calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The panels are the shared dialog
// ---------------------------------------------------------------------------------------------------------------

describe("the add-resource and details panels are dialogs", () => {
  it("the add panel is a dialog named Add resource: the focus goes in, Tab stays in, Escape closes it and the focus returns to the button", async () => {
    scriptLibrary();
    renderLibrary();
    const opener = await screen.findByRole("button", { name: "Add resource" });
    opener.focus();
    fireEvent.click(opener);
    const panel = await screen.findByRole("dialog", { name: "Add resource" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Close add resource" })).toHaveFocus());
    // Shift+Tab from the first control wraps to the last one.
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: /Upload folder/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close add resource" })).toHaveFocus();
    // The page behind is out of reach.
    expect(screen.getByRole("heading", { name: "Resources", level: 1 }).closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("choosing what to add moves the focus to the first thing to fill in, and a click beside the form does not lose what was typed", async () => {
    scriptLibrary();
    renderLibrary();
    await openForm(/Create folder/);
    await waitFor(() => expect(screen.getByLabelText("Folder name")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Concerts" } });
    pressBeside(screen.getByRole("dialog", { name: "Add resource" }));
    expect(screen.getByLabelText("Folder name")).toHaveValue("Concerts");
    expect(screen.getByRole("dialog", { name: "Add resource" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("the details panel is a dialog named by the item: Escape closes it and the focus returns to the row", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary();
    const row = await rowButton("Syllabus.pdf");
    row.focus();
    fireEvent.click(row);
    const panel = await screen.findByRole("dialog", { name: "Syllabus.pdf" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Close resource details" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
  });

  it("a confirmation opened inside the details is above them: Escape closes it first and the details stay", async () => {
    scriptLibrary({ rows: [linkRow(5, "Repertoire sheet")] });
    renderLibrary();
    fireEvent.click(await rowButton("Repertoire sheet"));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await screen.findByRole("dialog", { name: "Archive this link?" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Archive this link?" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Repertoire sheet" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Reading the library
// ---------------------------------------------------------------------------------------------------------------

describe("the first read of the library", () => {
  it("shows a skeleton with a status while the rows are on the way", async () => {
    const answer = deferred();
    fake.from("resources", "select").reply((call: Call) => ((call.uses("select")[0]?.[1] as { head?: boolean })?.head ? withCount(0) : call.used("range") ? answer.reply : ok([])));
    renderLibrary();
    expect(await screen.findByRole("status")).toHaveTextContent("Opening the library");
    expect(document.querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
    await act(async () => { answer.resolve(ok([res(5, "Syllabus.pdf")], { count: 1 })); });
    await rowButton("Syllabus.pdf");
    expect(screen.queryByText("Opening the library")).not.toBeInTheDocument();
  });

  it("a first read that failed is an error with Try again, not the empty shelf; Try again shows the skeleton, never the empty shelf, and then the rows", async () => {
    const second = deferred();
    let reads = 0;
    fake.from("resources", "select").reply((call: Call) => {
      if ((call.uses("select")[0]?.[1] as { head?: boolean })?.head) return withCount(0);
      if (!call.used("range")) return ok([]);
      reads += 1;
      return reads === 1 ? fail("canceling statement due to statement timeout") : second.reply;
    });
    renderLibrary();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Resources could not be loaded. Try again in a moment.");
    expect(screen.getByRole("heading", { name: "Something interrupted the shelf" })).toBeInTheDocument();
    expect(screen.queryByText("Your resource shelf is empty")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Opening the library"));
    expect(screen.queryByText("Your resource shelf is empty")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { second.resolve(ok([res(5, "Syllabus.pdf")], { count: 1 })); });
    await rowButton("Syllabus.pdf");
    expect(screen.queryByRole("heading", { name: "Something interrupted the shelf" })).not.toBeInTheDocument();
  });
});

describe("the search is in the address (?q=)", () => {
  it("a link with ?q= opens the library already searching for it, and typing changes the address without adding a history entry", async () => {
    window.history.replaceState({}, "", "/?page=documents&q=bhairavi");
    scriptLibrary({ rows: [res(5, "Bhairavi notes.pdf")] });
    renderLibrary();
    await rowButton("Bhairavi notes.pdf");
    expect(screen.getByPlaceholderText(SEARCH)).toHaveValue("bhairavi");
    await waitFor(() => expect(listReads().some((call) => JSON.stringify(call.uses("or")).includes("bhairavi"))).toBe(true));
    const pushed = vi.spyOn(window.history, "pushState");
    const replaced = vi.spyOn(window.history, "replaceState");
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "yaman" } });
    await waitFor(() => expect(window.location.search).toContain("q=yaman"));
    expect(window.location.search).toContain("page=documents");
    expect(pushed).not.toHaveBeenCalled();
    expect(replaced).toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "" } });
    await waitFor(() => expect(window.location.search).not.toContain("q="));
    pushed.mockRestore();
    replaced.mockRestore();
  });

  it("the box follows the address when Back or a link changes it", async () => {
    window.history.replaceState({}, "", "/?page=documents");
    scriptLibrary({ rows: [] });
    renderLibrary();
    await screen.findByPlaceholderText(SEARCH);
    act(() => { window.history.pushState({}, "", "/?page=documents&q=tala"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => expect(screen.getByPlaceholderText(SEARCH)).toHaveValue("tala"));
    expect(await screen.findByRole("heading", { name: "No matching resources" })).toBeTruthy();
  });
});

describe("the open folder is in the address (?folder=)", () => {
  it("a folder that cannot be opened is taken out of the address without a history entry, so Back does not return to it", async () => {
    window.history.replaceState({}, "", "/?page=documents&folder=99");
    scriptLibrary({ rows: [], byId: {} });
    const pushed = vi.spyOn(window.history, "pushState");
    const replaced = vi.spyOn(window.history, "replaceState");
    const { notify } = renderLibrary();
    await waitFor(() => expect(notify.find("That folder could not be found")).toBeTruthy());
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    expect(pushed).not.toHaveBeenCalled();
    expect(replaced.mock.calls.some(([, , url]) => typeof url === "string" && !url.includes("folder="))).toBe(true);
    pushed.mockRestore();
    replaced.mockRestore();
  });

  it("opening a folder, and going up with the breadcrumb, each add a history entry", async () => {
    scriptLibrary({ rows: [folderRow(42, "Fall concert")], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    const pushed = vi.spyOn(window.history, "pushState");
    fireEvent.click(await rowButton("Fall concert"));
    await waitFor(() => expect(window.location.search).toContain("folder=42"));
    expect(pushed).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "Resources", current: false }));
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    expect(pushed).toHaveBeenCalledTimes(2);
    pushed.mockRestore();
  });

  it("the breadcrumb says where the person is", async () => {
    window.history.replaceState({}, "", "/?page=documents&folder=42");
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    const path = await screen.findByRole("group", { name: "Folder path" });
    await waitFor(() => expect(within(path).getByRole("button", { name: "Fall concert" })).toHaveAttribute("aria-current", "location"));
    expect(within(path).getByRole("button", { name: "Resources" })).not.toHaveAttribute("aria-current");
  });
});

describe("the toolbar", () => {
  it("the display toggle and the tabs say which one is on", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    const display = screen.getByRole("group", { name: "Display mode" });
    expect(within(display).getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
    expect(within(display).getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(display).getByRole("button", { name: "Grid view" }));
    expect(within(display).getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
    const tabs = screen.getByRole("navigation", { name: "Resource views" });
    expect(within(tabs).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(tabs).getByRole("button", { name: "Links" }));
    expect(within(tabs).getByRole("button", { name: /^Links/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(tabs).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Accessibility: axe on every screen, dialog and state of the library (colour contrast is not checked in jsdom)
// ---------------------------------------------------------------------------------------------------------------

const imageRow = (id: number, title: string) => res(id, title, { media_kind: "image", mime_type: "image/png" });
const axe = () => expectNoSeriousViolations(document.body);

describe("accessibility of the library", () => {
  it("the list (rows of every kind, a pinned one, a failed upload), in list view and in grid view", async () => {
    scriptLibrary({ rows: [folderRow(2, "Concerts"), res(5, "Syllabus.pdf", { is_pinned: true }), imageRow(6, "Poster.png"), linkRow(7, "Repertoire sheet"), res(8, "Broken.pdf", { status: "failed" })] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    await axe();
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await axe();
  });

  it("the empty shelf, the empty search, the skeleton and the failed read", async () => {
    const answer = deferred();
    fake.from("resources", "select").reply((call: Call) => ((call.uses("select")[0]?.[1] as { head?: boolean })?.head ? withCount(0) : call.used("range") ? answer.reply : ok([])));
    renderLibrary();
    await screen.findByRole("status");
    await axe();
    await act(async () => { answer.resolve(ok([], { count: 0 })); });
    await screen.findByText("Your resource shelf is empty");
    await axe();
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "zzz" } });
    await screen.findByRole("heading", { name: "No matching resources" });
    await axe();
  });

  it("the failed first read, with Try again", async () => {
    fake.from("resources", "select").reply((call: Call) => ((call.uses("select")[0]?.[1] as { head?: boolean })?.head ? withCount(0) : call.used("range") ? fail("canceling statement due to statement timeout") : ok([])));
    renderLibrary();
    await screen.findByRole("alert");
    await axe();
  });

  it("the add panel: the menu, the folder form, the link form and the two upload panels with their rows", async () => {
    const xhr = installFakeXhr();
    scriptLibrary();
    scriptUploads();
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    await axe();
    fireEvent.click(screen.getByRole("button", { name: /Create folder/ }));
    await axe();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await openForm(/Add link/);
    await axe();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await chooseFiles([fileAt("a.pdf"), fileAt("b.pdf")]);
    await axe();
    fireEvent.click(startButton());
    await waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2));
    act(() => xhr.requests[0].progress(300, 1000));
    await axe();
    await act(async () => { xhr.requests[0].respond(413, { message: "The object exceeded the maximum allowed size", statusCode: "413" }); });
    await act(async () => { xhr.requests[1].respond(200, { Id: "1", Key: "club-resources/b.pdf" }); });
    await screen.findByText("Failed: The object exceeded the maximum allowed size");
    await axe();
  });

  it("the details of a file, a folder and a link, for someone who manages them, and the dialogs they open", async () => {
    const xhr = installFakeXhr();
    void xhr;
    scriptLibrary({ rows: [res(5, "Syllabus.pdf"), folderRow(2, "Concerts"), linkRow(7, "Repertoire sheet")] });
    renderLibrary();
    fireEvent.click(await rowButton("Syllabus.pdf"));
    await screen.findByRole("dialog", { name: "Syllabus.pdf" });
    await axe();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("heading", { name: "Edit file" });
    await axe();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog", { name: "Delete this file?" });
    await axe();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close resource details" }));
    fireEvent.click(await rowButton("Repertoire sheet"));
    await screen.findByRole("dialog", { name: "Repertoire sheet" });
    await axe();
  });

  it("the preview of a PDF, of an image and of a file that can only be downloaded, and a preview that failed", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf"), imageRow(6, "Poster.png"), res(7, "Score.sib", { mime_type: "application/octet-stream" })] });
    renderLibrary({ role: "member" });
    const open = async (title: string) => {
      fireEvent.click(await rowButton(title));
      fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    };
    const closeBoth = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("link", { name: /Open in a new tab/ })).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Close resource details" }));
    };
    await open("Syllabus.pdf");
    await screen.findByTitle("Syllabus.pdf (PDF)");
    await axe();
    await closeBoth();
    await open("Poster.png");
    await screen.findByRole("link", { name: "Open in a new tab" });
    await axe();
    await closeBoth();
    await open("Score.sib");
    await screen.findByRole("link", { name: "Download Score.sib" });
    await axe();
    await closeBoth();
    fake.storage("club-resources", "createSignedUrl").replyOnce(fail("Object not found"));
    await open("Syllabus.pdf");
    await screen.findByRole("alert");
    await axe();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------------------------------------------

describe("the library with the keyboard only", () => {
  const tabTo = async (user: ReturnType<typeof keyboardUser>, matches: (name: string) => boolean, limit = 40) => {
    for (let step = 0; step < limit; step += 1) {
      await user.tab();
      if (matches(focusedName())) return;
    }
    throw new Error(`the focus never reached the control (last: ${focusedName()})`);
  };

  it("adds a folder: Tab to Add resource, Enter, choose Create folder, type, Enter; the focus comes back to Add resource", async () => {
    scriptLibrary();
    fake.from("resources", "insert").reply(ok(folderRow(50, "Concerts")));
    const { notify } = renderLibrary();
    await screen.findByRole("button", { name: "Add resource" });
    const user = keyboardUser();
    await tabTo(user, (name) => name.includes("Add resource"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Close add resource" })).toHaveFocus());
    await tabTo(user, (name) => name.startsWith("Create folder"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Folder name")).toHaveFocus());
    await user.keyboard("Concerts{Enter}");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add resource" })).toHaveFocus();
    expect(fake.from("resources", "insert").calls[0].payload).toMatchObject({ title: "Concerts", node_kind: "folder" });
  });

  it("opens a file: Enter on its row, Enter on Open file, Escape closes the preview and then the details, and the focus returns step by step", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary({ role: "member" });
    await rowButton("Syllabus.pdf");
    const user = keyboardUser();
    await tabTo(user, (name) => name.startsWith("Syllabus.pdf"));
    const row = document.activeElement as HTMLElement;
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Syllabus.pdf" });
    await tabTo(user, (name) => name.includes("Open file"));
    await user.keyboard("{Enter}");
    await screen.findByTitle("Syllabus.pdf (PDF)");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTitle("Syllabus.pdf (PDF)")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open file" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
  });
});
