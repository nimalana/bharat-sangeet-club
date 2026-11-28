// The club archive form the shell opens from the Recordings page (managers only): what the shell does around it.
// The form's own behaviour (the upload, the orphan file when the row cannot be saved) is in people-recordings.test.tsx;
// this is the part that lives in the shell: opening it, closing it, and what happens once a recording is saved.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

const toast = () => document.querySelector(".toast") as HTMLElement | null;
const item = (id: number, title: string) => ({ id, title, description: "", type: "recording", storage_path: `u/${id}.mp3`, visibility: "members", is_public: false, event_date: null, raga: null, tala: null, created_at: "2026-01-01T00:00:00Z", subgroup_id: null });

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "＋ Add club recording" }));
  return (await screen.findByRole("heading", { name: "Add a club recording" })).closest("form")!;
}

describe("adding a club recording from the Recordings page", () => {
  it("after it is saved: the form closes, the shell says so, and the club archive is read again so the recording is listed", async () => {
    fake.from("archive_items", "insert").reply(ok(null));
    fake.from("archive_items", "select").reply(ok([item(1, "Founders' Day"), item(2, "Spring concert")]));
    openPortal({ role: "executive", page: "recordings", boot: { archive: [item(1, "Founders' Day")] } });
    const form = await openForm();
    expect(screen.queryByText("Spring concert")).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Spring concert" } });
    fireEvent.change(within(form).getByLabelText("Choose file"), { target: { files: [new File(["bytes"], "spring.mp4", { type: "video/mp4" })] } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add a club recording" })).not.toBeInTheDocument());
    expect(toast()).toHaveTextContent("Saved to the club archive");
    expect(toast()).toHaveClass("success");
    await waitFor(() => expect(fake.from("archive_items", "select").calls.some((call) => call.used("eq", "type", "recording") && call.used("select", "*"))).toBe(true));
    expect(await screen.findByText("Spring concert")).toBeInTheDocument();
  });

  it("is closed by its × without saving anything", async () => {
    openPortal({ role: "executive", page: "recordings" });
    const form = await openForm();
    fireEvent.click(form.querySelector(".modal-close")!);
    expect(screen.queryByRole("heading", { name: "Add a club recording" })).not.toBeInTheDocument();
    expect(fake.from("archive_items", "insert").calls).toHaveLength(0);
    expect(fake.storage("club-archive", "upload").calls).toHaveLength(0);
  });
});
