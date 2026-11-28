"use client";

import { useEffect, useId, useRef, useState } from "react";
import { friendlyError } from "../../lib/errors";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { ErrorBlock } from "./error-block";
import { LoadingBlock } from "./loading-block";

// Shows a stored file in a dialog without leaving the page: an image, a PDF, a recording, a video; any other file gets a download link.
//
//   <PreviewDialog open={previewing !== null} onClose={() => setPreviewing(null)} title={previewing?.title ?? ""}
//     load={async () => ({ url: await signedUrl(previewing.path), mime: previewing.mime, name: previewing.fileName })} />
//
// `load` is the area's own signed-link function. It runs when the dialog opens (and again on "Try again"), so a link that expired while the
// dialog was closed is never shown; it may throw or reject (the sentence is `friendlyError` of it). The file is shown with the browser's own
// elements only: <img>, <iframe>, <audio controls>, <video controls> and a link. Nothing is fetched by script and there is no blob: URL, so
// the page's Content-Security-Policy needs the storage origin in img-src, media-src and frame-src and nothing more.
//
// Loading is a polite status, a failure (the link could not be made, or an image or recording did not load from it) is an alert with Try again,
// and every shown file has "Open in a new tab". The dialog is the portal's Dialog: Escape and Close close it and focus goes back to the button
// that opened it.

export type PreviewFile = { url: string; mime: string; name: string };
export type PreviewKind = "image" | "pdf" | "audio" | "video" | "other";

const BY_EXTENSION: Record<string, PreviewKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", svg: "image",
  pdf: "pdf",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", oga: "audio", aac: "audio", flac: "audio", weba: "audio",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video",
};

/** What a file can be shown as. Its type decides; when the type says nothing (empty, application/octet-stream) its extension does. */
export function previewKind(mime: string, name = ""): PreviewKind {
  const type = mime.trim().toLowerCase().split(";")[0];
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type && type !== "application/octet-stream") return "other";
  return BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""] ?? "other";
}

type State = { status: "loading" } | { status: "ready"; file: PreviewFile } | { status: "failed"; message: string };

// Mounted while the dialog is open (the Dialog renders nothing otherwise), so every opening starts from loading.
function PreviewBody({ title, load, onClose, titleId }: { title: string; load: () => Promise<PreviewFile>; onClose: () => void; titleId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latestLoad = useRef(load);
  useEffect(() => { latestLoad.current = load; });

  useEffect(() => {
    let current = true; // false once this attempt was replaced or the dialog closed: its answer is not shown
    latestLoad.current().then(
      (file) => { if (current) setState(file?.url ? { status: "ready", file } : { status: "failed", message: "The file could not be opened." }); },
      (error: unknown) => { if (current) setState({ status: "failed", message: friendlyError(error as { message?: string } | null, "The file could not be opened.") }); },
    );
    return () => { current = false; };
  }, [attempt]);

  const retry = () => { setState({ status: "loading" }); setAttempt((n) => n + 1); };
  const brokenFile = () => setState({ status: "failed", message: "The file could not be shown." });

  return <>
    <div className="flex items-start justify-between gap-4">
      <h2 id={titleId} className="m-0 min-w-0 text-2xl [overflow-wrap:anywhere]">{title}</h2>
      <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
    </div>
    <div className="mt-4">
      {state.status === "loading" && <LoadingBlock role="status">Loading the preview…</LoadingBlock>}
      {state.status === "failed" && <ErrorBlock role="alert" message={state.message} onRetry={retry} />}
      {state.status === "ready" && <Shown file={state.file} onBroken={brokenFile} />}
    </div>
  </>;
}

function Shown({ file, onBroken }: { file: PreviewFile; onBroken: () => void }) {
  const kind = previewKind(file.mime, file.name);
  return <>
    {/* A signed link is short-lived and from another origin: next/image would only proxy it through the optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {kind === "image" && <img src={file.url} alt={file.name} onError={onBroken} className="mx-auto block max-h-[70vh] max-w-full object-contain" />}
    {kind === "pdf" && <iframe src={file.url} title={`${file.name} (PDF)`} className="block h-[70vh] w-full border border-[var(--line)] bg-white" />}
    {/* A stored take or recording comes with no captions to offer. */}
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    {kind === "audio" && <audio src={file.url} controls aria-label={file.name} onError={onBroken} className="block w-full" />}
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    {kind === "video" && <video src={file.url} controls aria-label={file.name} onError={onBroken} className="mx-auto block max-h-[70vh] max-w-full" />}
    {kind === "other" && <p className="m-0 text-sm text-[#4c5f6b]">This kind of file cannot be shown here. <a href={file.url} download={file.name} className="font-bold underline">Download {file.name}</a></p>}
    <p className="mt-4 text-sm"><a href={file.url} target="_blank" rel="noopener noreferrer" className="font-bold underline">Open in a new tab</a></p>
  </>;
}

export function PreviewDialog({ open, onClose, title, load }: { open: boolean; onClose: () => void; title: string; load: () => Promise<PreviewFile> }) {
  const titleId = useId();
  return <Dialog open={open} onClose={onClose} labelledBy={titleId} className="max-w-[900px]">
    <PreviewBody title={title} load={load} onClose={onClose} titleId={titleId} />
  </Dialog>;
}
