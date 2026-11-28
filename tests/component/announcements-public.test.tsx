// The announcement editor and feed, the dashboard, and the signed-out pages (login screen, public site), run for real against the fake
// client. Written for the Phase 2.5 move of their Supabase calls into lib/api/{announcements,public}.ts: every case below was first
// run against the code that called Supabase directly, so that the move changes none of it.
//
// What is checked here and nowhere else (the pin and delete controls are in action-feedback.test.tsx, their failure tone in
// toast-tone.test.tsx, the public concert list the server hands over in shell-bootstrap.test.tsx):
//  - the editor: what it sends for a new and for an edited announcement, the wait, the toast, what the parent is told, and the
//    failure shown in the dialog (a database sentence, and the sentence for an update that changed nothing)
//  - the feed: the empty state, the pinned mark, the controls only for a person who manages
//  - the login screen: the Google sign-in request and its redirect (no name is asked for or kept: the shell asks after sign-in), the error shown
//  - the public site: the browser's own read of the concerts when the server could not make it, and the Watch link
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnouncementEditor } from "../../features/announcements/components/announcement-actions";
import { AnnouncementFeed } from "../../features/announcements/components/announcement-feed";
import { ClubDashboard } from "../../features/dashboard/components/club-dashboard";
import { LoginScreen } from "../../features/public/components/login-screen";
import { PublicSite } from "../../features/public/components/public-site";
import type { PublicConcert } from "../../lib/public-concerts";
import { notifySpy, userOf } from "../support/helpers";
import { deferred, fail, fake, ok, rejects } from "../support/fake-supabase";

const GROUPS = [{ id: 7, name: "Hindustani Vocal" }, { id: 8, name: "Carnatic Violin" }];
const existing = { id: 4, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, subgroup_id: null as number | null };

function renderEditor(over: { announcement?: typeof existing; lockedSubgroupId?: number } = {}) {
  const notify = notifySpy();
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<AnnouncementEditor user={userOf("u-me")} groups={GROUPS} announcement={over.announcement} lockedSubgroupId={over.lockedSubgroupId} onClose={onClose} onSaved={onSaved} />);
  return { notify, onClose, onSaved };
}
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button", { name: /Publish|Save changes|Saving…/ }).closest("form")!);

describe("the announcement editor", () => {
  it("publishing sends the trimmed fields with the author, waits, toasts, tells the parent, then closes", async () => {
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    const { notify, onClose, onSaved } = renderEditor();
    type("Title", "  Spring concert  ");
    type("Message", "  Doors at 6  ");
    fireEvent.click(screen.getByLabelText("Pin to the top"));
    type("Audience", "8");
    submit();
    await waitFor(() => expect(fake.from("announcements", "insert").count).toBe(1));
    const [call] = fake.from("announcements", "insert").calls;
    expect(call.payload).toEqual({ title: "Spring concert", body: "Doors at 6", is_pinned: true, subgroup_id: 8, created_by: "u-me" });
    expect(call.used("select", "id")).toBe(true);
    // While it is sent the person can neither send it again nor leave.
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => { slow.resolve(ok([{ id: 11 }])); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(notify.toasts()).toEqual([{ message: "Announcement published", tone: undefined }]);
  });

  it("the whole club is the audience unless a group is chosen", async () => {
    fake.from("announcements", "insert").reply(ok([{ id: 11 }]));
    const { onClose } = renderEditor();
    type("Title", "Hello");
    type("Message", "World");
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.from("announcements", "insert").calls[0].payload).toEqual({ title: "Hello", body: "World", is_pinned: false, subgroup_id: null, created_by: "u-me" });
  });

  it("a group's own editor has no audience choice and posts to that group", async () => {
    fake.from("announcements", "insert").reply(ok([{ id: 11 }]));
    const { onClose } = renderEditor({ lockedSubgroupId: 7 });
    expect(screen.getByText("For Hindustani Vocal")).toBeInTheDocument();
    expect(screen.queryByLabelText("Audience")).not.toBeInTheDocument();
    type("Title", "Hello");
    type("Message", "World");
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fake.from("announcements", "insert").calls[0].payload).toMatchObject({ subgroup_id: 7 });
  });

  it("editing shows what is there, sends an update on that announcement (no author), and says it was updated", async () => {
    fake.from("announcements", "update").reply(ok([{ id: 4 }]));
    const { notify, onClose, onSaved } = renderEditor({ announcement: { ...existing, subgroup_id: 7, is_pinned: true } });
    expect(screen.getByRole("heading", { name: "Edit announcement" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Rehearsal moved");
    expect(screen.getByLabelText("Audience")).toHaveValue("7");
    expect(screen.getByLabelText("Pin to the top")).toBeChecked();
    type("Title", "Rehearsal moved to 8");
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [call] = fake.from("announcements", "update").calls;
    expect(call.payload).toEqual({ title: "Rehearsal moved to 8", body: "Now at 7", is_pinned: true, subgroup_id: 7 });
    expect(call.used("eq", "id", 4)).toBe(true);
    expect(fake.from("announcements", "insert").count).toBe(0);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(notify.toasts()).toEqual([{ message: "Announcement updated", tone: undefined }]);
  });

  it("a refused save shows the database's sentence in the dialog, keeps it open and the words typed, and tells nobody", async () => {
    fake.from("announcements", "insert").reply(fail("Only executives can post announcements to the whole club", "P0001"));
    const { notify, onClose, onSaved } = renderEditor();
    type("Title", "Hello");
    type("Message", "World");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only executives can post announcements to the whole club");
    expect(screen.getByLabelText("Title")).toHaveValue("Hello");
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(notify.toasts()).toEqual([]);
  });

  it("a raw database error is replaced by a sentence a person can read", async () => {
    fake.from("announcements", "insert").reply(fail('new row violates row-level security policy for table "announcements"', "42501"));
    renderEditor();
    type("Title", "Hello");
    type("Message", "World");
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  });

  it("an update that changed no row (it was deleted meanwhile) says so and does not claim success", async () => {
    fake.from("announcements", "update").reply(ok([]));
    const { notify, onClose, onSaved } = renderEditor({ announcement: existing });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("This announcement could not be saved. It may have been deleted.");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(notify.toasts()).toEqual([]);
  });

  it("a second submit while the first is being sent sends nothing more", async () => {
    const slow = deferred();
    fake.from("announcements", "insert").reply(slow.reply);
    renderEditor();
    type("Title", "Hello");
    type("Message", "World");
    submit();
    await waitFor(() => expect(fake.from("announcements", "insert").count).toBe(1));
    submit();
    await act(async () => { slow.resolve(ok([{ id: 11 }])); });
    expect(fake.from("announcements", "insert").count).toBe(1);
  });
});

describe("the announcement feed", () => {
  const items = [
    { id: 1, title: "Pinned news", body: "Read me first", is_pinned: true, published_at: "2026-09-01T12:00:00Z", subgroup_id: null },
    { id: 2, title: "Later news", body: "Second", is_pinned: false, published_at: "2026-09-02T12:00:00Z", subgroup_id: 7 },
  ];

  it("lists the announcements with a mark on the pinned one and how many there are; a visitor has no controls", () => {
    render(<AnnouncementFeed announcements={items} />);
    expect(screen.getByRole("heading", { name: "Announcements" })).toBeInTheDocument();
    expect(screen.getByText("2 recent")).toBeInTheDocument();
    const pinned = screen.getByRole("heading", { name: "Pinned news" }).closest("article")!;
    expect(within(pinned).getByText("Pinned")).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Later news" }).closest("article")!).queryByText("Pinned")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Post announcement/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });

  it("says there is nothing yet", () => {
    render(<AnnouncementFeed announcements={[]} />);
    expect(screen.getByText("No announcements yet.")).toBeInTheDocument();
  });

  it("a manager can post one, and edit, pin or delete each; a posted one is followed by a reload", async () => {
    fake.from("announcements", "insert").reply(ok([{ id: 9 }]));
    const onChanged = vi.fn();
    notifySpy();
    render(<AnnouncementFeed announcements={items} manage={{ user: userOf("u-me"), groups: [{ id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open", archived_at: null }], onChanged }} />);
    expect(screen.getByRole("button", { name: "Edit Pinned news" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin Pinned news" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Later news" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Post announcement/ }));
    type("Title", "Fresh");
    type("Message", "Words");
    submit();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("the dashboard", () => {
  const noEvents: never[] = [];
  it("welcomes the member by name, shows the count of resources and sends each button to its section", () => {
    const onNavigate = vi.fn();
    render(<ClubDashboard {...{ name: "Asha", role: "member" as const, events: noEvents, resourceCount: 1, announcements: [], onNavigate }} />);
    expect(screen.getByRole("heading", { name: "Welcome back, Asha." })).toBeInTheDocument();
    expect(screen.getByText("Member view")).toBeInTheDocument();
    expect(screen.getByText("1 available resource")).toBeInTheDocument();
    expect(screen.getByText("No upcoming date scheduled")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Announcements", level: 2 })?.closest(".announcement-feed")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open library" }));
    fireEvent.click(screen.getByRole("button", { name: "Open attendance" }));
    fireEvent.click(screen.getByRole("button", { name: "View calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a group" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh overview" }));
    expect(onNavigate.mock.calls.map(([section]) => section)).toEqual(["documents", "attendance", "calendar", "groups", "home"]);
  });

  it("names the role, the next event with its place, and the latest announcement", () => {
    const next = { id: 3, title: "Diwali concert", description: "", starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), location: "Hill Hall", created_at: "2026-01-01T00:00:00Z", subgroup_id: null };
    const past = { ...next, id: 2, title: "Old concert", starts_at: "2020-01-01T00:00:00Z" };
    const latest = { id: 1, title: "Rehearsal moved", body: "Now at 7", is_pinned: false, published_at: "2026-09-01T12:00:00Z", subgroup_id: null };
    render(<ClubDashboard {...{ name: "Asha", role: "executive" as const, events: [past, next], resourceCount: 3, announcements: [latest], onNavigate: vi.fn() }} />);
    expect(screen.getByText("Executive view")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Diwali concert" })).toBeInTheDocument();
    expect(screen.queryByText("Old concert")).not.toBeInTheDocument();
    expect(screen.getByText(/· Hill Hall/)).toBeInTheDocument();
    expect(screen.getByText("3 available resources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Read update" })).toBeInTheDocument();
    // The latest one is the dashboard's card, and the feed lists it as well.
    expect(screen.getAllByText("Rehearsal moved").length).toBeGreaterThanOrEqual(2);
  });
});

describe("the login screen", () => {
  const start = () => fireEvent.click(screen.getByRole("button", { name: /Google/ }));

  it("signing in asks Google for the member, sending them back to this site, and says it is opening", async () => {
    const slow = deferred();
    fake.auth("signInWithOAuth").reply(slow.reply);
    render(<LoginScreen onBack={vi.fn()} />);
    start();
    await waitFor(() => expect(fake.auth("signInWithOAuth").count).toBe(1));
    expect(fake.auth("signInWithOAuth").calls[0].payload).toEqual({ provider: "google", options: { redirectTo: window.location.origin } });
    expect(screen.getByRole("button", { name: /Opening Google…/ })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
  });

  // Phase 3.2 (P3-06): the form no longer asks for a name or keeps one across the redirect; the shell asks after sign-in ("Complete your profile").
  it("joining asks for no name: there is no field, one press goes to Google, and nothing is kept in the tab's storage", async () => {
    fake.auth("signInWithOAuth").reply(ok(null));
    render(<LoginScreen onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Join the club" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Preferred name/)).not.toBeInTheDocument();
    start();
    await waitFor(() => expect(fake.auth("signInWithOAuth").count).toBe(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it("an error from Google's sign-in is shown and the button works again", async () => {
    fake.auth("signInWithOAuth").reply(fail("Unsupported provider: provider is not enabled"));
    render(<LoginScreen onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Join the club" }));
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unsupported provider: provider is not enabled");
    expect(screen.getByRole("button", { name: /Sign up with Google/ })).toBeEnabled();
  });

  it("the way back to the public site is offered", () => {
    const onBack = vi.fn();
    render(<LoginScreen onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to public site/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("the public site", () => {
  const row = (id: number, title: string) => ({ id, title, description: "Live", type: "recording", storage_path: `public/${id}.mp4`, event_date: "2026-04-10", raga: "Yaman", tala: "Teentaal", created_at: "2026-04-11T00:00:00Z", is_public: true });
  const concert = (id: number, title: string) => row(id, title) as unknown as PublicConcert;

  it("with no concerts says the archive is coming soon", () => {
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={[]} />);
    expect(screen.getByText("Concert archive coming soon")).toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });

  it("the sign-in buttons call back", () => {
    const onSignIn = vi.fn();
    render(<PublicSite onSignIn={onSignIn} initialRecordings={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Member sign in →" }));
    fireEvent.click(screen.getByRole("button", { name: "Join or sign in" }));
    fireEvent.click(screen.getByRole("button", { name: "Join Bharat Sangeet →" }));
    expect(onSignIn).toHaveBeenCalledTimes(3);
  });

  it("when the server could not read the concerts the browser reads them, newest first, and shows them", async () => {
    fake.from("archive_items", "select").reply(ok([row(1, "Spring Concert"), row(2, "Autumn Concert")]));
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={null} />);
    expect(screen.getByText("Loading the archive…")).toBeInTheDocument();
    expect(await screen.findByText("Spring Concert")).toBeInTheDocument();
    expect(screen.getByText("Autumn Concert")).toBeInTheDocument();
    expect(screen.getAllByText("Yaman · Teentaal · Live", { selector: "p" })).toHaveLength(2);
    const [call] = fake.from("archive_items", "select").calls;
    expect(call.uses("select")).toEqual([["id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public"]]);
    expect(call.used("eq", "type", "recording")).toBe(true);
    expect(call.used("eq", "is_public", true)).toBe(true);
    expect(call.uses("order")).toEqual([["event_date", { ascending: false }]]);
  });

  it("a read that fails is an empty archive, not an error on the page", async () => {
    fake.from("archive_items", "select").reply(fail("canceling statement due to statement timeout"));
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={null} />);
    expect(await screen.findByText("Concert archive coming soon")).toBeInTheDocument();
  });

  it("a read that cannot even be sent is an empty archive too", async () => {
    fake.from("archive_items", "select").reply(rejects());
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={null} />);
    expect(await screen.findByText("Concert archive coming soon")).toBeInTheDocument();
  });

  it("the list the server handed over is not read again", async () => {
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={[concert(4, "Spring Concert")]} />);
    expect(screen.getByText("Spring Concert")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.calls).toHaveLength(0);
  });

  it("Watch signs the file for ten minutes from club-archive and opens it in a new tab; a file that cannot be signed does nothing", async () => {
    render(<PublicSite onSignIn={vi.fn()} initialRecordings={[concert(4, "Spring Concert")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Watch or listen/ }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://files.test/club-archive/public/4.mp4?signed", "_blank", "noopener,noreferrer"));
    expect(fake.storage("club-archive", "createSignedUrl").calls[0].args).toEqual(["public/4.mp4", 600]);
    vi.mocked(window.open).mockClear();
    fake.storage("club-archive", "createSignedUrl").reply(fail("Object not found"));
    fireEvent.click(screen.getByRole("button", { name: /Watch or listen/ }));
    await waitFor(() => expect(fake.storage("club-archive", "createSignedUrl").count).toBe(2));
    expect(window.open).not.toHaveBeenCalled();
  });
});
