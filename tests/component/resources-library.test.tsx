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
import { deferred, fail, fake, ok, rejects, withCount, type Call } from "../support/fake-supabase";

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

// ---------------------------------------------------------------------------------------------------------------
// The parts of the library, one behaviour at a time
//
// The screen is made of hooks and panels (features/resources/hooks, components). Each test below pins one thing one of them
// does that no test above pins by itself. They were written against the screen before it was split and pass on it unchanged.
// ---------------------------------------------------------------------------------------------------------------

const GROUPS = [{ id: 7, name: "Hindustani Vocal" }];
// Spread, not written as an attribute: the lint rule for ARIA roles takes the `role` prop of the library for an element role.
const EXECUTIVE = { role: "executive" } as const;
const isHead = (call: Call) => (call.uses("select")[0]?.[1] as { head?: boolean } | undefined)?.head === true;
const popTo = (search: string) => act(async () => { window.history.pushState({}, "", `/${search}`); window.dispatchEvent(new PopStateEvent("popstate")); });
const openForm = async (entry: RegExp) => { fireEvent.click(await screen.findByRole("button", { name: "Add resource" })); fireEvent.click(screen.getByRole("button", { name: entry })); };
const submitFormOf = (label: string) => fireEvent.submit(screen.getByLabelText(label).closest("form")!);
const pause = (ms = 40) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe("the open folder: address bar, audience and breadcrumb", () => {
  it("going to the top when the address already says so adds no history entry; opening a folder adds one that carries its section", async () => {
    window.history.replaceState({}, "", "/?page=documents");
    scriptLibrary({ rows: [folderRow(42, "Fall concert")], byId: { 42: folderRow(42, "Fall concert") } });
    const push = vi.spyOn(window.history, "pushState");
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Resources" }));
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(await rowButton("Fall concert"));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0][0]).toEqual({ section: "documents" });
    expect(String(push.mock.calls[0][2])).toBe("/?page=documents&folder=42");
  });

  it("a new initial audience (a group's Open resources) switches the audience and leaves the open folder", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert") } });
    const { notify, rerender } = renderLibrary({ groups: GROUPS });
    await screen.findByRole("button", { name: "Fall concert" });
    rerender(<ResourceLibrary user={userOf("u-me")} {...EXECUTIVE} groups={GROUPS} memberships={[]} events={[]} notify={notify} initialScope={7} />);
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue("7"));
  });

  it("an archived folder named in the address bar is not found in the normal view, but opens in the archived view", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Old concert", { status: "archived" }) } });
    const first = renderLibrary();
    await waitFor(() => expect(first.notify.find("That folder could not be found")).toBeTruthy());
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    first.unmount();
    fake.reset();

    window.history.replaceState({}, "", "/?page=documents");
    scriptLibrary({ rows: [], archivedCount: 1, byId: { 42: folderRow(42, "Old concert", { status: "archived" }) } });
    const second = renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await popTo("?page=documents&folder=42");
    expect(await screen.findByRole("button", { name: "Old concert" })).toBeInTheDocument();
    expect(second.notify.messages()).not.toContain("That folder could not be found");
  });

  it("a breadcrumb that was read once shows at once when the folder is opened again, before it is read again", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert") } });
    const first = renderLibrary();
    await screen.findByRole("button", { name: "Fall concert" });
    first.unmount();
    const gate = deferred();
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("maybeSingle") ? gate.reply : ok([], { count: 0 }));
    renderLibrary();
    expect(await screen.findByRole("button", { name: "Fall concert" })).toBeInTheDocument();
  });

  it("while another folder's breadcrumb is being read the previous folder's is not shown", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Fall concert"), 43: folderRow(43, "Winter concert") } });
    renderLibrary();
    await screen.findByRole("button", { name: "Fall concert" });
    const gate = deferred();
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("maybeSingle") ? gate.reply : ok([], { count: 0 }));
    await popTo("?page=documents&folder=43");
    await waitFor(() => expect(listReads().some((call) => call.used("eq", "parent_id", 43))).toBe(true));
    expect(screen.queryByRole("button", { name: "Fall concert" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resources" })).toBeInTheDocument();
  });

  it("at the top nothing is read for a breadcrumb, nothing is said, and the address is left alone", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    const { notify } = renderLibrary();
    await rowButton("Syllabus.pdf");
    await pause();
    expect(fake.from("resources", "select").calls.filter((call) => call.used("maybeSingle"))).toHaveLength(0);
    expect(notify.messages()).not.toContain("That folder could not be found");
    expect(window.location.search).toBe("");
  });
});

describe("adding a folder or a link: who sees it, and what is left behind", () => {
  it("at the top an executive chooses who sees a new folder or link; descriptions are saved trimmed", async () => {
    scriptLibrary({ rows: [] });
    fake.from("resources", "insert").replyOnce(ok(folderRow(50, "Programme"))).replyOnce(ok(res(60, "Repertoire", { node_kind: "link" })));
    const { notify } = renderLibrary();
    await openForm(/Create folder/);
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Programme" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "  Concert notes  " } });
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "executives" } });
    submitFormOf("Folder name");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "example.com/rep" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "  The pieces  " } });
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "executives" } });
    submitFormOf("Link title");
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    const [folder, link] = fake.from("resources", "insert").calls.map((call) => call.payload);
    expect(folder).toMatchObject({ node_kind: "folder", title: "Programme", description: "Concert notes", visibility: "executives" });
    expect(link).toMatchObject({ node_kind: "link", title: "Repertoire", description: "The pieces", visibility: "executives", external_url: "https://example.com/rep" });
  });

  it("inside a folder a new folder or link takes the folder's visibility", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Executive notes", { visibility: "executives" }) } });
    fake.from("resources", "insert").replyOnce(ok(folderRow(50, "Inner", { parent_id: 42, visibility: "executives" }))).replyOnce(ok(res(60, "Repertoire", { node_kind: "link", parent_id: 42 })));
    const { notify } = renderLibrary();
    await screen.findByRole("button", { name: "Executive notes" });
    await createFolderNamed("Inner");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "example.com/rep" } });
    expect(screen.getByLabelText("Visibility")).toBeDisabled();
    submitFormOf("Link title");
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    const [folder, link] = fake.from("resources", "insert").calls.map((call) => call.payload);
    expect(folder).toMatchObject({ parent_id: 42, visibility: "executives" });
    expect(link).toMatchObject({ parent_id: 42, visibility: "executives" });
  });

  it("what was just added is listed at once, while the list is still being read again", async () => {
    const gate = deferred();
    let changed = false;
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("range") ? (changed ? gate.reply : ok([], { count: 0 })) : ok([]));
    fake.from("resources", "insert").replyOnce(() => { changed = true; return ok(folderRow(50, "Programme")); }).replyOnce(ok(res(60, "Repertoire", { node_kind: "link" })));
    const { notify } = renderLibrary();
    await createFolderNamed("Programme");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    expect(await rowButton("Programme")).toBeInTheDocument();
    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "example.com/rep" } });
    submitFormOf("Link title");
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    expect(await rowButton("Repertoire")).toBeInTheDocument();
  });

  it("after a folder or a link is saved, its fields are empty when the form is opened again", async () => {
    scriptLibrary({ rows: [] });
    fake.from("resources", "insert").replyOnce(ok(folderRow(50, "Programme"))).replyOnce(ok(res(60, "Repertoire", { node_kind: "link" })));
    const { notify } = renderLibrary();
    await openForm(/Create folder/);
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Programme" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Concert notes" } });
    submitFormOf("Folder name");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    await openForm(/Create folder/);
    expect(screen.getByLabelText("Folder name")).toHaveValue("");
    expect(screen.getByLabelText(/Description/)).toHaveValue("");

    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "example.com/rep" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "The pieces" } });
    submitFormOf("Link title");
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    await openForm(/Add link/);
    expect(screen.getByLabelText("Link title")).toHaveValue("");
    expect(screen.getByLabelText("Web address")).toHaveValue("");
    expect(screen.getByLabelText(/Description/)).toHaveValue("");
  });

  it("a folder or link that is being saved cannot be sent a second time", async () => {
    scriptLibrary({ rows: [] });
    const folderGate = deferred();
    const linkGate = deferred();
    fake.from("resources", "insert").replyOnce(folderGate.reply).replyOnce(linkGate.reply);
    const { notify } = renderLibrary();
    await openForm(/Create folder/);
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Programme" } });
    const folderForm = screen.getByLabelText("Folder name").closest("form")!;
    fireEvent.submit(folderForm); fireEvent.submit(folderForm);
    await waitFor(() => expect(fake.from("resources", "insert").count).toBe(1));
    await act(async () => { folderGate.resolve(ok(folderRow(50, "Programme"))); });
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    expect(fake.from("resources", "insert").count).toBe(1);

    await openForm(/Add link/);
    fireEvent.change(screen.getByLabelText("Link title"), { target: { value: "Repertoire" } });
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: "example.com/rep" } });
    const linkForm = screen.getByLabelText("Link title").closest("form")!;
    fireEvent.submit(linkForm); fireEvent.submit(linkForm);
    await waitFor(() => expect(fake.from("resources", "insert").count).toBe(2));
    await act(async () => { linkGate.resolve(ok(res(60, "Repertoire", { node_kind: "link" }))); });
    await waitFor(() => expect(notify.find("Link added to Resources")).toBeTruthy());
    expect(fake.from("resources", "insert").count).toBe(2);
  });

  it("a refused folder shows the database's own sentence only, never a fixed one", async () => {
    scriptLibrary({ rows: [] });
    fake.from("resources", "insert").reply(fail("Folder names must be unique here"));
    renderLibrary();
    await createFolderNamed("Programme");
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Folder names must be unique here$/);
  });
});

describe("the selected item", () => {
  it("entering a folder closes the details of the item that was open", async () => {
    scriptLibrary({ rows: [folderRow(42, "Fall concert"), res(5, "Setlist.pdf")], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    fireEvent.click(await rowButton("Setlist.pdf"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Fall concert/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.search).toContain("folder=42");
  });

  it("an archived folder is opened for its details and is not entered", async () => {
    scriptLibrary({ rows: [folderRow(42, "Old concert", { status: "archived" })], archivedCount: 1 });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    fireEvent.click(await rowButton("Old concert"));
    expect(await screen.findByRole("heading", { name: "Old concert" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(window.location.search).not.toContain("folder=");
  });

  it("a file is signed from the bucket its row names, or the library's own when it names none", async () => {
    scriptLibrary({ rows: [res(5, "Scan.pdf", { storage_bucket: "club-archive", storage_path: "x/scan.pdf" }), res(6, "Plain.pdf", { storage_bucket: null })] });
    const tab = { opener: "x" as unknown, location: { replace: vi.fn() }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(tab as unknown as Window);
    renderLibrary({ role: "member" });
    fireEvent.click(await rowButton("Scan.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledTimes(1));
    expect(fake.storage("club-archive", "createSignedUrl").calls[0].args).toEqual(["x/scan.pdf", 300]);
    fireEvent.click(screen.getByRole("button", { name: "Close resource details" }));
    fireEvent.click(await rowButton("Plain.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledTimes(2));
    expect(fake.storage("club-resources", "createSignedUrl").calls[0].args).toEqual(["u-1/6-Plain.pdf", 300]);
  });

  async function renameSyllabus(world: World) {
    fake.from("resources", "update").reply(ok([{ id: 5 }]));
    renderLibrary();
    fireEvent.click(await rowButton("Syllabus.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const form = screen.getByRole("heading", { name: "Edit file" }).closest('[role="dialog"]')!.querySelector("form")!;
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Syllabus v2" } });
    world.byId = { 5: res(5, "Syllabus v2") };
    const readsBefore = listReads().length;
    return { submit: () => fireEvent.submit(form), readsBefore };
  }

  it("after a change the open item keeps showing what was saved once the list was read again and no longer holds it", async () => {
    const world = scriptLibrary({ rows: [res(5, "Syllabus.pdf")], byId: { 5: res(5, "Syllabus.pdf") } });
    const edit = await renameSyllabus(world);
    world.rows = [];
    edit.submit();
    await waitFor(() => expect(listReads().length).toBeGreaterThan(edit.readsBefore));
    await pause();
    expect(screen.getByRole("heading", { name: "Syllabus v2" })).toBeInTheDocument();
  });

  it("after a change the row in the list is the saved one at once, also when the list cannot be read again", async () => {
    const world = scriptLibrary({ rows: [res(5, "Syllabus.pdf")], byId: { 5: res(5, "Syllabus.pdf") } });
    const edit = await renameSyllabus(world);
    world.listError = true;
    edit.submit();
    expect(await screen.findByText(/What is shown may be out of date/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Syllabus v2" })).toBeInTheDocument();
  });

  it("a folder's child count is asked again after a change", async () => {
    const world = scriptLibrary({ rows: [], childCount: 0 });
    openFolderUrl(42);
    world.byId = { 42: folderRow(42, "Fall concert") };
    fake.from("resources", "update").reply(ok([{ id: 42 }]));
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Folder settings" }));
    await screen.findByText("Manage this folder");
    const counts = () => fake.from("resources", "select").calls.filter((call) => isHead(call) && call.used("eq", "parent_id", 42));
    await waitFor(() => expect(counts()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(counts()).toHaveLength(2));
  });
});

describe("uploading: what the batch records and what it leaves behind", () => {
  it("inside a folder the batch is recorded with the folder, its visibility and the sizes, closed with what went up, and the list is read again", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], byId: { 42: folderRow(42, "Executive notes", { visibility: "executives" }) } });
    scriptUploads();
    const { notify } = renderLibrary();
    await screen.findByRole("button", { name: "Executive notes" });
    await chooseFiles(/Upload files/, [fileAt("a.pdf", 10), fileAt("b.pdf", 30)]);
    await waitFor(() => expect(listReads().length).toBeGreaterThan(0));
    const readsBefore = listReads().length;
    startUpload();
    await waitFor(() => expect(notify.find("2 files uploaded")).toBeTruthy());
    expect(fake.from("resource_imports", "insert").calls[0].payload).toEqual({
      name: "2 uploaded resources", root_parent_id: 42, subgroup_id: null, visibility: "executives", status: "uploading", total_files: 2, completed_files: 0, failed_files: 0, total_bytes: 40, uploaded_bytes: 0, created_by: "u-me",
    });
    expect(fake.from("resource_imports", "update").calls[0].payload).toEqual({ completed_files: 2, failed_files: 0, uploaded_bytes: 40, status: "completed" });
    const files = fake.from("resources", "insert").calls.map((call) => call.payload as Record<string, unknown>);
    expect(files.map((file) => [file.parent_id, file.visibility])).toEqual([[42, "executives"], [42, "executives"]]);
    await waitFor(() => expect(listReads().length).toBeGreaterThan(readsBefore));
  });

  it("at the top an executive chooses who sees the uploaded files, and the batch and each row say so", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const { notify } = renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    fireEvent.change(screen.getByLabelText("Visibility"), { target: { value: "executives" } });
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded")).toBeTruthy());
    expect(fake.from("resource_imports", "insert").calls[0].payload).toMatchObject({ name: "a.pdf", root_parent_id: null, visibility: "executives" });
    expect(fake.from("resources", "insert").calls[0].payload).toMatchObject({ visibility: "executives" });
  });

  it("files chosen before the panel was closed with Escape are gone when it is opened again", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("a.pdf")]);
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));
    fireEvent.click(screen.getByRole("button", { name: /Upload files/ }));
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose files/ })).toBeInTheDocument();
  });

  it("the file picker is emptied after a choice, so choosing the same file again is noticed", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    fireEvent.click(screen.getByRole("button", { name: /Upload files/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const emptied = vi.fn();
    Object.defineProperty(input, "value", { configurable: true, get: () => "", set: emptied });
    fireEvent.change(input, { target: { files: [fileAt("a.pdf")] } });
    expect(emptied).toHaveBeenCalledWith("");
  });

  it("choosing a different set of files after a failed batch starts the progress from nothing", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.storage("club-resources", "upload").reply((call) => String(call.args[0]).endsWith("bad.pdf") ? fail("too big") : ok({ path: "x" }));
    const { notify } = renderLibrary();
    const input = await chooseFiles(/Upload files/, [fileAt("good.pdf"), fileAt("bad.pdf")]);
    startUpload();
    await waitFor(() => expect(notify.find("1 file uploaded; 1 failed")).toBeTruthy());
    expect(screen.getByText("2 of 2 complete")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [fileAt("next.pdf")] } });
    expect(screen.getByText("0 of 1 complete")).toBeInTheDocument();
    expect(screen.getByText("Ready to upload")).toBeInTheDocument();
  });

  it("a folder that cannot be made because the connection dropped says what the connection said, and one the database refused gets the general sentence", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    fake.from("resources", "insert").replyOnce(rejects(new TypeError("Failed to fetch")));
    renderLibrary();
    await chooseFiles(/Upload folder/, [fileAt("Concert/a.pdf")]);
    startUpload();
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Failed to fetch$/);
    expect(fake.from("resource_imports", "update").calls[0].payload).toMatchObject({ status: "failed", failed_files: 1 });
  });
});

describe("the lists: what stays, what is added, where the next page starts", () => {
  const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => res(from + i, `Item ${from + i}`));
  const searchBox = () => screen.getByPlaceholderText(SEARCH);
  const tabText = (name: RegExp) => screen.getByRole("button", { name });
  const pendingLists = () => { const gate = deferred(); fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("range") ? gate.reply : ok([])); return gate; };

  it("a row made while a search is active is not put among the rows of that search, and one that is already listed is not listed twice", async () => {
    const gate = deferred();
    let created = false;
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("range") ? (created ? gate.reply : ok([], { count: 0 })) : ok([]));
    fake.from("resources", "insert").reply(() => { created = true; return ok(folderRow(50, "Programme")); });
    const { notify } = renderLibrary();
    fireEvent.change(await screen.findByPlaceholderText(SEARCH), { target: { value: "zzz" } });
    await waitFor(() => expect(listReads()).toHaveLength(2));
    await createFolderNamed("Programme");
    await waitFor(() => expect(notify.find("Folder created")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Programme/ })).not.toBeInTheDocument();
    // Without a search the same row is listed, once, however many times the database hands it back.
    created = false;
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(listReads()).toHaveLength(3));
    await screen.findByText("Your resource shelf is empty");
    await createFolderNamed("Programme");
    await waitFor(() => expect(notify.messages().filter((message) => message === "Folder created")).toHaveLength(2));
    await createFolderNamed("Programme");
    await waitFor(() => expect(notify.messages().filter((message) => message === "Folder created")).toHaveLength(3));
    expect(screen.getAllByRole("button", { name: /Programme/ })).toHaveLength(1);
  });

  it("a list that was read before shows at once when it is opened again, while it is read again", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary();
    await rowButton("Syllabus.pdf");
    pendingLists();
    fireEvent.click(tabText(/Photos/));
    await screen.findByText("Opening the library");
    fireEvent.click(tabText(/^All/));
    expect(await rowButton("Syllabus.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Opening the library")).not.toBeInTheDocument();
  });

  it("the total of the open list stays after Show more, and each Show more continues where the last page ended", async () => {
    scriptLibrary({ rows: page(1, RESOURCE_PAGE_SIZE), total: RESOURCE_PAGE_SIZE * 3, nextRows: page(RESOURCE_PAGE_SIZE + 1, RESOURCE_PAGE_SIZE) });
    renderLibrary();
    await rowButton(/^Item 1 /);
    expect(tabText(/^All/)).toHaveTextContent(new RegExp(`All\\s*${RESOURCE_PAGE_SIZE * 3}`));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(listReads().some((call) => call.used("range", RESOURCE_PAGE_SIZE, RESOURCE_PAGE_SIZE * 2 - 1))).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled());
    expect(tabText(/^All/)).toHaveTextContent(new RegExp(`All\\s*${RESOURCE_PAGE_SIZE * 3}`));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(listReads().some((call) => call.used("range", RESOURCE_PAGE_SIZE * 2, RESOURCE_PAGE_SIZE * 3 - 1))).toBe(true));
  });

  it("a full page that is all there is has no Show more", async () => {
    scriptLibrary({ rows: page(1, RESOURCE_PAGE_SIZE), total: RESOURCE_PAGE_SIZE });
    renderLibrary();
    await rowButton(/^Item 1 /);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("while another list is being read its total and Show more are not offered", async () => {
    scriptLibrary({ rows: page(1, RESOURCE_PAGE_SIZE), total: RESOURCE_PAGE_SIZE + 5 });
    renderLibrary();
    await rowButton(/^Item 1 /);
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
    pendingLists();
    fireEvent.click(tabText(/Photos/));
    await screen.findByText("Opening the library");
    expect(tabText(/Photos/)).toHaveTextContent(/^Photos$/);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("rows kept after a failed refresh do not offer Show more", async () => {
    const world = scriptLibrary({ rows: page(1, RESOURCE_PAGE_SIZE), total: RESOURCE_PAGE_SIZE + 5 });
    fake.from("resources", "insert").reply(ok(folderRow(2000, "New shelf")));
    renderLibrary();
    await rowButton(/^Item 1 /);
    world.listError = true;
    await createFolderNamed("New shelf");
    await screen.findByText(/may be out of date/);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("the subfolders of a folder are read once for all the searches made in it, and not at all in the archived view", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [res(1, "Plan.pdf", { parent_id: 42 })], byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    await rowButton("Plan.pdf");
    const subfolderReads = () => fake.from("resources", "select").calls.filter((call) => call.used("eq", "node_kind", "folder"));
    fireEvent.change(searchBox(), { target: { value: "plan" } });
    await waitFor(() => expect(listReads()).toHaveLength(2));
    expect(subfolderReads()).toHaveLength(1);
    fireEvent.change(searchBox(), { target: { value: "plans" } });
    await waitFor(() => expect(listReads()).toHaveLength(3));
    expect(subfolderReads()).toHaveLength(1);
  });

  it("in the archived view a search inside a folder does not read the subfolders first", async () => {
    scriptLibrary({ rows: [], archivedCount: 1, byId: { 42: folderRow(42, "Old concert", { status: "archived" }) } });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await popTo("?page=documents&folder=42");
    await screen.findByRole("button", { name: "Old concert" });
    const before = listReads().length;
    fireEvent.change(searchBox(), { target: { value: "plan" } });
    await waitFor(() => expect(listReads().length).toBeGreaterThan(before));
    expect(fake.from("resources", "select").calls.filter((call) => call.used("eq", "node_kind", "folder"))).toHaveLength(0);
  });

  it("a folder that cannot be read for its breadcrumb is reported as not found", async () => {
    openFolderUrl(42);
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("maybeSingle") ? fail("boom") : ok([], { count: 0 }));
    const { notify } = renderLibrary();
    await waitFor(() => expect(notify.find("That folder could not be found")).toBeTruthy());
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
  });
});

describe("the screen around the lists", () => {
  it("Escape closes the details of the open item", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary();
    fireEvent.click(await rowButton("Syllabus.pdf"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a press inside a panel does not close it; a press on the dimmed area around it does", async () => {
    scriptLibrary({ rows: [res(5, "Syllabus.pdf")] });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    const composer = screen.getByRole("dialog");
    fireEvent.mouseDown(within(composer).getByRole("heading", { name: "Add resource" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(composer.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(await rowButton("Syllabus.pdf"));
    const detail = await screen.findByRole("dialog");
    fireEvent.mouseDown(within(detail).getByRole("heading", { name: "Syllabus.pdf" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(detail.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opening the add panel puts the focus in it; the empty shelf's button opens it", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Add resource" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close add resource" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Add the first resource/ }));
    expect(await screen.findByRole("heading", { name: "Add resource" })).toBeInTheDocument();
  });

  it("a group's leader does not manage that group's executives-only items", async () => {
    scriptLibrary({ rows: [res(5, "Exec notes.pdf", { subgroup_id: 7, visibility: "executives" })] });
    renderLibrary({ role: "member", groups: GROUPS, memberships: [{ subgroup_id: 7, status: "active", membership_role: "leader" }] });
    fireEvent.click(await rowButton("Exec notes.pdf"));
    await screen.findByRole("heading", { name: "Exec notes.pdf" });
    expect(screen.queryByText("Manage this file")).not.toBeInTheDocument();
  });

  it("the audience list offers the groups the person is an active member of, and every group to an executive", async () => {
    const groups = [...GROUPS, { id: 8, name: "Carnatic Strings" }];
    scriptLibrary({ rows: [] });
    const member = renderLibrary({ role: "member", groups, memberships: [{ subgroup_id: 7, status: "active", membership_role: "member" }, { subgroup_id: 8, status: "pending", membership_role: "member" }] });
    const scope = await screen.findByRole("combobox", { name: "Scope" });
    expect(within(scope).getByRole("option", { name: "Hindustani Vocal" })).toBeInTheDocument();
    expect(within(scope).queryByRole("option", { name: "Carnatic Strings" })).not.toBeInTheDocument();
    member.unmount();
    renderLibrary({ groups });
    expect(within(await screen.findByRole("combobox", { name: "Scope" })).getByRole("option", { name: "Carnatic Strings" })).toBeInTheDocument();
  });

  it("an audience that is not among the groups is named Group", async () => {
    scriptLibrary({ rows: [] });
    renderLibrary({ scope: 99 });
    expect(await screen.findByText("Group")).toBeInTheDocument();
  });

  it("nothing can be added to a folder that has not been read yet", async () => {
    openFolderUrl(42);
    const gate = deferred();
    fake.from("resources", "select").reply((call: Call) => isHead(call) ? withCount(0) : call.used("maybeSingle") ? gate.reply : ok([], { count: 0 }));
    renderLibrary();
    expect(await screen.findByRole("button", { name: "Add resource" })).toBeDisabled();
    await act(async () => { gate.resolve(ok(folderRow(42, "Fall concert"))); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add resource" })).toBeEnabled());
  });

  it("changing the audience or the archived view leaves the open folder", async () => {
    openFolderUrl(42);
    scriptLibrary({ rows: [], archivedCount: 1, byId: { 42: folderRow(42, "Fall concert") } });
    renderLibrary({ groups: GROUPS });
    await screen.findByRole("button", { name: "Fall concert" });
    fireEvent.change(screen.getByRole("combobox", { name: "Scope" }), { target: { value: "club" } });
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
    await popTo("?page=documents&folder=42");
    await screen.findByRole("button", { name: "Fall concert" });
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await waitFor(() => expect(window.location.search).not.toContain("folder="));
  });

  it("an ancestor in the breadcrumb opens that folder; Folder settings is not offered in the archived view", async () => {
    openFolderUrl(43);
    scriptLibrary({ rows: [], archivedCount: 1, byId: { 43: folderRow(43, "Programme", { parent_id: 42 }), 42: folderRow(42, "Fall concert") } });
    renderLibrary();
    await screen.findByRole("button", { name: "Programme" });
    fireEvent.click(screen.getByRole("button", { name: "Fall concert" }));
    await waitFor(() => expect(window.location.search).toContain("folder=42"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Programme" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Folder settings" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await popTo("?page=documents&folder=42");
    await screen.findByRole("button", { name: "Fall concert" });
    expect(screen.queryByRole("button", { name: "Folder settings" })).not.toBeInTheDocument();
  });

  it("archiving the open folder takes the person up to the folder above it", async () => {
    openFolderUrl(43);
    scriptLibrary({ rows: [], byId: { 43: folderRow(43, "Programme", { parent_id: 42 }), 42: folderRow(42, "Fall concert") } });
    fake.rpc("set_resource_archived").reply(ok(null));
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Folder settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getAllByRole("dialog")[1]).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(fake.rpc("set_resource_archived").count).toBe(1));
    await waitFor(() => expect(window.location.search).toContain("folder=42"));
    expect(window.location.search).not.toContain("folder=43");
  });

  it("an upload is refused by the depth of the open folder, counted from the breadcrumb", async () => {
    openFolderUrl(44);
    scriptLibrary({ rows: [], byId: { 44: folderRow(44, "Rehearsals", { parent_id: 43 }), 43: folderRow(43, "Programme", { parent_id: 42 }), 42: folderRow(42, "Fall concert") } });
    scriptUploads();
    renderLibrary();
    await screen.findByRole("button", { name: "Rehearsals" });
    await chooseFiles(/Upload folder/, [fileAt("Extra/a.pdf")]);
    startUpload();
    expect(await screen.findByRole("alert")).toHaveTextContent("destination is already 3 levels deep");
    expect(fake.from("resource_imports", "insert").count).toBe(0);
  });

  it("the archived view's way back stays when the last archived item was restored", async () => {
    const world = scriptLibrary({ rows: [res(5, "Old.pdf", { status: "archived" })], archivedCount: 1 });
    fake.from("resources", "insert").reply(ok(folderRow(50, "Programme")));
    renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: "Show archived" }));
    await rowButton("Old.pdf");
    world.archivedCount = 0;
    const archivedCounts = () => fake.from("resources", "select").calls.filter((call) => isHead(call) && call.used("eq", "status", "archived"));
    const before = archivedCounts().length;
    await createFolderNamed("Programme");
    await waitFor(() => expect(archivedCounts().length).toBeGreaterThan(before));
    await pause();
    expect(screen.getByRole("button", { name: "Back to library" })).toBeInTheDocument();
  });
});

describe("the add panel while files are going up", () => {
  it("Reset failed is offered when the batch is over, not while files are still going up", async () => {
    scriptLibrary({ rows: [] });
    scriptUploads();
    const gate = deferred();
    fake.storage("club-resources", "upload").reply((call) => String(call.args[0]).endsWith("bad.pdf") ? fail("too big") : gate.reply);
    renderLibrary();
    await chooseFiles(/Upload files/, [fileAt("bad.pdf"), fileAt("slow.pdf")]);
    startUpload();
    expect(await screen.findByText("1 failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset failed" })).not.toBeInTheDocument();
    await act(async () => { gate.resolve(ok({ path: "x" })); });
    expect(await screen.findByRole("button", { name: "Reset failed" })).toBeInTheDocument();
  });
});
