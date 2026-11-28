// components/ui/preview-dialog.tsx: a stored file shown in a dialog. What the screens that adopt it rely on: the file is shown with the
// browser's own element for its kind (<img>, <iframe>, <audio>, <video>, else a download link) and nothing else; load() runs at each opening
// and again on Try again; loading, a failed load and a file that does not load are announced and recoverable; "Open in a new tab" is always
// there; and it is a real dialog (named, Escape and Close close it, focus returns to the opener).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PreviewDialog, previewKind, type PreviewFile } from "../../components/ui/preview-dialog";
import { expectNoSeriousViolations } from "../support/a11y";
import { focusedName, keyboardUser, tabOrder } from "../support/keyboard";

const file = (change: Partial<PreviewFile> = {}): PreviewFile => ({ url: "https://files.test/recordings/a?signed", mime: "image/png", name: "poster.png", ...change });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const dialog = () => screen.queryByRole("dialog");

// A screen with a button that previews whatever `load` gives.
function Screen({ load, title = "Poster" }: { load: () => Promise<PreviewFile>; title?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Preview</button>
    <PreviewDialog open={open} onClose={() => setOpen(false)} title={title} load={load} />
  </>;
}
async function openIt(load: () => Promise<PreviewFile>, title?: string) {
  const user = keyboardUser();
  const view = render(<Screen load={load} title={title} />);
  await user.click(screen.getByRole("button", { name: "Preview" }));
  return { user, view };
}

describe("previewKind", () => {
  it("is decided by the type of the file", () => {
    expect(previewKind("image/jpeg")).toBe("image");
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("audio/mpeg")).toBe("audio");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "notes.pdf")).toBe("other");
    expect(previewKind("text/plain", "photo.png")).toBe("other");
  });
  it("ignores case and parameters of the type", () => {
    expect(previewKind("Audio/MPEG; codecs=mp3")).toBe("audio");
    expect(previewKind(" IMAGE/PNG ")).toBe("image");
    expect(previewKind("application/pdf; charset=binary")).toBe("pdf");
  });
  it("reads the extension only when the type says nothing", () => {
    expect(previewKind("", "Take 2.M4A")).toBe("audio");
    expect(previewKind("application/octet-stream", "scan.pdf")).toBe("pdf");
    expect(previewKind("", "clip.webm")).toBe("video");
    expect(previewKind("", "photo.JPG")).toBe("image");
    expect(previewKind("", "archive.zip")).toBe("other");
    expect(previewKind("", "no-extension")).toBe("other");
    expect(previewKind("")).toBe("other");
  });
});

describe("PreviewDialog", () => {
  it("is not there, and has not loaded anything, until it is opened", () => {
    const load = vi.fn(async () => file());
    render(<PreviewDialog open={false} onClose={() => {}} title="Poster" load={load} />);
    expect(dialog()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("is a dialog named by the title; it says Loading until the link is ready", async () => {
    const pending = deferred<PreviewFile>();
    await openIt(() => pending.promise, "Spring concert poster");
    const opened = await screen.findByRole("dialog", { name: "Spring concert poster" });
    expect(opened).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the preview…");
    expect(screen.queryByRole("img")).toBeNull();
    pending.resolve(file());
    expect(await screen.findByRole("img", { name: "poster.png" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an image in an <img> whose alt is the file's name, from the link and nothing else", async () => {
    await openIt(async () => file({ url: "https://files.test/x.png?token=1", name: "Poster of the spring concert.png" }));
    const image = await screen.findByRole("img", { name: "Poster of the spring concert.png" });
    expect(image).toHaveAttribute("src", "https://files.test/x.png?token=1");
    expect(document.querySelector("iframe, audio, video, object, embed")).toBeNull();
  });

  it("shows a PDF in an <iframe> that has a title", async () => {
    await openIt(async () => file({ url: "https://files.test/s.pdf?t=1", mime: "application/pdf", name: "Score.pdf" }));
    const frame = await screen.findByTitle("Score.pdf (PDF)");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "https://files.test/s.pdf?t=1");
    expect(document.querySelector("img, audio, video, object, embed")).toBeNull();
  });

  it("shows audio and video with the browser's own controls, named after the file", async () => {
    const first = await openIt(async () => file({ url: "https://files.test/t.mp3", mime: "audio/mpeg", name: "Take 1.mp3" }));
    const audio = await screen.findByLabelText("Take 1.mp3");
    expect(audio.tagName).toBe("AUDIO");
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("src", "https://files.test/t.mp3");
    first.view.unmount();

    await openIt(async () => file({ url: "https://files.test/v.mp4", mime: "video/mp4", name: "Rehearsal.mp4" }));
    const video = await screen.findByLabelText("Rehearsal.mp4");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("controls");
  });

  it("offers any other file as a download and embeds nothing", async () => {
    await openIt(async () => file({ url: "https://files.test/n.docx", mime: "application/msword", name: "Notes.docx" }));
    const download = await screen.findByRole("link", { name: "Download Notes.docx" });
    expect(download).toHaveAttribute("href", "https://files.test/n.docx");
    expect(download).toHaveAttribute("download", "Notes.docx");
    expect(document.querySelector("img, iframe, audio, video, object, embed")).toBeNull();
    expect(screen.getByText(/cannot be shown here/)).toBeInTheDocument();
  });

  it("every shown file has Open in a new tab, which opens the link in a new tab without handing over the page", async () => {
    await openIt(async () => file({ url: "https://files.test/x.png?t=2" }));
    const link = await screen.findByRole("link", { name: "Open in a new tab" });
    expect(link).toHaveAttribute("href", "https://files.test/x.png?t=2");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("asks load() again each time it opens, so a link that expired is never shown", async () => {
    const load = vi.fn(async () => file());
    const { user } = await openIt(load);
    await screen.findByRole("img");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialog()).toBeNull());
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("img");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not load again when the screen renders again with a new load function", async () => {
    const load = vi.fn(async () => file());
    function Rerendering() {
      const [, setCount] = useState(0);
      return <>
        <button onClick={() => setCount((n) => n + 1)}>again</button>
        <PreviewDialog open onClose={() => {}} title="Poster" load={() => load()} />
      </>;
    }
    const user = keyboardUser();
    render(<Rerendering />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    await user.tab();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a link that could not be made is an alert with the sentence of the error and Try again, which asks again", async () => {
    const load = vi.fn<() => Promise<PreviewFile>>()
      .mockRejectedValueOnce(Object.assign(new Error("Failed to fetch"), {}))
      .mockResolvedValueOnce(file());
    const { user } = await openIt(load);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The connection dropped. Check your internet and try again.");
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img", { name: "poster.png" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("while Try again is waiting for the new link, the old alert is gone and it says Loading", async () => {
    const second = deferred<PreviewFile>();
    const load = vi.fn<() => Promise<PreviewFile>>().mockRejectedValueOnce(new Error("The link could not be made.")).mockReturnValueOnce(second.promise);
    const { user } = await openIt(load);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the preview…");
    await act(async () => { second.resolve(file()); });
    expect(await screen.findByRole("img")).toBeInTheDocument();
  });

  it("a failure with no sentence of its own says the file could not be opened", async () => {
    await openIt(() => Promise.reject(new Error("")));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file could not be opened.");
  });

  it("an answer with no link is a failure too", async () => {
    await openIt(async () => file({ url: "" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file could not be opened.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("an image that does not load from its link is an alert with Try again, which asks for a fresh link", async () => {
    const load = vi.fn<() => Promise<PreviewFile>>()
      .mockResolvedValueOnce(file({ url: "https://files.test/expired" }))
      .mockResolvedValueOnce(file({ url: "https://files.test/fresh" }));
    const { user } = await openIt(load);
    fireEvent.error(await screen.findByRole("img"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file could not be shown.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img")).toHaveAttribute("src", "https://files.test/fresh");
  });

  it("a recording that does not load from its link is the same alert", async () => {
    await openIt(async () => file({ mime: "audio/mpeg", name: "t.mp3" }));
    fireEvent.error(await screen.findByLabelText("t.mp3"));
    expect(await screen.findByRole("alert")).toHaveTextContent("The file could not be shown.");
  });

  it("an answer that comes after the dialog was closed is not shown, and the next opening starts again", async () => {
    const first = deferred<PreviewFile>();
    const load = vi.fn<() => Promise<PreviewFile>>().mockReturnValueOnce(first.promise).mockResolvedValueOnce(file({ name: "second.png" }));
    const { user } = await openIt(load);
    await screen.findByRole("status");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("img", { name: "second.png" })).toBeInTheDocument();
    await act(async () => { first.resolve(file({ name: "first.png" })); });
    expect(screen.queryByRole("img", { name: "first.png" })).toBeNull();
    expect(screen.getByRole("img", { name: "second.png" })).toBeInTheDocument();
  });

  it("Try again calls the load function the screen has now, not the one it had when the dialog opened", async () => {
    const first = vi.fn<() => Promise<PreviewFile>>().mockRejectedValue(new Error("The link could not be made."));
    const second = vi.fn(async () => file({ name: "from-the-new-closure.png" }));
    const user = keyboardUser();
    const view = render(<PreviewDialog open onClose={() => {}} title="Poster" load={first} />);
    await screen.findByRole("alert");
    view.rerender(<PreviewDialog open onClose={() => {}} title="Poster" load={second} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("img", { name: "from-the-new-closure.png" })).toBeInTheDocument();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("when React runs the opening twice (development), only the answer of the last one is shown", async () => {
    const early = deferred<PreviewFile>();
    const late = deferred<PreviewFile>();
    const load = vi.fn<() => Promise<PreviewFile>>().mockReturnValueOnce(early.promise).mockReturnValueOnce(late.promise);
    render(<StrictMode><PreviewDialog open onClose={() => {}} title="Poster" load={load} /></StrictMode>);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    late.resolve(file({ name: "current.png" }));
    expect(await screen.findByRole("img", { name: "current.png" })).toBeInTheDocument();
    await act(async () => { early.resolve(file({ name: "stale.png" })); });
    expect(screen.queryByRole("img", { name: "stale.png" })).toBeNull();
    expect(screen.getByRole("img", { name: "current.png" })).toBeInTheDocument();
  });

  it("a failure of the first of those two is not shown either", async () => {
    const early = deferred<PreviewFile>();
    const late = deferred<PreviewFile>();
    const load = vi.fn<() => Promise<PreviewFile>>().mockReturnValueOnce(early.promise).mockReturnValueOnce(late.promise);
    render(<StrictMode><PreviewDialog open onClose={() => {}} title="Poster" load={load} /></StrictMode>);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    late.resolve(file());
    await screen.findByRole("img");
    await act(async () => { early.reject(new Error("a stale failure")); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("focus starts on Close; Escape and Close close it and focus goes back to the Preview button", async () => {
    const { user } = await openIt(async () => file());
    await screen.findByRole("img");
    expect(focusedName()).toBe("Close");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByRole("button", { name: "Preview" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("img");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByRole("button", { name: "Preview" })).toHaveFocus();
  });

  it("a click on the backdrop closes it", async () => {
    const { user } = await openIt(async () => file());
    const opened = await screen.findByRole("dialog");
    await user.click(opened.parentElement!);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("the keyboard stays inside: it starts on Close, Tab goes to Open in a new tab, and from there back to Close", async () => {
    const { user } = await openIt(async () => file());
    await screen.findByRole("img");
    expect(focusedName()).toBe("Close");
    expect(await tabOrder(user, 3)).toEqual(["Open in a new tab", "Close", "Open in a new tab"]);
    expect(await tabOrder(user, 2, { shift: true })).toEqual(["Close", "Open in a new tab"]);
  });

  it.each([
    ["an image", file()],
    ["a PDF", file({ mime: "application/pdf", name: "Score.pdf" })],
    ["a recording", file({ mime: "audio/mpeg", name: "Take.mp3" })],
    ["a video", file({ mime: "video/mp4", name: "Clip.mp4" })],
    ["a file that is only downloaded", file({ mime: "application/zip", name: "All.zip" })],
  ])("has no serious accessibility violation showing %s", async (_name, shown) => {
    const { view } = await openIt(async () => shown);
    await screen.findByText("Open in a new tab");
    await expectNoSeriousViolations(view.baseElement);
  });

  it("has no serious accessibility violation while loading and after a failure", async () => {
    const pending = deferred<PreviewFile>();
    const { view } = await openIt(() => pending.promise);
    await screen.findByRole("status");
    await expectNoSeriousViolations(view.baseElement);
    pending.reject(new Error("The link could not be made."));
    await screen.findByRole("alert");
    await expectNoSeriousViolations(view.baseElement);
  });
});
