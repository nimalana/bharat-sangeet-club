// The Members page's own pieces that the directory tests (members-directory.test.tsx) leave out: the roster cards, the search and
// group filter, and the form where a member edits their own contact details. Opened through the shell.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deferred, fail, fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, full_name: name, email: `${id}@x.test`, role: "member", phone: "", class_year: "", specialty: "", joined_at: "2025-08-01", ...over });
const chainOf = (call: { chain: Array<{ method: string; args: unknown[] }> }) => call.chain.map((link) => [link.method, ...link.args]);
const GROUPS = [{ id: 7, name: "Hindustani Vocal", description: "", enrollment_mode: "open" }, { id: 8, name: "Carnatic Violin", description: "", enrollment_mode: "open" }];
const MEMBERSHIPS = [{ subgroup_id: 7, member_id: "u-2", status: "active", membership_role: "member" }, { subgroup_id: 8, member_id: "u-2", status: "pending", membership_role: "member" }, { subgroup_id: 8, member_id: "u-3", status: "active", membership_role: "member" }];

async function openMembers(members = [member("u-me", "Asha Rao", { phone: "919-555-0100", class_year: "2028", specialty: "Veena" }), member("u-2", "Bala Menon", { role: "executive" }), member("u-3", "Chitra Iyer", { specialty: "Violin" })]) {
  fake.from("profiles", "select").reply(ok(members));
  fake.from("subgroups", "select").reply(ok(GROUPS));
  fake.from("subgroup_memberships", "select").reply(ok(MEMBERSHIPS));
  openPortal({ page: "members" });
  await screen.findByRole("heading", { level: 3, name: members[1].full_name as string });
}
const card = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("article") as HTMLElement;
const openForm = () => { fireEvent.click(screen.getByRole("button", { name: "Edit my contact info" })); return screen.getByRole("heading", { name: "Contact information" }).closest("form") as HTMLFormElement; };

describe("the roster cards", () => {
  it("show the role, the interests, the active groups only, and how to reach the person", async () => {
    await openMembers();
    const bala = card("Bala Menon");
    expect(within(bala).getByText("executive")).toHaveClass("member-role", "executive");
    expect(within(bala).getByText("Musical interests not added yet")).toBeInTheDocument();
    expect(within(bala).getByText("Hindustani Vocal")).toBeInTheDocument();
    expect(within(bala).queryByText("Carnatic Violin")).not.toBeInTheDocument();
    expect(within(bala).getByRole("link", { name: "u-2@x.test" })).toHaveAttribute("href", "mailto:u-2@x.test");
    expect(within(bala).queryByText("Phone")).not.toBeInTheDocument();
    const asha = card("Asha Rao");
    expect(within(asha).getByText("No subgroup yet")).toBeInTheDocument();
    expect(within(asha).getByRole("link", { name: "919-555-0100" })).toHaveAttribute("href", "tel:919-555-0100");
    expect(within(asha).getByText("2028")).toBeInTheDocument();
    expect(within(asha).getByText("Veena")).toBeInTheDocument();
  });

  it("show the person's initials, and the part of the email before the @ when there is no name", async () => {
    await openMembers([member("u-me", "Asha Rao"), member("u-2", "Bala Menon"), member("u-9", "", { email: "nameless@x.test" })]);
    expect(within(card("Asha Rao")).getByText("AR")).toHaveClass("member-initials");
    expect(within(card("nameless")).getByText("N")).toHaveClass("member-initials");
  });
});

describe("the search and the group filter", () => {
  it("the search looks at the name, the email, the interests and the class year", async () => {
    await openMembers();
    const search = screen.getByPlaceholderText("Search by name, year, or musical interest");
    fireEvent.change(search, { target: { value: "violin" } });
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "2028" } });
    expect(card("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("Chitra Iyer")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "U-2@X" } });
    expect(screen.getByText("Bala Menon")).toBeInTheDocument();
  });

  it("the group filter keeps only those active in that group, and says so when there is nobody", async () => {
    await openMembers();
    const filter = screen.getByLabelText("Filter roster by subgroup");
    fireEvent.change(filter, { target: { value: "8" } });
    expect(screen.getByText("Chitra Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Bala Menon")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search by name, year, or musical interest"), { target: { value: "zzz" } });
    expect(screen.getByText("No members found")).toBeInTheDocument();
    expect(screen.getByText("No members are active in this subgroup.")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "all" } });
    expect(screen.getByText("Try another search.")).toBeInTheDocument();
  });
});

describe("a member's own contact details", () => {
  it("the form starts from the member's own row, with the email that cannot be changed", async () => {
    await openMembers();
    const form = openForm();
    expect(within(form).getByLabelText("Preferred name")).toHaveValue("Asha Rao");
    expect(within(form).getByLabelText("Email")).toHaveValue("u-me@x.test");
    expect(within(form).getByLabelText("Email")).toBeDisabled();
    expect(within(form).getByLabelText("Phone number")).toHaveValue("919-555-0100");
    expect(within(form).getByLabelText("Class year")).toHaveValue("2028");
    expect(within(form).getByLabelText("Voice / instrument")).toHaveValue("Veena");
  });

  it("saving sends the four columns for the member's own row, closes the form, says so and reads the directory again", async () => {
    await openMembers();
    fake.from("profiles", "update").reply(ok(null));
    const form = openForm();
    fireEvent.change(within(form).getByLabelText("Preferred name"), { target: { value: "Asha R." } });
    fireEvent.change(within(form).getByLabelText("Phone number"), { target: { value: "919-555-0199" } });
    fireEvent.submit(form);
    expect(await screen.findByText(/Your contact information was updated/, { selector: ".toast" })).toHaveClass("success");
    const [call] = fake.from("profiles", "update").calls;
    expect(call.payload).toEqual({ full_name: "Asha R.", phone: "919-555-0199", class_year: "2028", specialty: "Veena" });
    expect(chainOf(call)).toEqual([["update", call.payload], ["eq", "id", "u-me"]]);
    expect(screen.queryByRole("heading", { name: "Contact information" })).not.toBeInTheDocument();
    await waitFor(() => expect(fake.from("profiles", "select").calls.filter((read) => read.used("limit", 2000))).toHaveLength(2));
  });

  it("while it saves the button says Saving… and cannot be pressed", async () => {
    await openMembers();
    const slow = deferred();
    fake.from("profiles", "update").reply(slow.reply);
    fireEvent.submit(openForm());
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => { slow.resolve(ok(null)); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Contact information" })).not.toBeInTheDocument());
  });

  it("a refused save shows the database's own sentence as a failure, keeps the form open and does not read the directory again", async () => {
    await openMembers();
    // A database sentence with no failure words in it: only the tag the page gives it makes it a failure.
    fake.from("profiles", "update").reply(fail("Contact details are locked for this member"));
    fireEvent.submit(openForm());
    const toast = await screen.findByText(/Contact details are locked for this member/, { selector: ".toast" });
    expect(toast).toHaveClass("error");
    expect(screen.getByRole("heading", { name: "Contact information" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
    expect(fake.from("profiles", "select").calls.filter((read) => read.used("limit", 2000))).toHaveLength(1);
  });

  it("the close button and a press outside the form close it without saving", async () => {
    await openMembers();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(screen.queryByRole("heading", { name: "Contact information" })).not.toBeInTheDocument();
    openForm();
    fireEvent.mouseDown(document.querySelector(".modal-backdrop") as HTMLElement);
    expect(screen.queryByRole("heading", { name: "Contact information" })).not.toBeInTheDocument();
    expect(fake.from("profiles", "update").calls).toHaveLength(0);
  });
});
