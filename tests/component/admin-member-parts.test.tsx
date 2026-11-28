// The parts of the Admin page and the Members page, rendered one by one with their props: the four numbers, the member list with its
// search, the announcement column, the audit log; a roster card and the contact form. The whole pages are in admin-page.test.tsx,
// members-directory.test.tsx and members-contact.test.tsx; these check that each part does what its props say.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminAnnouncementsPanel } from "../../features/admin/components/admin-announcements-panel";
import { AdminAuditPanel } from "../../features/admin/components/admin-audit-panel";
import { AdminMembersPanel } from "../../features/admin/components/admin-members-panel";
import { AdminStats } from "../../features/admin/components/admin-stats";
import { ContactDialog } from "../../features/members/components/contact-dialog";
import { MemberCard } from "../../features/members/components/member-card";
import type { AuditEntry } from "../../lib/api/admin";
import type { MemberProfile, Subgroup, SubgroupMembership } from "../../lib/db";
import { notifySpy, userOf } from "../support/helpers";

const member = (id: string, name: string, over: Partial<MemberProfile> = {}): MemberProfile => ({ id, full_name: name, email: `${id}@x.test`, role: "member", status: "active", phone: "919", class_year: "2028", specialty: "Veena", joined_at: "2025-08-01", ...over });
const group = (id: number, name: string): Subgroup => ({ id, name, description: "", enrollment_mode: "open", archived_at: null });
const active = (subgroup_id: number, member_id: string, status = "active"): SubgroupMembership => ({ subgroup_id, member_id, status, membership_role: "member" }) as SubgroupMembership;

describe("AdminStats", () => {
  it("counts what it is given: all, the executives, the administrators, and those missing a phone or an instrument", () => {
    render(<AdminStats activeMembers={[member("u-1", "A", { role: "admin" }), member("u-2", "B", { role: "executive", phone: "" }), member("u-3", "C", { specialty: "" }), member("u-4", "D"), member("u-5", "E", { phone: undefined })]} />);
    const stat = (label: string) => screen.getByText(label).previousElementSibling as HTMLElement;
    expect(stat("Active members")).toHaveTextContent("5");
    expect(stat("Executives")).toHaveTextContent("1");
    expect(stat("Administrators")).toHaveTextContent("1");
    expect(stat("Incomplete profiles")).toHaveTextContent("3");
  });
});

describe("AdminMembersPanel", () => {
  const members = [member("u-me", "Asha Rao", { role: "admin" }), member("u-2", "Bala Menon"), member("u-3", "Chitra Iyer", { role: "executive" }), member("u-4", "Dev Nair", { status: "deactivated" })];
  const props = (over: Partial<Parameters<typeof AdminMembersPanel>[0]> = {}) => ({ user: userOf("u-me"), members, groups: [group(7, "Vocal")], memberships: [active(7, "u-2"), active(7, "u-3", "pending")], onChangeRole: vi.fn(), onEdit: vi.fn(), onChanged: vi.fn(), ...over });

  // The box is in the address (?deactivated=1), which is written a moment after the click: the list follows the address.
  const showDeactivated = async () => { fireEvent.click(screen.getByLabelText("Show 1 deactivated")); await screen.findByText("Dev Nair"); };

  it("lists the active members; deactivated ones only after the box for them is ticked (and the box says how many)", async () => {
    notifySpy();
    render(<AdminMembersPanel {...props()} />);
    expect(screen.queryByText("Dev Nair")).not.toBeInTheDocument();
    await showDeactivated();
    expect(window.location.search).toBe("?deactivated=1");
    fireEvent.click(screen.getByLabelText("Show 1 deactivated"));
    await waitFor(() => expect(screen.queryByText("Dev Nair")).not.toBeInTheDocument());
    expect(window.location.search).toBe("");
  });

  it("the search narrows the list by name, email or role, and keeps the deactivated box as it was", async () => {
    notifySpy();
    render(<AdminMembersPanel {...props()} />);
    await showDeactivated();
    fireEvent.change(screen.getByPlaceholderText("Search members"), { target: { value: "nair" } });
    expect(screen.getByText("Dev Nair")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search members"), { target: { value: "EXECUTIVE" } });
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Dev Nair")).not.toBeInTheDocument();
  });

  it("each row shows the member's active groups (not a pending one) or 'No subgroup'", () => {
    notifySpy();
    render(<AdminMembersPanel {...props()} />);
    const row = (name: string) => screen.getByLabelText(`Permission for ${name}`).closest(".admin-member-row") as HTMLElement;
    expect(within(row("Bala Menon")).getByText("Vocal")).toBeInTheDocument();
    expect(within(row("Chitra Iyer")).getByText("No subgroup")).toBeInTheDocument();
  });

  it("the permission select calls back with the member and the new role; it is disabled for oneself and for a deactivated member", async () => {
    notifySpy();
    const onChangeRole = vi.fn();
    render(<AdminMembersPanel {...props({ onChangeRole })} />);
    await showDeactivated();
    fireEvent.change(screen.getByLabelText("Permission for Bala Menon"), { target: { value: "executive" } });
    expect(onChangeRole).toHaveBeenCalledWith(members[1], "executive");
    expect(screen.getByLabelText("Permission for Asha Rao")).toBeDisabled();
    expect(screen.getByLabelText("Permission for Dev Nair")).toBeDisabled();
  });

  it("Edit calls back with the member, and is not offered for a deactivated one", async () => {
    notifySpy();
    const onEdit = vi.fn();
    render(<AdminMembersPanel {...props({ onEdit })} />);
    await showDeactivated();
    fireEvent.click(within(screen.getByLabelText("Permission for Bala Menon").closest(".admin-member-row") as HTMLElement).getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(members[1]);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
  });
});

describe("AdminAnnouncementsPanel", () => {
  const announcements = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Notice ${i + 1}`, body: "b", is_pinned: i === 0, published_at: "2026-10-01T00:00:00Z", subgroup_id: i === 1 ? 7 : null }));

  it("the form offers the whole club first and then each group, and submitting calls back", () => {
    notifySpy();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<AdminAnnouncementsPanel user={userOf("u-me")} groups={[group(7, "Vocal"), group(8, "Violin")]} announcements={[]} onSubmit={onSubmit} onChanged={vi.fn()} />);
    const audience = screen.getByLabelText("Audience");
    expect(within(audience).getAllByRole("option").map((option) => [option.textContent, (option as HTMLOptionElement).value])).toEqual([["Whole club", ""], ["Vocal", "7"], ["Violin", "8"]]);
    fireEvent.submit(screen.getByRole("heading", { name: "Post announcement" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("lists the first five announcements, the pinned one marked, and the number of all of them", () => {
    notifySpy();
    render(<AdminAnnouncementsPanel user={userOf("u-me")} groups={[group(7, "Vocal")]} announcements={announcements} onSubmit={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getAllByText(/Notice \d/)).toHaveLength(5);
    expect(screen.getByText("◆ Notice 1")).toBeInTheDocument();
    expect(screen.queryByText("Notice 6")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Announcements" }).nextElementSibling).toHaveTextContent("7");
    expect(screen.getAllByRole("button", { name: /^Edit Notice/ })).toHaveLength(5);
  });
});

describe("AdminAuditPanel", () => {
  const entry = (id: number, action: string): AuditEntry => ({ id, action, actor_email: "asha@x.test", target_email: `t${id}@x.test`, details: {}, created_at: "2026-10-02T12:00:00Z" }) as AuditEntry;

  it("names each known action in words, and any other as 'Admin action'", () => {
    render(<AdminAuditPanel audit={[entry(1, "role_changed"), entry(2, "member_updated"), entry(3, "member_deleted"), entry(4, "member_deactivated"), entry(5, "member_reactivated"), entry(6, "something_new")]} />);
    for (const label of ["Permission changed", "Member updated", "Member deleted", "Member deactivated", "Member reactivated", "Admin action"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("t3@x.test")).toBeInTheDocument();
  });

  it("says who did it and when, and says so when there is nothing", () => {
    const first = render(<AdminAuditPanel audit={[entry(1, "role_changed")]} />);
    expect(screen.getByText(/^by asha@x.test · /)).toBeInTheDocument();
    expect(screen.getByText("Last 20 actions")).toBeInTheDocument();
    first.unmount();
    render(<AdminAuditPanel audit={[]} />);
    expect(screen.getByText("No administrative changes recorded yet.")).toBeInTheDocument();
  });
});

describe("MemberCard", () => {
  const groups = [group(7, "Vocal"), group(8, "Violin")];

  it("shows the person's initials, name, role, interests and contact details", () => {
    render(<MemberCard member={member("u-2", "Bala Menon", { role: "executive" })} groups={groups} memberships={[]} />);
    expect(screen.getByText("BM")).toHaveClass("member-initials");
    expect(screen.getByRole("heading", { level: 3, name: "Bala Menon" })).toBeInTheDocument();
    expect(screen.getByText("executive")).toHaveClass("member-role", "executive");
    expect(screen.getByText("Veena")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "u-2@x.test" })).toHaveAttribute("href", "mailto:u-2@x.test");
    expect(screen.getByRole("link", { name: "919" })).toHaveAttribute("href", "tel:919");
    expect(screen.getByText("2028")).toBeInTheDocument();
  });

  it("leaves out the phone and the class year when there are none, and says the interests are not added yet", () => {
    render(<MemberCard member={member("u-2", "Bala Menon", { phone: "", class_year: "", specialty: "" })} groups={groups} memberships={[]} />);
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByText("Class year")).not.toBeInTheDocument();
    expect(screen.getByText("Musical interests not added yet")).toBeInTheDocument();
    expect(screen.getByText("No subgroup yet")).toBeInTheDocument();
  });

  it("tags only this person's active groups, and 'Subgroup' for a group it does not know", () => {
    render(<MemberCard member={member("u-2", "Bala Menon")} groups={groups} memberships={[active(7, "u-2"), active(8, "u-2", "pending"), active(8, "u-3"), active(99, "u-2")]} />);
    expect(screen.getByText("Vocal")).toBeInTheDocument();
    expect(screen.getByText("Subgroup")).toBeInTheDocument();
    expect(screen.queryByText("Violin")).not.toBeInTheDocument();
    expect(screen.queryByText("No subgroup yet")).not.toBeInTheDocument();
  });

  it("without a name, shows the part of the email before the @", () => {
    render(<MemberCard member={member("u-9", "", { email: "nameless@x.test" })} groups={groups} memberships={[]} />);
    expect(screen.getByRole("heading", { level: 3, name: "nameless" })).toBeInTheDocument();
  });
});

describe("ContactDialog", () => {
  const props = (over: Partial<Parameters<typeof ContactDialog>[0]> = {}) => ({ ownProfile: member("u-me", "Asha Rao", { phone: "919-555-0100" }), email: "fallback@x.test", saving: false, onClose: vi.fn(), onSubmit: vi.fn((event: React.FormEvent) => event.preventDefault()), ...over });

  it("starts from the member's own profile; the email is theirs and cannot be edited", () => {
    render(<ContactDialog {...props()} />);
    expect(screen.getByLabelText("Preferred name")).toHaveValue("Asha Rao");
    expect(screen.getByLabelText("Email")).toHaveValue("u-me@x.test");
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Phone number")).toHaveValue("919-555-0100");
    expect(screen.getByLabelText("Preferred name")).toBeRequired();
  });

  it("before the profile has loaded, the form is empty and shows the sign-in email", () => {
    render(<ContactDialog {...props({ ownProfile: undefined })} />);
    expect(screen.getByLabelText("Preferred name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("fallback@x.test");
  });

  it("the button says Saving… and is disabled while it saves", () => {
    const first = render(<ContactDialog {...props()} />);
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    first.unmount();
    render(<ContactDialog {...props({ saving: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("submit calls back; the × and a press on the backdrop close it, a press in the form does not", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<ContactDialog {...props({ onClose, onSubmit })} />);
    fireEvent.submit(screen.getByRole("heading", { name: "Contact information" }).closest("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByLabelText("Phone number"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector(".modal-backdrop") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
