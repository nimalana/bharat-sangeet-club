// The group, member and admin screens take their toasts from the toast context (useToast). Rendered inside a real ToastProvider (and
// with no spy made), a screen shows its toast in the viewport: the alert role and the words of a refusal as the person sees them.
// (The other tests of these screens read the same toasts through notifySpy(): tests/support/toast-spy.ts.)
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberAccessActions } from "../../features/admin/components/member-access";
import { GroupPeople } from "../../features/groups/components/group-people";
import { ToastProvider, ToastViewport } from "../../components/ui/toast";
import { fail, fake, ok } from "../support/fake-supabase";
import { userOf } from "../support/helpers";

const EXECUTIVE = "executive" as const;
const GROUP = { id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "approval" as const, archived_at: null };
const dev = { member_id: "u-dev", full_name: "Dev Nair", email: "dev@x.test", status: "pending", membership_role: "member", joined_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-01-01T00:00:00Z" };
const toast = () => document.querySelector(".toast") as HTMLElement | null;
const inProvider = (screenUnderTest: React.ReactElement) => render(<ToastProvider>{screenUnderTest}<ToastViewport /></ToastProvider>);

describe("GroupPeople", () => {
  it("shows its toast in the viewport", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([dev]));
    fake.rpc("review_subgroup_request").reply(ok(null));
    inProvider(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={GROUP} myRole={null} isMember={false} onGroupChanged={vi.fn()} onLeft={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Waitlist" }));
    await waitFor(() => expect(toast()).toHaveTextContent("✓ Dev Nair was waitlisted"));
    expect(toast()).toHaveAttribute("role", "status");
  });

  it("a refusal is an alert with the database's own words", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([dev]));
    fake.rpc("review_subgroup_request").reply(fail("This request was already reviewed"));
    inProvider(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={GROUP} myRole={null} isMember={false} onGroupChanged={vi.fn()} onLeft={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(toast()).toHaveTextContent("! This request was already reviewed"));
    expect(toast()).toHaveAttribute("role", "alert");
  });

  it("a members list that cannot be loaded for the add dialog is an alert", async () => {
    fake.rpc("list_subgroup_roster").reply(ok([]));
    fake.from("profiles", "select").reply(fail("permission denied for table profiles", "42501"));
    inProvider(<GroupPeople user={userOf("u-me")} role={EXECUTIVE} group={GROUP} myRole={null} isMember={false} onGroupChanged={vi.fn()} onLeft={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ Add member" }));
    await waitFor(() => expect(toast()).toHaveTextContent("! You do not have permission to do that."));
    expect(within(screen.getByRole("dialog")).getByText("Loading members…")).toBeInTheDocument();
  });
});

describe("MemberAccessActions", () => {
  it("shows its toast in the viewport", async () => {
    fake.rpc("admin_deactivate_member").reply(ok(null));
    const onChanged = vi.fn();
    inProvider(<MemberAccessActions member={{ id: "u-2", full_name: "Bala Menon", email: "bala@x.test", status: "active" }} isSelf={false} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(toast()).toHaveTextContent("✓ Bala Menon was deactivated"));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("a refusal is an alert", async () => {
    fake.rpc("admin_delete_member").reply(fail("This account has finance history"));
    inProvider(<MemberAccessActions member={{ id: "u-2", full_name: "Bala Menon", email: "bala@x.test", status: "deactivated" }} isSelf={false} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(toast()).toHaveTextContent("! This account has finance history"));
    expect(toast()).toHaveAttribute("role", "alert");
  });
});
