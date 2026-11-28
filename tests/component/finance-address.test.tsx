// Phase 3.2 on the Finance screen: the open tab and the ledger's activity filter are in the address (?tab=, ?flow=), so a reload or a link
// opens the same place and Back returns to the previous tab. A value the screen does not know is the usual one, never an error, and
// reading the address never writes it. What is typed in the search box is not in the address (a search can be a person's name).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dialog, expense, openTab, payment, reimbursement, renderFinance, scriptFinance, waitForLoad, waitForMemberLoad } from "./finance-fixtures";

const at = (address: string) => window.history.replaceState({}, "", address);
const search = () => window.location.search;
const selected = () => screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent);

describe("finance: the open tab is in the address", () => {
  it("a click on a tab writes ?tab= next to ?page=, the usual tab writes nothing, and Back returns to the tab before", async () => {
    at("/?page=finance");
    scriptFinance();
    renderFinance();
    await waitForLoad();
    expect(selected()).toEqual(["overview"]);
    expect(search()).toBe("?page=finance");                     // nothing was written by looking

    await openTab("expenses");
    expect(search()).toBe("?page=finance&tab=expenses");
    await openTab("Funding claims");
    expect(search()).toBe("?page=finance&tab=claims");

    await act(async () => { window.history.back(); });
    await waitFor(() => expect(selected()).toEqual(["expenses"]));
    expect(screen.getByText("Expense register")).toBeInTheDocument();
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(selected()).toEqual(["overview"]));
    expect(search()).toBe("?page=finance");
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(selected()).toEqual(["expenses"]));
  });

  it("the arrow keys write the tab they land on, too", async () => {
    at("/?page=finance");
    scriptFinance();
    renderFinance();
    await waitForLoad();
    screen.getByRole("tab", { name: "overview" }).focus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "overview" }), { key: "End" });
    await waitFor(() => expect(search()).toBe("?page=finance&tab=claims"));
    expect(selected()).toEqual(["Funding claims"]);
  });

  it.each([
    ["claims", "Funding claims"],
    ["expenses", "expenses"],
    ["reimbursements", "reimbursements"],
    ["requests", "reimbursements"],
  ])("a link with ?tab=%s opens the %s tab at once, and the address is left as it is", async (value, name) => {
    at(`/?page=finance&tab=${value}`);
    scriptFinance();
    renderFinance();
    await waitForLoad();
    expect(selected()).toEqual([name]);
    expect(search()).toBe(`?page=finance&tab=${value}`);
  });

  it.each(["zzz", "", "CLAIMS", "claims%00", "overview%20", "1"])("an unknown ?tab=%s is the overview, never an error, and the address is left as it is", async (value) => {
    at(`/?page=finance&tab=${value}`);
    scriptFinance();
    renderFinance();
    await waitForLoad();
    expect(selected()).toEqual(["overview"]);
    expect(screen.getByText("Cash ledger")).toBeInTheDocument();
    expect(search()).toBe(`?page=finance&tab=${value}`);
  });

  it("a member has the one tab, even from a link to a manager's tab; the address is left as it is", async () => {
    at("/?page=finance&tab=claims");
    scriptFinance();
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    expect(selected()).toEqual(["reimbursements"]);
    expect(screen.getByText("My requests")).toBeInTheDocument();
    expect(screen.queryByText("Senate & external funding")).not.toBeInTheDocument();
    expect(search()).toBe("?page=finance&tab=claims");
  });

  it("a member's own tab is the usual one: nothing is written for it", async () => {
    at("/?page=finance");
    scriptFinance();
    renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    await openTab("reimbursements");
    expect(search()).toBe("?page=finance");
  });

  it("the action queue's button opens the requests tab and writes it", async () => {
    at("/?page=finance");
    scriptFinance({ expenses: [expense({ status: "submitted" })], reimbursements: [reimbursement({ status: "submitted" })] });
    renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Member reimbursement/ }));
    await waitFor(() => expect(selected()).toEqual(["reimbursements"]));
    expect(search()).toBe("?page=finance&tab=reimbursements");
  });
});

describe("finance: the ledger's activity filter is in the address", () => {
  const rows = { payments: [payment({ id: 7 }), payment({ id: 8, direction: "inflow", purpose: "income", description: "Gig at Memorial Hall", counterparty: "Memorial Hall", reimbursement_id: null, expense_id: null })] };
  const filter = () => screen.getByLabelText("Filter cash ledger") as HTMLSelectElement;

  it("choosing an activity writes ?flow=, filters the ledger, and the usual choice removes it; it adds no history entry", async () => {
    at("/?page=finance");
    scriptFinance(rows);
    renderFinance();
    await waitForLoad();
    const entries = window.history.length;
    fireEvent.change(filter(), { target: { value: "inflow" } });
    await waitFor(() => expect(search()).toBe("?page=finance&flow=inflow"));
    expect(screen.getByText("Gig at Memorial Hall")).toBeInTheDocument();
    expect(screen.queryByText("Reimbursement: Tabla repair")).not.toBeInTheDocument();
    fireEvent.change(filter(), { target: { value: "all" } });
    await waitFor(() => expect(search()).toBe("?page=finance"));
    expect(screen.getByText("Reimbursement: Tabla repair")).toBeInTheDocument();
    expect(window.history.length).toBe(entries);
  });

  it("a link with ?flow= opens with the filter chosen; an unknown one is all activity and is left in the address", async () => {
    at("/?page=finance&flow=outflow");
    scriptFinance(rows);
    const first = renderFinance();
    await waitForLoad();
    expect(filter().value).toBe("outflow");
    expect(screen.queryByText("Gig at Memorial Hall")).not.toBeInTheDocument();
    first.view.unmount();

    at("/?page=finance&flow=zzz");
    scriptFinance(rows);
    renderFinance();
    await waitForLoad();
    expect(filter().value).toBe("all");
    expect(search()).toBe("?page=finance&flow=zzz");
    expect(within(screen.getByRole("tabpanel")).getByText("Gig at Memorial Hall")).toBeInTheDocument();
  });

  it("the search text is not put in the address", async () => {
    at("/?page=finance");
    scriptFinance(rows);
    renderFinance();
    await waitForLoad();
    fireEvent.change(screen.getByRole("textbox", { name: "Search payments" }), { target: { value: "Meera" } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Reimbursement: Tabla repair")).toBeInTheDocument();
    expect(search()).toBe("?page=finance");
  });
});

describe("finance: the address and a dialog", () => {
  it("opening a form does not touch the address, and the tab is still the open one after it closes", async () => {
    at("/?page=finance&tab=claims");
    scriptFinance();
    renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /New funding claim/ }));
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(search()).toBe("?page=finance&tab=claims");
    expect(selected()).toEqual(["Funding claims"]);
  });
});
