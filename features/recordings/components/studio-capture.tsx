"use client";

import { Button } from "../../../components/ui/button";
import type { useRecordingMedia } from "../hooks/use-recording-media";
import { formatDuration, type Recording } from "../model";
import { ShruthiCompanion } from "./shruthi-companion";
import { WaveformPlayer } from "./waveform-player";

type Media = ReturnType<typeof useRecordingMedia>;

/** The left column of the studio: where the take comes from (a file or the browser), its preview, and the sruthi companion. */
export function StudioCapture({ media, draft }: { media: Media; draft: Recording | null }) {
  const { mode, setMode, file, mediaUrl, mediaKind, recording, recordingSeconds, captureError, existingUrlLoading, videoPreview, dropzone, startCapture, stopCapture, retake } = media;
  const { getRootProps, inputProps, isDragActive } = dropzone;
  const activeCapture = mode === "record-audio" || mode === "record-video";
  return <div className="studio-capture-column"><div className="studio-mode-tabs" role="tablist" aria-label="Recording source"><button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")} role="tab" aria-selected={mode === "upload"}>Upload file</button><button className={mode === "record-audio" ? "active" : ""} onClick={() => setMode("record-audio")} role="tab" aria-selected={mode === "record-audio"}>Record audio</button><button className={mode === "record-video" ? "active" : ""} onClick={() => setMode("record-video")} role="tab" aria-selected={mode === "record-video"}>Record video</button></div>
    {mode === "upload" && !file && !mediaUrl && !existingUrlLoading && <div {...getRootProps({ className: `recording-dropzone ${isDragActive ? "drag-active" : ""}` })}><input {...inputProps} /><span className="recording-dropzone-mark">↑</span><strong>{isDragActive ? "Drop the take here" : "Drop an audio or video take here"}</strong><small>or choose a file from your device</small><em>MP3, M4A, WAV, MP4, WebM, and other browser-supported formats</em></div>}
    {activeCapture && !file && !mediaUrl && <div className={`recording-capture-card ${recording ? "is-recording" : ""}`}>{mode === "record-video" ? <video ref={videoPreview} autoPlay muted playsInline /> : <div className="recording-live-wave"><i /><i /><i /><i /><i /><i /><i /></div>}<span className="recording-capture-status">{recording ? `Recording ${formatDuration(recordingSeconds)}` : mode === "record-video" ? "Camera ready when you are" : "Microphone ready when you are"}</span><div className="recording-capture-actions">{recording ? <Button variant="danger" onClick={stopCapture}>■ Stop recording</Button> : <Button onClick={startCapture}>● Start recording</Button>}</div>{captureError && <p className="recording-error" role="alert">{captureError}</p>}<small className="recording-headphone-note">Use headphones if the sruthi companion is playing.</small></div>}
    {existingUrlLoading && <div className="recording-preview-loading">Loading your draft preview…</div>}
    {(file || mediaUrl) && !existingUrlLoading && <div className="recording-preview-card">{mediaKind === "video" ? <video src={mediaUrl || undefined} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : mediaUrl ? <WaveformPlayer url={mediaUrl} /> : null}<div className="recording-preview-meta"><span>{file?.name || "Saved draft preview"}</span><span>{formatDuration(recordingSeconds || draft?.duration_seconds)}</span><button type="button" onClick={retake}>{draft ? "Replace file" : "Retake"}</button></div></div>}
    <ShruthiCompanion />
  </div>;
}
