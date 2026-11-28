// components/ui/upload-progress.tsx: the rows of an upload list (waiting, uploading with a bar, saving, uploaded, failed with Retry).
// What the screens that adopt it rely on: the bar is a progressbar with a name and a value that never says 100 before the server did;
// the state is spoken when it changes, not at every percent; a failed row says why and has a Retry named after the file; and the
// pattern in the file's header (a screen's list updated from uploadWithProgress's onProgress) works from the first byte to Retry.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { friendlyError } from "../../lib/errors";
import { uploadWithProgress } from "../../lib/api/_core";
import { UploadProgress, uploadPercent, type UploadItem } from "../../components/ui/upload-progress";
import { expectNoSeriousViolations } from "../support/a11y";
import { installFakeXhr } from "../support/fake-xhr";
import { focusedName, keyboardUser } from "../support/keyboard";

const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const item = (change: Partial<UploadItem> = {}): UploadItem => ({ id: "a", name: "take.mp3", status: "waiting", ...change });

describe("uploadPercent", () => {
  it("is the share of the bytes sent, rounded down, and never reaches 100 (only the server's answer says uploaded)", () => {
    expect(uploadPercent({ loaded: 250, total: 1000 })).toBe(25);
    expect(uploadPercent({ loaded: 999, total: 1000 })).toBe(99);
    expect(uploadPercent({ loaded: 1000, total: 1000 })).toBe(99);
    expect(uploadPercent({ loaded: 5000, total: 1000 })).toBe(99);
  });
  it("is 0 before anything is known, and for a size of 0", () => {
    expect(uploadPercent({})).toBe(0);
    expect(uploadPercent({ loaded: 10, total: 0 })).toBe(0);
    expect(uploadPercent({ loaded: -5, total: 100 })).toBe(0);
  });
});

describe("UploadProgress", () => {
  it("shows nothing for an empty list", () => {
    const view = render(<UploadProgress items={[]} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("is a list named \"Uploads\" (or the label it is given) with a row per file", () => {
    render(<UploadProgress items={[item({ id: "1", name: "one.mp3" }), item({ id: "2", name: "two.pdf" })]} label="Recordings being uploaded" />);
    const list = screen.getByRole("list", { name: "Recordings being uploaded" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["one.mp3Waiting", "two.pdfWaiting"]);
    expect(screen.queryByRole("list", { name: "Uploads" })).toBeNull();
  });

  it("the list is named \"Uploads\" when no label is given", () => {
    render(<UploadProgress items={[item()]} />);
    expect(screen.getByRole("list", { name: "Uploads" })).toBeInTheDocument();
  });

  it("a file that has just started, with no bytes reported yet, says Uploading at 0%, not Saving", () => {
    render(<UploadProgress items={[item({ status: "uploading" })]} />);
    expect(within(row("take.mp3")).getByRole("status")).toHaveTextContent("Uploading");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("says Waiting for a file that has not started, with no bar", () => {
    render(<UploadProgress items={[item()]} />);
    expect(within(row("take.mp3")).getByRole("status")).toHaveTextContent("Waiting");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("an uploading file has a progressbar named after it, with its value in the range 0 to 100, and the percent in words", () => {
    render(<UploadProgress items={[item({ status: "uploading", loaded: 420, total: 1000 })]} />);
    const bar = screen.getByRole("progressbar", { name: "Uploading take.mp3" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
    expect(within(row("take.mp3")).getByRole("status")).toHaveTextContent("Uploading");
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("the bar is as wide as the percent", () => {
    render(<UploadProgress items={[item({ status: "uploading", loaded: 300, total: 1000 })]} />);
    expect(screen.getByRole("progressbar").firstElementChild).toHaveStyle({ width: "30%" });
  });

  it("the state is spoken when it changes, not at every percent", () => {
    const view = render(<UploadProgress items={[item({ status: "uploading", loaded: 10, total: 1000 })]} />);
    const status = within(row("take.mp3")).getByRole("status");
    const before = status.textContent;
    view.rerender(<UploadProgress items={[item({ status: "uploading", loaded: 600, total: 1000 })]} />);
    expect(within(row("take.mp3")).getByRole("status")).toBe(status);
    expect(status.textContent).toBe(before);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
    // the percent text is for the eye: the progressbar carries it for the ear
    expect(screen.getByText("60%")).toHaveAttribute("aria-hidden", "true");
  });

  it("when every byte has left it says Saving, and the bar does not claim a finished upload", () => {
    render(<UploadProgress items={[item({ status: "uploading", loaded: 1100, total: 1100 })]} />);
    expect(within(row("take.mp3")).getByRole("status")).toHaveTextContent("Saving");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "99");
    expect(bar).toHaveAttribute("aria-valuetext", "Saving");
    expect(screen.queryByText("99%")).toBeNull();
  });

  it("an uploaded file says Uploaded and has no bar", () => {
    render(<UploadProgress items={[item({ status: "done", loaded: 1000, total: 1000 })]} />);
    expect(within(row("take.mp3")).getByRole("status")).toHaveTextContent("Uploaded");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("a failed file says why, has a Retry named after the file, and Retry gives the id of the row", async () => {
    const onRetry = vi.fn();
    const user = keyboardUser();
    render(<UploadProgress items={[item({ id: "a", name: "one.mp3", status: "failed", error: "The file is too large." }), item({ id: "b", name: "two.mp3", status: "failed", error: "The connection dropped." })]} onRetry={onRetry} />);
    expect(within(row("one.mp3")).getByRole("status")).toHaveTextContent("Failed: The file is too large.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry two.mp3" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("b");
  });

  it("a failed file with no message says Failed, and with no onRetry it has no button; only a failed file has Retry", () => {
    render(<UploadProgress items={[item({ id: "1", name: "one.mp3", status: "failed" }), item({ id: "2", name: "two.mp3", status: "done" })]} />);
    expect(within(row("one.mp3")).getByRole("status")).toHaveTextContent(/^Failed$/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Retry is only on a failed row", () => {
    render(<UploadProgress onRetry={() => {}} items={[item({ id: "1", name: "w.mp3" }), item({ id: "2", name: "u.mp3", status: "uploading" }), item({ id: "3", name: "d.mp3", status: "done" }), item({ id: "4", name: "f.mp3", status: "failed" })]} />);
    expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Retry f.mp3"]);
  });

  it("Retry works from the keyboard", async () => {
    const onRetry = vi.fn();
    const user = keyboardUser();
    render(<UploadProgress onRetry={onRetry} items={[item({ status: "failed", error: "x" })]} />);
    await user.tab();
    expect(focusedName()).toBe("Retry take.mp3");
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledWith("a");
  });

  it("has no serious accessibility violation with a file in every state", async () => {
    const view = render(<UploadProgress onRetry={() => {}} items={[
      item({ id: "1", name: "waiting.mp3" }), item({ id: "2", name: "going.mp3", status: "uploading", loaded: 5, total: 10 }),
      item({ id: "3", name: "saving.mp3", status: "uploading", loaded: 10, total: 10 }), item({ id: "4", name: "done.mp3", status: "done" }),
      item({ id: "5", name: "failed.mp3", status: "failed", error: "Too large." }),
    ]} />);
    await expectNoSeriousViolations(view.container);
  });
});

// The pattern the header of upload-progress.tsx documents, written as a screen would: a list in state, updated by uploadWithProgress.
function Screen({ file }: { file: File }) {
  const [uploads, setUploads] = useState<UploadItem[]>([{ id: "u1", name: file.name, status: "waiting" }]);
  const patch = (id: string, change: Partial<UploadItem>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } };
  async function send(id: string) {
    patch(id, { status: "uploading", loaded: 0, total: file.size, error: undefined });
    const answer = await uploadWithProgress(client, "recordings", `u/${file.name}`, file, {}, (p) => patch(id, p));
    patch(id, answer.error ? { status: "failed", error: friendlyError(answer.error) } : { status: "done" });
  }
  return <>
    <button onClick={() => void send("u1")}>Start</button>
    <UploadProgress items={uploads} onRetry={(id) => void send(id)} />
  </>;
}

describe("UploadProgress with uploadWithProgress", () => {
  it("goes from the first byte to Uploaded, and after a dropped connection a Retry sends it again", async () => {
    const xhr = installFakeXhr();
    const user = keyboardUser();
    render(<Screen file={new File(["x".repeat(2000)], "raga.mp3", { type: "audio/mpeg" })} />);
    expect(within(row("raga.mp3")).getByRole("status")).toHaveTextContent("Waiting");

    await user.click(screen.getByRole("button", { name: "Start" }));
    await xhr.waitForRequest();
    expect(screen.getByRole("progressbar", { name: "Uploading raga.mp3" })).toHaveAttribute("aria-valuenow", "0");
    act(() => xhr.last.progress(500, 2100));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "23");
    act(() => xhr.last.networkError());
    await waitFor(() => expect(within(row("raga.mp3")).getByRole("status")).toHaveTextContent("Failed: The connection dropped. Check your internet and try again."));
    expect(screen.queryByRole("progressbar")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry raga.mp3" }));
    await vi.waitFor(() => expect(xhr.requests.filter((request) => request.sent)).toHaveLength(2));
    act(() => xhr.last.progress(2100, 2100));
    expect(within(row("raga.mp3")).getByRole("status")).toHaveTextContent("Saving");
    act(() => xhr.last.respond(200, { Id: "1", Key: "recordings/u/raga.mp3" }));
    await waitFor(() => expect(within(row("raga.mp3")).getByRole("status")).toHaveTextContent("Uploaded"));
    expect(screen.queryByRole("button", { name: "Retry raga.mp3" })).toBeNull();
  });

  it("a refusal shows the server's own sentence", async () => {
    const xhr = installFakeXhr();
    const user = keyboardUser();
    render(<Screen file={new File(["x"], "big.mp3", { type: "audio/mpeg" })} />);
    await user.click(screen.getByRole("button", { name: "Start" }));
    await xhr.waitForRequest();
    act(() => xhr.last.respond(413, { statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" }));
    await waitFor(() => expect(within(row("big.mp3")).getByRole("status")).toHaveTextContent("Failed: The object exceeded the maximum allowed size"));
  });
});
