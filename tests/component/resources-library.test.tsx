// The resource library, run for real against the fake client.
//
// Replaces the library parts of tests/resource-links.test.mjs and the resources test of tests/refresh-wiring.test.mjs
// (both read app/resources.tsx as text). What each old assertion protected, and where it is checked now:
//
//  resource-links "resources UI is integrated as the single library ...":
//    the library is a screen of the shell (dynamic import, section "documents"), the old ?page=gallery link opens it, the
//    retired resource_links table is never read, the archive is read as recordings only, a group's "Open resources"
//    opens it for that group, the club-recording form has no document or photo kinds
//      -> tests/component/shell-sections.test.tsx (they are about the shell around the library).
//    folder upload keeps the folder structure: relative path segments become folders with parent_id, the import row is
//    created before any resource row, each file row points at its storage path, three files upload at a time
//      -> "uploading a folder" group.
//  resource-links "the library loads one folder at a time and keeps every action working inside that model":
//    no whole-tree read; pages of RESOURCE_PAGE_SIZE with Show more; the search waits 250 ms; the open folder lives in the
//    address bar; thumbnails are signed per bucket for the images on screen only; actions refresh through afterChange;
//    a folder's child count is asked on its own
//      -> "what the library asks the server for", "folders and the address bar", "thumbnails", "managing the selected
//         item", "a folder's child count" groups.
//    (`<ResourceActions key={selectedCurrent.id}>`: the key keeps one item's open dialog from leaking to the next, but the
//     panel covers the list, so no click path shows two items in one panel; behaviour cannot tell it from its absence.
//     Dropped on purpose.)
//  refresh-wiring "the resource library keeps the rows of the same list when a refresh fails and shows a banner over them":
//    -> "a refresh that fails" group (same list keeps its rows and shows the banner; another list does not; the count
//       for the dashboard is only reported from a successful head count; no unbounded read).
//
// The schema pins of resource-links (first test) and unified-resources-schema (all four) are database facts. They are not
// checked here: see the report for which supabase/tests/*.test.sql assertions cover each of them.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResourceLibrary } from "../../features/resources/components/resource-library";
import { setCacheOwner } from "../../lib/cache";
import type { GroupRole, MembershipStatus } from "../../lib/db";
import { RESOURCE_PAGE_SIZE, THUMBNAIL_TTL_SECONDS } from "../../lib/resources-query";
import { advance, notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, withCount, type Call } from "../support/fake-supabase";

// ---------------------------------------------------------------------------------------------------------------
// Data and scripting
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
const imageRow = (id: number, title: string, over: Record<string, unknown> = {}) =>
  res(id, title, { media_kind: "image", mime_type: "image/png", ...over });

type World = {
  rows: Row[];
  /** Rows the one-row reads (breadcrumb, refresh of the selected item) answer with, by id. */
  byId: Record<number, Row | null>;
  total?: number;
  archivedCount: number;
  liveCount: number | null;
  liveError: boolean;
  listError: boolean;
  /** What the child-count read of a folder answers: a number, or a deferred answer. */
  childCount: number | ReturnType<typeof deferred>;
  /** What every page after the first answers with. */
  nextRows: Row[];
};
function scriptLibrary(over: Partial<World> = {}): World {
  const world: World = { rows: [], byId: {}, archivedCount: 0, liveCount: 0, liveError: false, listError: false, childCount: 0, nextRows: [], ...over };
  fake.from("resources", "select").reply((call: Call) => {
    const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean; count?: string };
    if (options.head) {
      if (call.used("eq", "status", "archived")) return withCount(world.archivedCount);
      if (call.used("neq", "status", "archived")) return world.liveError ? fail("boom") : world.liveCount === null ? ok(null) : withCount(world.liveCount);
      const count = world.childCount;
      return typeof count === "number" ? withCount(count) : count.reply;
    }
    if (call.used("maybeSingle")) {
      const id = call.uses("eq").find(([column]) => column === "id")?.[1] as number;
      return ok(world.byId[id] ?? null);
    }
    if (call.used("in", "id") || call.used("eq", "node_kind", "folder")) return ok([]);
    if (world.listError) return fail("canceling statement due to statement timeout");
    if (((call.uses("range")[0]?.[0] as number) ?? 0) > 0) return ok(world.nextRows);
    return ok(world.rows, { count: world.total ?? world.rows.length });
  });
  return world;
}

type Options = { role?: "member" | "executive" | "admin"; userId?: string; groups?: Array<{ id: number; name: string }>; memberships?: Array<{ subgroup_id: number; status: MembershipStatus; membership_role: GroupRole }>; scope?: "all" | "club" | number };
function renderLibrary(options: Options = {}) {
  const notify = notifySpy();
  const onResourceCountChange = vi.fn();
  const userId = options.userId ?? "u-me";
  // The shell makes the signed-in account the cache owner before a screen mounts.
  setCacheOwner(userId);
  const view = render(<ResourceLibrary user={userOf(userId)} role={options.role ?? "executive"} groups={options.groups ?? []} memberships={options.memberships ?? []} events={[]} notify={notify} onResourceCountChange={onResourceCountChange} initialScope={options.scope ?? "all"} />);
  return { notify, onResourceCountChange, ...view };
}
const listReads = () => fake.from("resources", "select").calls.filter((call) => call.used("range"));
const rowButton = (title: string | RegExp) => screen.findByRole("button", { name: typeof title === "string" ? new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : title });
const SEARCH = "Search title, filename, or description";
const openFolderUrl = (id: number) => window.history.replaceState({}, "", `/?page=documents&folder=${id}`);

// ---------------------------------------------------------------------------------------------------------------
// What the library asks the server for
// ---------------------------------------------------------------------------------------------------------------

describe("what the library asks the server for", () => {
  it("one level at a time: the top level, not archived, pinned then newest first, one page of rows with an exact count", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    const first = listReads()[0];
    expect(first.used("is", "parent_id", null)).toBe(true);
    expect(first.used("neq", "status", "archived")).toBe(true);
    expect(first.uses("order")).toEqual([["is_pinned", { ascending: false }], ["updated_at", { ascending: false }], ["id", { ascending: false }]]);
    expect(first.used("range", 0, RESOURCE_PAGE_SIZE - 1)).toBe(true);
    expect((first.uses("select")[0][1] as { count: string }).count).toBe("exact");
  });

  it("the whole tree is never read in one query: every read of the library is a page, a count or a single row", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf"), folderRow(2, "Concerts")], byId: { 2: folderRow(2, "Concerts") } });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    fireEvent.click(await rowButton("Concerts"));
    await waitFor(() => expect(listReads().length).toBeGreaterThanOrEqual(2));
    for (const call of fake.from("resources", "select").calls) {
      const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
      expect(call.used("range") || options.head || call.used("maybeSingle") || call.used("in") || call.used("eq", "node_kind", "folder")).toBe(true);
    }
  });

  it("a full page offers Show more, which reads the next page without asking for the count again and appends it", async () => {
    const page1 = Array.from({ length: RESOURCE_PAGE_SIZE }, (_, i) => res(i + 1, `Item ${i + 1}`));
    const page2 = Array.from({ length: 30 }, (_, i) => res(RESOURCE_PAGE_SIZE + i + 1, `Item ${RESOURCE_PAGE_SIZE + i + 1}`));
    scriptLibrary({ rows: page1, total: RESOURCE_PAGE_SIZE + 30, nextRows: page2 });
    renderLibrary();
    await rowButton(/^Item 1 /);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await rowButton(new RegExp(`^Item ${RESOURCE_PAGE_SIZE + 30} `));
    const second = listReads().find((call) => call.used("range", RESOURCE_PAGE_SIZE, RESOURCE_PAGE_SIZE * 2 - 1))!;
    expect(second).toBeTruthy();
    expect((second.uses("select")[0][1] as { count?: string }).count).toBeUndefined();
    expect(screen.getByRole("button", { name: /^Item 1 / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("a page that is not full has no Show more", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("a search waits 250 ms after the last key, then looks for it", async () => {
    vi.useFakeTimers();
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary();
    await advance(1);
    expect(listReads()).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "tab" } });
    await advance(200);
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "tabla" } });
    await advance(200);
    expect(listReads()).toHaveLength(1);
    await advance(60);
    await advance(1);
    expect(listReads()).toHaveLength(2);
    expect(JSON.stringify(listReads()[1].uses("or"))).toContain("tabla");
  });

  it("Clear search empties the box and lists everything again at once, without the 250 ms wait", async () => {
    vi.useFakeTimers();
    scriptLibrary({ rows: [] });
    renderLibrary();
    await advance(1);
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "zzz" } });
    await advance(260);
    await advance(1);
    expect(listReads()).toHaveLength(2);
    expect(JSON.stringify(listReads()[1].uses("or"))).toContain("zzz");
    expect(screen.getByRole("heading", { name: "No matching resources" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await advance(1);
    expect(screen.getByPlaceholderText(SEARCH)).toHaveValue("");
    expect(listReads()).toHaveLength(3);
    expect(listReads()[2].uses("or")).toEqual([]);
    await advance(500);
    expect(listReads()).toHaveLength(3);
  });

  it("choosing a group scopes the list to it", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary({ groups: [{ id: 7, name: "Hindustani Vocal" }] });
    await rowButton("Syllabus.pdf");
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "7" } });
    await waitFor(() => expect(listReads().length).toBeGreaterThanOrEqual(2));
    expect(listReads()[listReads().length - 1].used("eq", "subgroup_id", 7)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Folders and the address bar
// ---------------------------------------------------------------------------------------------------------------

describe("folders and the address bar", () => {
  it("opens the folder named in the address bar: its own rows and a breadcrumb", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [res(5, "Setlist.pdf", { parent_id: 42 })], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    await rowButton("Setlist.pdf");
    expect(listReads()[0].used("eq", "parent_id", 42)).toBe(true);
    expect(await screen.findByRole("button", { name: "Fall concert" })).toBeInTheDocument();
    const crumbRead = fake.from("resources", "select").calls.find((call) => call.used("maybeSingle"))!;
    expect(crumbRead.used("eq", "id", 42)).toBe(true);
  });

  it("opening a folder puts it in the address bar, and back returns to the level above", async () => {
    scriptLibrary({ rows: [folderRow(42, "Fall concert")], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    fireEvent.click(await rowButton("Fall concert"));
    await waitFor(() => expect(window.location.search).toContain("folder=42"));
    expect(window.location.search).toContain("page=documents");
    await waitFor(() => expect(listReads().some((call) => call.used("eq", "parent_id", 42))).toBe(true));
    // The browser's back button.
    window.history.back();
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    await waitFor(() => expect(listReads()[listReads().length - 1].used("is", "parent_id", null)).toBe(true));
  });

  it("a folder that does not exist says so and goes back to the top", async () => {
    openFolderUrl(99);
    scriptLibrary({ rows: [], byId: {} });
    const { notify } = renderLibrary();
    await waitFor(() => expect(notify.find("That folder could not be found")).toBeTruthy());
    expect(notify.find("That folder could not be found").tone).toBeUndefined();
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
  });

  it("a nonsense value in the address bar is ignored", async () => {
    window.history.replaceState({}, "", "/?page=documents&folder=abc");
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    expect(listReads()[0].used("is", "parent_id", null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------------------------------------------

describe("thumbnails", () => {
  it("only the images on screen are signed, one request per bucket, for the stated time; the pictures use the signed links", async () => {
    scriptLibrary({
      rows: [imageRow(1, "a.png"), imageRow(2, "b.png"), imageRow(3, "c.png", { storage_bucket: "club-archive", storage_path: "u-1/c.png" }), res(4, "notes.pdf")],
    });
    renderLibrary();
    await rowButton("notes.pdf");
    const signed = fake.storage("*", "createSignedUrls").calls;
    expect(signed).toHaveLength(2);
    const byBucket = Object.fromEntries(signed.map((call) => [call.target, call.args]));
    expect(byBucket["club-resources"]).toEqual([["u-1/1-a.png", "u-1/2-b.png"], THUMBNAIL_TTL_SECONDS]);
    expect(byBucket["club-archive"]).toEqual([["u-1/c.png"], THUMBNAIL_TTL_SECONDS]);
    await waitFor(() => expect(document.querySelectorAll("img[src*='files.test']")).toHaveLength(3));
  });

  it("a page with no images signs nothing", async () => {
    scriptLibrary({ rows: [res(1, "notes.pdf")] });
    renderLibrary();
    await rowButton("notes.pdf");
    expect(fake.storage("*", "createSignedUrls").count).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Managing the selected item
// ---------------------------------------------------------------------------------------------------------------

describe("managing the selected item", () => {
  it("after a change the lists and the open item are read again, so what is shown is what is saved", async () => {
    const world = scriptLibrary({ rows: [res(5, "Syllabus.pdf")], byId: { 5: res(5, "Syllabus.pdf") } });
    fake.from("resources", "update").reply(ok([{ id: 5 }]));
    renderLibrary();
    fireEvent.click(await rowButton("Syllabus.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("heading", { name: "Edit file" }).closest('[role="dialog"]')!.querySelector("form")!;
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Syllabus v2" } });
    // What the database now holds. The list no longer shows the item (it was filtered out or moved), so only a read of
    // the item itself can show its new name in the open panel.
    world.rows = []; world.byId = { 5: res(5, "Syllabus v2") };
    const readsBefore = listReads().length;
    fireEvent.submit(form);
    expect(await screen.findByRole("heading", { name: "Syllabus v2" })).toBeInTheDocument();
    expect(fake.from("resources", "update").calls[0].payload).toMatchObject({ title: "Syllabus v2" });
    await waitFor(() => expect(listReads().length).toBeGreaterThan(readsBefore));
  });

  it("archiving the open item closes it and reads the list again", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    fake.rpc("set_resource_archived").reply(ok(null));
    renderLibrary();
    fireEvent.click(await rowButton("Syllabus.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const readsBefore = listReads().length;
    fireEvent.click(within(screen.getAllByRole("dialog")[1]).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(fake.rpc("set_resource_archived").count).toBe(1));
    expect(fake.rpc("set_resource_archived").calls[0].payload).toEqual({ p_resource_id: 5, p_archived: true });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Syllabus.pdf" })).not.toBeInTheDocument());
    await waitFor(() => expect(listReads().length).toBeGreaterThan(readsBefore));
  });

  it("a member who does not manage the item sees its details and no controls", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary({ role: "member" });
    fireEvent.click(await rowButton("Syllabus.pdf"));
    expect(await screen.findByRole("heading", { name: "Syllabus.pdf" })).toBeInTheDocument();
    expect(screen.queryByText("Manage this file")).not.toBeInTheDocument();
  });

  it("a group's leader manages that group's member-visible items, and nothing else", async () => {
    scriptLibrary({ rows: [res(5, "Group notes.pdf", { subgroup_id: 7 }), res(6, "Club notes.pdf", { subgroup_id: null })] });
    renderLibrary({ role: "member", groups: [{ id: 7, name: "Hindustani Vocal" }], memberships: [{ subgroup_id: 7, status: "active", membership_role: "leader" }] });
    fireEvent.click(await rowButton("Group notes.pdf"));
    expect(await screen.findByText("Manage this file")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close resource details" }));
    fireEvent.click(await rowButton("Club notes.pdf"));
    await screen.findByRole("heading", { name: "Club notes.pdf" });
    expect(screen.queryByText("Manage this file")).not.toBeInTheDocument();
  });

  it("opening a file opens the tab first, then signs the file for five minutes from its bucket, and shows it there", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    const tab = { opener: "x" as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(tab as unknown as Window);
    renderLibrary({ role: "member" });
    fireEvent.click(await rowButton("Syllabus.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledTimes(1));
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(tab.opener).toBeNull();
    expect(fake.storage("club-resources", "createSignedUrl").calls[0].args).toEqual(["u-1/5-Syllabus.pdf", 300]);
    expect(tab.location.replace).toHaveBeenCalledWith(expect.stringContaining("files.test"));
  });

  it("a file that cannot be signed closes the empty tab and says so", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    fake.storage("club-resources", "createSignedUrl").reply(fail("Object not found"));
    const tab = { opener: "x" as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(tab as unknown as Window);
    const { notify } = renderLibrary({ role: "member" });
    fireEvent.click(await rowButton("Syllabus.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(notify.find("This resource could not be opened")).toBeTruthy();
  });

  it("a link opens its address in a new tab without handing over the opener, and signs nothing", async () => {
    scriptLibrary({ rows: [res(5, "Repertoire sheet", { node_kind: "link", media_kind: null, storage_bucket: null, storage_path: null, external_url: "https://docs.example.org/rep" })] });
    renderLibrary({ role: "member" });
    fireEvent.click(await rowButton("Repertoire sheet"));
    fireEvent.click(await screen.findByRole("button", { name: "Open link" }));
    expect(window.open).toHaveBeenCalledWith("https://docs.example.org/rep", "_blank", "noopener,noreferrer");
    expect(fake.storage("*", "createSignedUrl").count).toBe(0);
  });
});

describe("a folder's child count", () => {
  async function openFolderSettings(world: World) {
    openFolderUrl(42);
    world.byId = { 42: folderRow(42, "Fall concert") };
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Folder settings" }));
    await screen.findByText("Manage this folder");
  }

  it("is asked on its own, as a head count of the folder's children", async () => {
    const world = scriptLibrary({ rows: [], childCount: 3 });
    await openFolderSettings(world);
    await waitFor(() => expect(fake.from("resources", "select").calls.some((call) => call.used("eq", "parent_id", 42) && (call.uses("select")[0][1] as { head?: boolean })?.head === true)).toBe(true));
  });

  it("a folder with something in it cannot be deleted; an empty one can", async () => {
    const world = scriptLibrary({ rows: [], childCount: 3 });
    await openFolderSettings(world);
    await waitFor(() => expect(screen.getByText(/Only empty folders can be deleted/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("an empty folder offers Delete once the count has arrived, and not before", async () => {
    const answer = deferred();
    const world = scriptLibrary({ rows: [], childCount: answer });
    await openFolderSettings(world);
    // Until the count is known the folder is treated as not empty.
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await act(async () => { answer.resolve(withCount(0)); });
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A refresh that fails
// ---------------------------------------------------------------------------------------------------------------

async function createFolderNamed(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
  fireEvent.click(screen.getByRole("button", { name: /Create folder/ }));
  fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: name } });
  fireEvent.submit(screen.getByLabelText("Folder name").closest("form")!);
}

describe("a refresh that fails", () => {
  it("keeps the rows of the same list and shows a banner over them; Try again reads it again", async () => {
    const world = scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    fake.from("resources", "insert").reply(ok(folderRow(2, "New shelf")));
    const { notify } = renderLibrary();
    await rowButton("Syllabus.pdf");
    // The folder is created, then the list is read again; that read fails.
    world.listError = true;
    await createFolderNamed("New shelf");
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Resources could not be loaded. Try again in a moment. What is shown may be out of date.");
    expect(screen.getByRole("button", { name: /Syllabus\.pdf/ })).toBeInTheDocument();
    expect(notify.find("The resource library could not be loaded")).toBeTruthy();
    world.listError = false;
    fireEvent.click(within(banner).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Syllabus\.pdf/ })).toBeInTheDocument();
  });

  it("does not keep the rows of a different list: another scope that fails shows the error, not the old rows", async () => {
    const world = scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    renderLibrary({ groups: [{ id: 7, name: "Hindustani Vocal" }] });
    await rowButton("Syllabus.pdf");
    world.listError = true;
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "7" } });
    expect(await screen.findByText("Something interrupted the shelf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Syllabus\.pdf/ })).not.toBeInTheDocument();
  });

  it("a first load that fails shows the error with Try again", async () => {
    const world = scriptLibrary({ rows: [res(1, "Syllabus.pdf")], listError: true });
    renderLibrary();
    expect(await screen.findByText("Something interrupted the shelf")).toBeInTheDocument();
    world.listError = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await rowButton("Syllabus.pdf");
  });
});

describe("the count the dashboard shows", () => {
  it("is the number of live items, reported once it has been read", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")], liveCount: 12 });
    const { onResourceCountChange } = renderLibrary();
    await waitFor(() => expect(onResourceCountChange).toHaveBeenCalledWith(12));
    const head = fake.from("resources", "select").calls.find((call) => call.used("neq", "status", "archived") && (call.uses("select")[0][1] as { head?: boolean })?.head);
    expect(head).toBeTruthy();
  });

  it("is not reported when the count could not be read (the dashboard keeps its own)", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")], liveError: true });
    const { onResourceCountChange } = renderLibrary();
    await rowButton("Syllabus.pdf");
    await waitFor(() => expect(fake.from("resources", "select").calls.filter((call) => call.used("neq", "status", "archived") && (call.uses("select")[0][1] as { head?: boolean })?.head)).toHaveLength(1));
    expect(onResourceCountChange).not.toHaveBeenCalled();
  });

  it("is not reported from the rows on screen, nor when the server sends no count", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf"), res(2, "Other.pdf")], liveCount: null });
    const { onResourceCountChange } = renderLibrary();
    await rowButton("Other.pdf");
    await waitFor(() => expect(fake.from("resources", "select").calls.filter((call) => call.used("neq", "status", "archived") && (call.uses("select")[0][1] as { head?: boolean })?.head)).toHaveLength(1));
    expect(onResourceCountChange).not.toHaveBeenCalled();
  });

  it("Show archived appears only when something is archived", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")], archivedCount: 0 });
    const first = renderLibrary();
    await rowButton("Syllabus.pdf");
    expect(screen.queryByRole("button", { name: "Show archived" })).not.toBeInTheDocument();
    first.unmount();
    fake.reset();
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")], archivedCount: 2 });
    renderLibrary({ userId: "u-other" });
    expect(await screen.findByRole("button", { name: "Show archived" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adding folders and links
// ---------------------------------------------------------------------------------------------------------------

describe("adding a folder or a link", () => {
  it("a folder is created in the open place with the visibility the person chose", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert", { subgroup_id: 7, visibility: "members" }) } });
    fake.from("resources", "insert").reply(ok(folderRow(50, "Programme")));
    const { notify } = renderLibrary({ groups: [{ id: 7, name: "Hindustani Vocal" }] });
    await screen.findByRole("button", { name: "Fall concert" });
    await createFolderNamed("  Programme  ");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    expect(fake.from("resources", "insert").calls[0].payload).toMatchObject({ node_kind: "folder", title: "Programme", parent_id: 42, subgroup_id: 7, visibility: "members", status: "ready", created_by: "u-me" });
  });

  it("a folder with no name is refused in the form", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary();
    await createFolderNamed("   ");
    expect(await screen.findByRole("alert")).toHaveTextContent("Give this folder a clear name.");
    expect(fake.from("resources", "insert").count).toBe(0);
  });

  it("a refused folder shows the database's sentence in the form and stays open", async () => {
    scriptLibrary({ rows: [] });
    fake.from("resources", "insert").reply(fail("resource hierarchy cannot exceed three folder levels"));
    renderLibrary();
    await createFolderNamed("Deep");
    expect(await screen.findByRole("alert")).toHaveTextContent("resource hierarchy cannot exceed three folder levels");
    expect(screen.getByLabelText("Folder name")).toBeInTheDocument();
  });

  it("a link without a scheme gets https, and is saved trimmed", async () => {
    scriptLibrary({ rows: [] });
    fake.from("resources", "insert").reply(ok(res(60, "Repertoire", { node_kind: "link" })));
    const { notify } = renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    fireEvent.click(screen.getByRole("button", { name: /Add link/ }));
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: " Repertoire " } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "docs.google.com/document/d/abc" } });
    fireEvent.submit(screen.getByLabelText("Link title").closest("form")!);
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    expect(fake.from("resources", "insert").calls[0].payload).toMatchObject({ node_kind: "link", title: "Repertoire", external_url: "https://docs.google.com/document/d/abc", parent_id: null });
  });

  it("an address that is not an address is refused in the form", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    fireEvent.click(screen.getByRole("button", { name: /Add link/ }));
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Broken" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "http://" } });
    fireEvent.submit(screen.getByLabelText("Link title").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a complete web address");
    expect(fake.from("resources", "insert").count).toBe(0);
  });

  it("an ordinary member cannot add; a group's leader can add to that group's space", async () => {
    scriptLibrary({ rows: [] });
    const member = renderLibrary({ role: "member", groups: [{ id: 7, name: "Hindustani Vocal" }], memberships: [{ subgroup_id: 7, status: "active", membership_role: "member" }] });
    expect(await screen.findByRole("button", { name: "Add resource" })).toBeDisabled();
    member.unmount();
    fake.reset();
    scriptLibrary({ rows: [] });
    renderLibrary({ role: "member", userId: "u-lead", scope: 7, groups: [{ id: 7, name: "Hindustani Vocal" }], memberships: [{ subgroup_id: 7, status: "active", membership_role: "leader" }] });
    expect(await screen.findByRole("button", { name: "Add resource" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Uploading files and folders
// ---------------------------------------------------------------------------------------------------------------

function fileAt(path: string, size = 10, type = "application/pdf") {
  const name = path.split("/").pop()!;
  const file = new File(["x".repeat(size)], name, { type });
  Object.defineProperty(file, "webkitRelativePath", { value: path.includes("/") ? path : "" });
  return file;
}
async function chooseFiles(menuEntry: RegExp, files: File[]) {
  fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
  fireEvent.click(screen.getByRole("button", { name: menuEntry }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  return input;
}
function scriptUploads() {
  let nextId = 100;
  fake.from("resources", "insert").reply((call) => ok({ ...(call.payload as object), id: ++nextId, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }));
  fake.from("resources", "update").reply((call) => ok({ id: call.uses("eq")[0][1], status: (call.payload as { status: string }).status }));
  fake.from("resource_imports", "insert").reply(ok({ id: "imp-1" }));
  fake.from("resource_imports", "update").reply(ok(null));
}
const startUpload = () => fireEvent.click(screen.getByRole("button", { name: "Start upload" }));

describe("uploading a folder", () => {
  const SELECTION = () => [fileAt("Concert/Notes/a.pdf"), fileAt("Concert/b.pdf"), fileAt("Concert/Notes/c.pdf")];

  it("the picker takes a whole folder", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    renderLibrary();
    const input = await chooseFiles(/Upload folder/, SELECTION());
    expect(input).toHaveAttribute("webkitdirectory");
    expect(screen.getByText("Concert/Notes/a.pdf")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 complete")).toBeInTheDocument();
  });

  it("keeps the structure: the batch is recorded first, each folder is created once under its parent, each file points at its storage path", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles(/Upload folder/, SELECTION());
    startUpload();
    await waitFor(() => expect(notify.find("3 files uploaded")).toBeTruthy());

    const batch = fake.from("resource_imports", "insert").calls[0];
    expect(batch.payload).toMatchObject({ name: "3 uploaded resources", root_parent_id: null, status: "uploading", total_files: 3, created_by: "u-me" });
    const inserts = fake.from("resources", "insert").calls;
    // The batch exists before any resource row does.
    expect(batch.seq).toBeLessThan(inserts[0].seq);

    const folders = inserts.filter((call) => (call.payload as { node_kind: string }).node_kind === "folder");
    expect(folders.map((call) => (call.payload as { title: string }).title)).toEqual(["Concert", "Notes"]);
    const concertRow = folders[0].payload as { parent_id: number | null; import_id: string };
    expect(concertRow.parent_id).toBeNull();
    expect(concertRow.import_id).toBe("imp-1");
    // "Notes" is a child of the id the database gave "Concert".
    expect((folders[1].payload as { parent_id: number }).parent_id).toBe(101);

    const files = inserts.filter((call) => (call.payload as { node_kind: string }).node_kind === "file").map((call) => call.payload as Record<string, unknown>);
    expect(files).toHaveLength(3);
    const a = files.find((file) => file.title === "a.pdf")!;
    expect(a).toMatchObject({ status: "pending_upload", storage_bucket: "club-resources", storage_path: "u-me/imp-1/Concert/Notes/a.pdf", parent_id: 102, import_id: "imp-1", media_kind: "document" });
    expect(files.find((file) => file.title === "b.pdf")).toMatchObject({ storage_path: "u-me/imp-1/Concert/b.pdf", parent_id: 101 });

    // The file goes to storage at that path, then the row is marked ready; the batch is closed as completed.
    const uploads = fake.storage("club-resources", "upload").calls.map((call) => call.args[0]).sort();
    expect(uploads).toEqual(["u-me/imp-1/Concert/Notes/a.pdf", "u-me/imp-1/Concert/Notes/c.pdf", "u-me/imp-1/Concert/b.pdf"]);
    const ready = fake.from("resources", "update").calls.filter((call) => (call.payload as { status: string }).status === "ready");
    expect(ready).toHaveLength(3);
    expect(fake.from("resource_imports", "update").calls[0].payload).toMatchObject({ status: "completed", completed_files: 3, failed_files: 0 });
  });

  it("uploads three files at a time", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const gates: Array<ReturnType<typeof deferred>> = [];
    fake.storage("club-resources", "upload").reply(() => { const gate = deferred(); gates.push(gate); return gate.reply; });
    renderLibrary();
    await chooseFiles(/Upload files/, ["1", "2", "3", "4", "5"].map((n) => fileAt(`f${n}.pdf`)));
    startUpload();
    await waitFor(() => expect(gates).toHaveLength(3));
    // Give a fourth upload every chance to start; it must not.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fake.storage("club-resources", "upload").count).toBe(3);
    await act(async () => { gates[0].resolve(ok({ path: "x" })); });
    await waitFor(() => expect(gates).toHaveLength(4));
    await act(async () => { gates[1].resolve(ok({ path: "x" })); gates[2].resolve(ok({ path: "x" })); });
    await waitFor(() => expect(gates).toHaveLength(5));
    expect(fake.storage("club-resources", "upload").count).toBe(5);
    await act(async () => { gates[3].resolve(ok({ path: "x" })); gates[4].resolve(ok({ path: "x" })); });
  });

  it("refuses a selection that would be more than three folder levels deep, before anything is created", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    renderLibrary();
    await chooseFiles(/Upload folder/, [fileAt("a/b/c/d/deep.pdf")]);
    startUpload();
    expect(await screen.findByRole("alert")).toHaveTextContent("This selection would create more than three folder levels (destination is already 0 levels deep).");
    expect(fake.from("resource_imports", "insert").count).toBe(0);
    expect(fake.from("resources", "insert").count).toBe(0);
  });

  it("three levels are allowed", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles(/Upload folder/, [fileAt("a/b/c/ok.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded")).toBeTruthy());
    expect(fake.from("resources", "insert").calls.filter((call) => (call.payload as { node_kind: string }).node_kind === "folder")).toHaveLength(3);
  });

  it("a file that cannot be uploaded is marked failed, the batch is closed as partial, and the person is told how many failed", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.storage("club-resources", "upload").reply((call) => (String(call.args[0]).endsWith("bad.pdf") ? fail("The object exceeded the maximum allowed size") : ok({ path: String(call.args[0]) })));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("good.pdf"), fileAt("bad.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded; 1 failed").tone).toBe("error"));
    const failedRows = fake.from("resources", "update").calls.filter((call) => (call.payload as { status: string }).status === "failed");
    expect(failedRows).toHaveLength(1);
    expect(fake.from("resource_imports", "update").calls[0].payload).toMatchObject({ status: "partial", completed_files: 1, failed_files: 1 });
    expect(screen.getByText("The object exceeded the maximum allowed size")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 file failed.");
    expect(screen.getByRole("button", { name: "Reset failed" })).toBeInTheDocument();
  });

  it("when every file fails the batch is closed as failed", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.storage("club-resources", "upload").reply(fail("Bucket not found"));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("0 files uploaded; 1 failed").tone).toBe("error"));
    expect(fake.from("resource_imports", "update").calls[0].payload).toMatchObject({ status: "failed" });
  });

  it("a batch that cannot be recorded stops the upload before any file or folder is created", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.from("resource_imports", "insert").reply(fail("You do not have permission to add resources here"));
    renderLibrary();
    await chooseFiles(/Upload folder/, SELECTION());
    startUpload();
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to add resources here");
    expect(fake.from("resources", "insert").count).toBe(0);
    expect(fake.storage("*", "upload").count).toBe(0);
  });

  it("files chosen one by one keep their own names (no folders are made)", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("Loose notes.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded")).toBeTruthy());
    expect(fake.from("resources", "insert").calls.map((call) => (call.payload as { node_kind: string }).node_kind)).toEqual(["file"]);
    expect(fake.storage("club-resources", "upload").calls[0].args[0]).toBe("u-me/imp-1/Loose-notes.pdf");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// What happens when a step of an upload, a read or a count fails (added with the move of the library's Supabase calls to
// lib/api/resources.ts and the split of the screen into hooks and components; each case was first run against the code
// that called Supabase directly)
// ---------------------------------------------------------------------------------------------------------------

describe("when a step of an upload fails", () => {
  const insertOf = (kind: string) => (call: Call) => (call.payload as { node_kind: string }).node_kind === kind;

  it("a file whose row cannot be created is listed as failed with a general sentence, and nothing is sent to storage", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    // A database answer is not shown to the person here, only that the upload failed.
    fake.from("resources", "insert").reply(fail("permission denied for table resources", "42501"));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("0 files uploaded; 1 failed").tone).toBe("error"));
    expect(screen.getByText("Upload failed", { selector: "small" })).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(fake.storage("*", "upload").count).toBe(0);
    expect(fake.from("resource_imports", "update").calls[0].payload).toMatchObject({ status: "failed", completed_files: 0, failed_files: 1 });
  });

  it("a row that cannot be marked ready after its file went up is marked failed, and the list says so", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.from("resources", "update").reply((call) => ((call.payload as { status: string }).status === "ready" ? fail("could not serialize access") : ok({ id: call.uses("eq")[0][1], status: "failed" })));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("0 files uploaded; 1 failed").tone).toBe("error"));
    expect(fake.storage("club-resources", "upload").count).toBe(1);
    const writes = fake.from("resources", "update").calls.map((call) => (call.payload as { status: string }).status);
    expect(writes).toEqual(["ready", "failed"]);
    expect(screen.getByText("Upload failed", { selector: "small" })).toBeInTheDocument();
  });

  it("the row is created first, then the file is sent, then a failed upload marks the row failed, in that order", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.storage("club-resources", "upload").reply(fail("Bucket not found"));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("0 files uploaded; 1 failed")).toBeTruthy());
    const [row] = fake.from("resources", "insert").calls;
    const [sent] = fake.storage("club-resources", "upload").calls;
    const [mark] = fake.from("resources", "update").calls;
    expect(row.seq).toBeLessThan(sent.seq);
    expect(sent.seq).toBeLessThan(mark.seq);
    expect(mark.payload).toEqual({ status: "failed" });
    // A storage sentence is shown as it is.
    expect(screen.getByText("Bucket not found", { selector: "small" })).toBeInTheDocument();
  });

  it("a failure to mark the row failed changes nothing the person is told: the upload's own failure is shown", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.storage("club-resources", "upload").reply(fail("Bucket not found"));
    fake.from("resources", "update").reply(fail("connection reset"));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("0 files uploaded; 1 failed")).toBeTruthy());
    expect(screen.getByText("Bucket not found", { selector: "small" })).toBeInTheDocument();
  });

  it("a folder of the selection that cannot be created stops the batch before any file, closes it as failed and says so", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.from("resources", "insert").reply((call) => (insertOf("folder")(call) ? fail("resource hierarchy cannot exceed three folder levels", "P0001") : ok({})));
    renderLibrary();
    await chooseFiles(/Upload folder/, [fileAt("Concert/a.pdf"), fileAt("Concert/b.pdf")]);
    startUpload();
    expect(await screen.findByRole("alert")).toHaveTextContent("The folder structure could not be created.");
    expect(fake.storage("*", "upload").count).toBe(0);
    expect(fake.from("resources", "insert").calls.filter(insertOf("file"))).toHaveLength(0);
    expect(fake.from("resource_imports", "update").calls[0].payload).toEqual({ status: "failed", failed_files: 2 });
    // The person can try again.
    expect(screen.getByRole("button", { name: "Start upload" })).toBeEnabled();
  });

  it("Reset failed queues only the failed files again and uploads them as a new batch", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    let attempts = 0;
    fake.storage("club-resources", "upload").reply((call) => (String(call.args[0]).endsWith("bad.pdf") && ++attempts === 1 ? fail("The object exceeded the maximum allowed size") : ok({ path: String(call.args[0]) })));
    fake.from("resource_imports", "insert").replyOnce(ok({ id: "imp-1" })).replyOnce(ok({ id: "imp-2" }));
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("good.pdf"), fileAt("bad.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded; 1 failed")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reset failed" }));
    await waitFor(() => expect(notify.find("1 file uploaded")).toBeTruthy());
    const batches = fake.from("resource_imports", "insert").calls;
    expect(batches).toHaveLength(2);
    expect(batches[1].payload).toMatchObject({ name: "bad.pdf", total_files: 1 });
    expect(fake.storage("club-resources", "upload").calls.map((call) => String(call.args[0]))).toEqual(expect.arrayContaining(["u-me/imp-2/bad.pdf"]));
    // Closed: the composer is gone once everything went up.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("while a batch is uploading the dialog cannot be closed and the files cannot be changed", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const gate = deferred();
    fake.storage("club-resources", "upload").reply(gate.reply);
    renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    startUpload();
    await waitFor(() => expect(fake.storage("club-resources", "upload").count).toBe(1));
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Choose a different set/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close add resource" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { gate.resolve(ok({ path: "x" })); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("when a read of the library fails or answers little", () => {
  it("a picture that cannot be signed leaves the row without its thumbnail, and the list is still shown", async () => {
    scriptLibrary({ rows: [imageRow(1, "a.png"), res(2, "notes.pdf")] });
    fake.storage("*", "createSignedUrls").reply(fail("Bucket not found"));
    renderLibrary();
    await rowButton("notes.pdf");
    await rowButton("a.png");
    expect(fake.storage("club-resources", "createSignedUrls").count).toBe(1);
    expect(document.querySelectorAll("img[src*='files.test']")).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("searching inside a folder reads its subfolders first, once, and a search that cannot read them fails as a whole", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [res(1, "Plan.pdf", { parent_id: 42 })], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    await rowButton("Plan.pdf");
    const folderReads = () => fake.from("resources", "select").calls.filter((call) => call.used("eq", "node_kind", "folder"));
    expect(folderReads()).toHaveLength(0);
    fake.from("resources", "select").reply((call) => (call.used("eq", "node_kind", "folder") ? fail("canceling statement due to statement timeout") : ok([], { count: 0 })));
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: "plan" } });
    expect(await screen.findByText("Something interrupted the shelf")).toBeInTheDocument();
    expect(folderReads()).toHaveLength(1);
    expect(folderReads()[0].used("in", "parent_id", [42])).toBe(true);
  });

  it("the archived view lists only the top-most archived items: one inside an archived folder is left out", async () => {
    scriptLibrary({ rows: [], archivedCount: 3 });
    const archivedRows = [res(1, "Old folder", { node_kind: "folder", status: "archived", parent_id: null }), res(2, "Inside.pdf", { status: "archived", parent_id: 1 }), res(3, "Alone.pdf", { status: "archived", parent_id: 9 })];
    fake.from("resources", "select").reply((call: Call) => {
      const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
      if (options.head) return call.used("eq", "status", "archived") ? withCount(3) : withCount(1);
      if (call.used("in", "id")) return ok([{ id: 1, status: "archived" }, { id: 9, status: "ready" }]);
      if (call.used("maybeSingle")) return ok(null);
      return call.used("eq", "status", "archived") ? ok(archivedRows, { count: 3 }) : ok([], { count: 0 });
    });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await rowButton("Old folder");
    expect(screen.getByRole("button", { name: /Alone\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inside\.pdf/ })).not.toBeInTheDocument();
    const parentsRead = fake.from("resources", "select").calls.find((call) => call.uses("select")[0]?.[0] === "id,status")!;
    expect(parentsRead.used("in", "id", [1, 9])).toBe(true);
  });

  it("a failed read of the archived parents fails the whole load", async () => {
    scriptLibrary({ rows: [], archivedCount: 1 });
    fake.from("resources", "select").reply((call: Call) => {
      const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
      if (options.head) return call.used("eq", "status", "archived") ? withCount(1) : withCount(1);
      if (call.used("in", "id")) return fail("boom");
      return call.used("eq", "status", "archived") ? ok([res(3, "Alone.pdf", { status: "archived", parent_id: 9 })], { count: 1 }) : ok([], { count: 0 });
    });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    expect(await screen.findByText("Something interrupted the shelf")).toBeInTheDocument();
  });

  it("the live count is still reported when the archived count cannot be read, and Show archived stays hidden", async () => {
    scriptLibrary({ rows: [res(1, "Syllabus.pdf")] });
    fake.from("resources", "select").reply((call: Call) => {
      const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
      if (options.head) return call.used("eq", "status", "archived") ? fail("boom") : withCount(12);
      return ok([res(1, "Syllabus.pdf")], { count: 1 });
    });
    const { onResourceCountChange } = renderLibrary();
    await waitFor(() => expect(onResourceCountChange).toHaveBeenCalledWith(12));
    expect(screen.queryByRole("button", { name: "Show archived" })).not.toBeInTheDocument();
  });

  it("a folder's child count that cannot be read leaves the folder undeletable (it is treated as not empty)", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert") } });
    fake.from("resources", "select").reply((call: Call) => {
      const options = (call.uses("select")[0]?.[1] ?? {}) as { head?: boolean };
      if (options.head) return call.used("eq", "parent_id", 42) ? fail("boom") : withCount(0);
      if (call.used("maybeSingle")) return ok(folderRow(42, "Fall concert"));
      return ok([], { count: 0 });
    });
    renderLibrary({ role: "admin" });
    fireEvent.click(await screen.findByRole("button", { name: "Folder settings" }));
    await screen.findByText("Manage this folder");
    await waitFor(() => expect(fake.from("resources", "select").calls.some((call) => call.used("eq", "parent_id", 42) && (call.uses("select")[0][1] as { head?: boolean })?.head === true)).toBe(true));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
