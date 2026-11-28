// Phase 3.1 on the Finance screen: what it shows while it waits and when a read fails, that no button can send a change twice, that a
// form keeps what was typed when the change does not go through, and that a file shows its progress and can be sent again.
//
// Every test here fails on the screen as it was before Phase 3 (the mutation evidence is in the report). The upload tests run the real
// uploadWithProgress against the fake XMLHttpRequest of finance-xhr.ts.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../support/a11y";
import { deferred, fail, fake, never, ok, rejects } from "../support/fake-supabase";
import { SUMMARY, attach, claim, dialog, expense, field, openTab, pdf, reimbursement, renderFinance, scriptFinance, type, waitForLoad, waitForMemberLoad } from "./finance-fixtures";
import { routeUploads } from "./finance-xhr";

const OFFLINE = "That change could not be saved. Check your connection and try again.";
const submit = () => fireEvent.submit(dialog().querySelector("form")!);
// Two submits that both land before the screen has drawn the first one's "Saving": a double click, or Enter twice.
const submitTwice = () => act(() => { const form = dialog().querySelector("form")!; fireEvent.submit(form); fireEvent.submit(form); });
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

beforeEach(() => { routeUploads(); });

describe("finance: the first read", () => {
  it("a first read that failed says so and offers Try again: it is not the empty ledger, and Try again shows the loading state and then the screen", async () => {
    scriptFinance();
    fake.from("finance_expenses", "select").replyOnce(fail("The database is unavailable"));
    const second = deferred();
    fake.from("finance_expenses", "select").reply(second.reply);
    const { notify } = renderFinance();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The finance records could not be loaded.");
    expect(notify.find("Some finance records could not be loaded").tone).toBe("error");
    // Nothing that reads as "nothing here": no empty ledger, no cards, no tabs.
    for (const empty of ["No payments yet", "No expenses yet", "No reimbursement requests", "Available cash"]) expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    // While it tries again the skeleton is back, not the error.
    expect(await screen.findByText("Loading finance workspace…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => { second.resolve(ok([expense()])); });
    await waitForLoad();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a first read that fails twice shows the error again", async () => {
    scriptFinance();
    fake.rpc("get_finance_summary").reply(fail("down"));
    renderFinance();
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(fake.rpc("get_finance_summary").count).toBe(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("The finance records could not be loaded.");
  });

  it("a refresh that failed keeps the figures and its Try again is busy, and cannot be pressed again, while it reads", async () => {
    scriptFinance();
    const third = deferred();
    fake.rpc("get_finance_summary").replyOnce(ok(SUMMARY)).replyOnce(fail("down")).reply(third.reply);
    renderFinance();
    await waitForLoad();
    // The second read: recording income reads the lists again.
    fireEvent.click(screen.getByRole("button", { name: /Record income/ }));
    submit();
    const banner = await screen.findByText(/could not be refreshed/);
    expect(screen.getByText("Available cash").parentElement!.querySelector("strong")!.textContent).toBe("$1,234.00");
    fireEvent.click(within(banner.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Try again" }));
    const trying = await screen.findByRole("button", { name: "Trying…" });
    expect(trying).toBeDisabled();
    await act(async () => { third.resolve(ok({ ...SUMMARY, available_cash: 77 })); });
    await waitFor(() => expect(screen.getByText("Available cash").parentElement!.querySelector("strong")!.textContent).toBe("$77.00"));
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument();
  });

  it("the loading state, the failed state and the screen with a dialog open have no serious accessibility violation", async () => {
    scriptFinance();
    fake.from("finance_expenses", "select").replyOnce(never);
    const { view } = renderFinance();
    await screen.findByText("Loading finance workspace…");
    await expectNoSeriousViolations(view.container);
    view.unmount();

    scriptFinance();
    fake.from("finance_expenses", "select").reply(fail("down"));
    const failed = renderFinance();
    await screen.findByRole("alert");
    await expectNoSeriousViolations(failed.view.container);
  });
});

// Every form of the screen, opened and ready to submit; `requests` counts what the person asked the database for.
const FORMS: Array<{ name: string; open: () => Promise<void>; requests: () => number }> = [
  {
    name: "a reimbursement request",
    open: async () => {
      scriptFinance();
      fake.rpc("submit_member_reimbursement").reply(ok({ expense_id: 1, reimbursement_id: 5 }));
      fake.rpc("register_finance_document").reply(ok(55));
      renderFinance({ role: "member", userId: "member-9" });
      await waitForMemberLoad();
      fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ }));
      attach("receipt");
    },
    requests: () => fake.rpc("submit_member_reimbursement").count,
  },
  {
    name: "a club expense",
    open: async () => {
      scriptFinance();
      fake.rpc("record_club_expense").reply(ok(12));
      fake.rpc("register_finance_document").reply(ok(55));
      renderFinance();
      await waitForLoad();
      fireEvent.click(screen.getByRole("button", { name: /Club expense/ }));
      attach("receipt");
    },
    requests: () => fake.rpc("record_club_expense").count,
  },
  {
    name: "income",
    open: async () => { scriptFinance(); renderFinance(); await waitForLoad(); fireEvent.click(screen.getByRole("button", { name: /Record income/ })); },
    requests: () => fake.rpc("record_finance_income").count,
  },
  {
    name: "a funding claim",
    open: async () => {
      scriptFinance();
      fake.rpc("create_funding_claim").reply(ok({ id: 3 }));
      fake.rpc("register_finance_document").reply(ok(55));
      renderFinance();
      await waitForLoad();
      await openTab("Funding claims");
      fireEvent.click(screen.getByRole("button", { name: /New funding claim/ }));
      fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
      attach("funding_approval");
    },
    requests: () => fake.rpc("create_funding_claim").count,
  },
  {
    name: "a receipt added to a request",
    open: async () => {
      scriptFinance({ reimbursements: [reimbursement({ status: "submitted", member_id: "exec-1" })] });
      fake.rpc("register_finance_document").reply(ok(55));
      renderFinance();
      await waitForLoad();
      await openTab("reimbursements");
      fireEvent.click(await screen.findByRole("button", { name: /Add receipt/ }));
      attach("file");
    },
    requests: () => fake.rpc("register_finance_document").count,
  },
  {
    name: "a claim document",
    open: async () => {
      scriptFinance({ claims: [claim({ status: "draft" })] });
      fake.rpc("register_finance_document").reply(ok(55));
      renderFinance();
      await waitForLoad();
      await openTab("Funding claims");
      fireEvent.click(await screen.findByRole("button", { name: /Document/ }));
      attach("file");
    },
    requests: () => fake.rpc("register_finance_document").count,
  },
  {
    name: "a funding payment",
    open: async () => {
      scriptFinance({ claims: [claim({ status: "approved", approved_amount: 80 })] });
      renderFinance();
      await waitForLoad();
      await openTab("Funding claims");
      fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    },
    requests: () => fake.rpc("record_funding_claim_payment").count,
  },
];

describe("finance: a double press sends one request (P2-11)", () => {
  it.each(FORMS)("$name: two submits before the screen has drawn the first send one request", async ({ open, requests }) => {
    await open();
    submitTwice();
    await closed();
    expect(requests()).toBe(1);
    // ...and the lists were read again once, not twice.
    expect(fake.from("finance_expenses", "select").count).toBe(2);
  });

  it.each(FORMS)("$name: the submit button is off and busy while the request is out", async ({ open }) => {
    // Hold the first thing the form sends.
    const hold = deferred();
    await open();
    for (const name of ["submit_member_reimbursement", "record_club_expense", "record_finance_income", "create_funding_claim", "register_finance_document", "record_funding_claim_payment"]) {
      fake.rpc(name).replyOnce(hold.reply);
    }
    submit();
    await waitFor(() => expect(dialog().querySelector("button[type=submit], form > button:last-of-type")).toBeDisabled());
    const button = dialog().querySelector("form")!.querySelector<HTMLButtonElement>("button.modal-submit")!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => { hold.resolve(ok(null)); });
  });
});

describe("finance: a dialog that is saving cannot be walked away from", () => {
  it("Escape, Close and a click beside it do nothing while the request is out; afterwards the dialog closes", async () => {
    scriptFinance();
    const answer = deferred();
    fake.rpc("record_finance_income").reply(answer.reply);
    renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Record income/ }));
    submit();
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Close" })).toBeDisabled());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(dialog().parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { answer.resolve(ok(null)); });
    await closed();
  });

  it("a click beside a form dialog never closes it, so what was typed is not lost", async () => {
    scriptFinance();
    renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: /Record income/ }));
    type("Description", "Gig at Memorial Hall");
    fireEvent.mouseDown(dialog().parentElement!);
    fireEvent.click(dialog().parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((field("Description") as HTMLInputElement).value).toBe("Gig at Memorial Hall");
    // Escape and Close still close it when nothing is running.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await closed();
  });
});

describe("finance: a form keeps what was typed when the change does not go through", () => {
  it("a request the database refuses: the dialog stays open with every field as typed and the button works again", async () => {
    scriptFinance();
    fake.rpc("submit_member_reimbursement").reply(fail("Purchase date cannot be in the future"));
    const { notify } = renderFinance({ role: "member", userId: "member-9" });
    await waitForMemberLoad();
    fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ }));
    type("What was purchased?", "Taxi to the venue");
    type("Amount", "42.5");
    type("Vendor", "Yellow Cab");
    attach("receipt");
    submit();
    await waitFor(() => expect(notify.find("Purchase date cannot be in the future").tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((field("What was purchased?") as HTMLInputElement).value).toBe("Taxi to the venue");
    expect((field("Amount") as HTMLInputElement).value).toBe("42.5");
    expect((field("Vendor") as HTMLInputElement).value).toBe("Yellow Cab");
    expect((dialog().querySelector('input[name="receipt"]') as HTMLInputElement).files?.[0]?.name).toBe("receipt.pdf");
    expect(dialog().querySelector("button.modal-submit")).toBeEnabled();
    expect(fake.storage("finance-private", "upload").count).toBe(0);
  });

  it.each([
    ["income", "record_finance_income", /Record income/, "Record income", "Description", false],
    ["a club expense", "record_club_expense", /Club expense/, "Record club expense", "What was purchased?", true],
  ])("%s: a call that gets no answer (the network went away) is told, as an error; the form stays as typed and works again", async (_name, rpc, opener, submitLabel, described, withReceipt) => {
    scriptFinance();
    fake.rpc(rpc).reply(rejects());
    const { notify } = renderFinance();
    await waitForLoad();
    fireEvent.click(screen.getByRole("button", { name: opener }));
    type(described, "Gig at Memorial Hall");
    if (withReceipt) attach("receipt");
    submit();
    await waitFor(() => expect(notify.find(OFFLINE).tone).toBe("error"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((field(described) as HTMLInputElement).value).toBe("Gig at Memorial Hall");
    expect(within(dialog()).getByRole("button", { name: submitLabel })).toBeEnabled();
  });

  it("a funding claim that was refused keeps the chosen expenses and what was typed", async () => {
    scriptFinance();
    fake.rpc("create_funding_claim").reply(fail("Expense 1 is already on another claim"));
    const { notify } = renderFinance();
    await waitForLoad();
    await openTab("Funding claims");
    fireEvent.click(screen.getByRole("button", { name: /New funding claim/ }));
    type("Claim title", "Fall concert food");
    fireEvent.click(within(dialog()).getByLabelText("Include Tabla repair"));
    attach("funding_approval");
    submit();
    await waitFor(() => expect(notify.find("Expense 1 is already on another claim").tone).toBe("error"));
    expect((field("Claim title") as HTMLInputElement).value).toBe("Fall concert food");
    expect(within(dialog()).getByLabelText("Include Tabla repair")).toBeChecked();
  });
});

describe("finance: a file shows its progress and can be sent again", () => {
  const request = () => {
    scriptFinance();
    fake.rpc("submit_member_reimbursement").reply(ok({ expense_id: 1, reimbursement_id: 5 }));
    fake.rpc("register_finance_document").reply(ok(55));
    return renderFinance({ role: "member", userId: "member-9" });
  };
  const openRequest = async () => {
    await waitForMemberLoad();
    fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ }));
  };

  it("a receipt goes up with a progress bar that follows the bytes, says Saving when the last byte is out, and the dialog closes only after the answer", async () => {
    const xhr = routeUploads({ manual: true });
    const { notify } = request();
    await openRequest();
    attach("receipt", pdf("taxi receipt.pdf"));
    submit();
    const list = await screen.findByRole("list", { name: "Documents being uploaded" });
    expect(within(list).getByText("taxi receipt.pdf")).toBeInTheDocument();
    await xhr.waitForRequest();
    expect(xhr.last.url).toContain("/object/finance-private/member-9/");
    act(() => xhr.last.progress(400, 1000));
    const bar = within(list).getByRole("progressbar", { name: "Uploading taxi receipt.pdf" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(within(list).getByRole("status")).toHaveTextContent("Uploading");
    act(() => xhr.last.progress(1000, 1000));
    expect(bar).toHaveAttribute("aria-valuetext", "Saving");
    expect(within(list).getByRole("status")).toHaveTextContent("Saving");
    // Every byte is out, the server has not answered: the dialog is still open and the bar does not say 100.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "99");
    await act(async () => { await xhr.last.finish(); });
    await waitFor(() => expect(notify.find("Reimbursement request submitted")).toBeTruthy());
    await closed();
  });

  it("a receipt that fails says why in its row and has a Retry; the request is saved once and Retry sends the same file", async () => {
    fake.storage("finance-private", "upload").replyOnce(fail("The object exceeded the maximum allowed size"));
    const { notify } = request();
    await openRequest();
    attach("receipt", pdf("taxi.pdf"));
    submit();
    const row = (await screen.findByText("taxi.pdf")).closest("li") as HTMLElement;
    await waitFor(() => expect(row).toHaveTextContent("Failed: The object exceeded the maximum allowed size"));
    expect(notify.find("Request saved; The object exceeded the maximum allowed size").tone).toBe("error");
    // The dialog stays open, the record is not saved again by pressing the button, and the button says what it will do.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Upload again" })).toBeEnabled();
    expect(fake.rpc("submit_member_reimbursement").count).toBe(1);
    expect(fake.rpc("register_finance_document").count).toBe(0);

    fireEvent.click(within(row).getByRole("button", { name: "Retry taxi.pdf" }));
    await waitFor(() => expect(notify.find("Reimbursement request submitted")).toBeTruthy());
    await closed();
    expect(fake.rpc("submit_member_reimbursement").count).toBe(1);
    expect(fake.storage("finance-private", "upload").count).toBe(2);
    expect(fake.rpc("register_finance_document").count).toBe(1);
    expect(fake.rpc("register_finance_document").calls[0].args[0]).toMatchObject({ p_expense_id: 1, p_reimbursement_id: 5, p_document_type: "receipt" });
  });

  it("a receipt that is refused before it is sent can be replaced: pressing the button again sends the new file for the request that is already saved", async () => {
    const { notify } = request();
    await openRequest();
    // No file chosen: the check refuses it after the request was saved.
    submit();
    await waitFor(() => expect(notify.find("Request saved; Choose a document to upload").tone).toBe("error"));
    expect(fake.rpc("submit_member_reimbursement").count).toBe(1);
    attach("receipt", pdf("scan.pdf"));
    expect(within(dialog()).getByRole("button", { name: "Upload again" })).toBeEnabled();
    submit();
    await waitFor(() => expect(notify.find("Reimbursement request submitted")).toBeTruthy());
    await closed();
    expect(fake.rpc("submit_member_reimbursement").count).toBe(1);
    expect(fake.rpc("register_finance_document").count).toBe(1);
    expect(fake.storage("finance-private", "upload").calls[0].args[0]).toMatch(/^member-9\/.*scan\.pdf$/);
  });

  it("a dropped connection while the file goes up is worded as a dropped connection", async () => {
    fake.storage("finance-private", "upload").reply(rejects());
    const { notify } = request();
    await openRequest();
    attach("receipt");
    submit();
    await waitFor(() => expect(notify.find("Request saved; The connection dropped. Check your internet and try again.").tone).toBe("error"));
  });

  it("closing the dialog after a failed file forgets the list: the next request starts clean and saves its own record", async () => {
    fake.storage("finance-private", "upload").replyOnce(fail("The object exceeded the maximum allowed size")).reply(ok({ path: "x" }));
    request();
    await openRequest();
    attach("receipt");
    submit();
    await screen.findByRole("list", { name: "Documents being uploaded" });
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: "Upload again" })).toBeEnabled());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    await closed();
    fireEvent.click(screen.getByRole("button", { name: /Request reimbursement/ }));
    expect(screen.queryByRole("list", { name: "Documents being uploaded" })).not.toBeInTheDocument();
    attach("receipt");
    expect(within(dialog()).getByRole("button", { name: "Submit reimbursement" })).toBeInTheDocument();
    submit();
    await closed();
    expect(fake.rpc("submit_member_reimbursement").count).toBe(2);
  });

  it("the progress list of the dialog has no serious accessibility violation while uploading and after a failure", async () => {
    const xhr = routeUploads({ manual: true });
    const { view } = request();
    await openRequest();
    attach("receipt");
    submit();
    await xhr.waitForRequest();
    act(() => xhr.last.progress(300, 1000));
    await expectNoSeriousViolations(view.baseElement);
    fake.storage("finance-private", "upload").reply(fail("The object exceeded the maximum allowed size"));
    await act(async () => { await xhr.last.finish(); });
    await screen.findByText(/Failed: The object exceeded/);
    await expectNoSeriousViolations(view.baseElement);
  });
});
