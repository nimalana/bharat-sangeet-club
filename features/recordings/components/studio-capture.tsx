"use client";

import { Button } from "../../../components/ui/button";
import { ErrorBlock } from "../../../components/ui/error-block";
import type { useRecordingMedia } from "../hooks/use-recording-media";
import { formatDuration, type Recording, type StudioMode } from "../model";
import { ShruthiCompanion } from "./shruthi-companion";
import { TabList, TabPanel, type TabSpec } from "./tab-list";
import { WaveformPlayer } from "./waveform-player";

const MODES: readonly TabSpec<StudioMode>[] = [{ id: "upload", label: "Upload file" }, { id: "record-audio", label: "Record audio" }, { id: "record-video", label: "Record video" }];

type Media = ReturnType<typeof useRecordingMedia>;

/** The left column of the studio: where the take comes from (a file or the browser), its preview, and the sruthi companion. */
export function StudioCapture({ media, draft }: { media: Media; draft: Recording | null }) {
  const { mode, setMode, file, mediaUrl, mediaKind, recording, recordingSeconds, captureError, announcement, existingUrlLoading, existingUrlFailed, retryPreview, videoPreview, dropzone, startCapture, stopCapture, retake } = media;
  const { getRootProps, inputProps, isDragActive } = dropzone;
  const activeCapture = mode === "record-audio" || mode === "record-video";
  // The elapsed time is plain text (not a live region: a screen reader would read every second); what is announced is that the recording started and stopped.
  return <div className="studio-capture-column"><TabList tabs={MODES} value={mode} onChange={setMode} label="Recording source" prefix="studio-mode" className="studio-mode-tabs" locked={recording} />
    <span className="sr-only" role="status">{announcement}</span>
    <TabPanel prefix="studio-mode" value={mode}>
    {mode === "upload" && !file && !mediaUrl && !existingUrlLoading && <div {...getRootProps({ className: `recording-dropzone ${isDragActive ? "drag-active" : ""}` })}><input {...inputProps} /><span className="recording-dropzone-mark">↑</span><strong>{isDragActive ? "Drop the take here" : "Drop an audio or video take here"}</strong><small>or choose a file from your device</small><em>MP3, M4A, WAV, MP4, WebM, and other browser-supported formats</em></div>}
    {activeCapture && !file && !mediaUrl && <div className={`recording-capture-card ${recording ? "is-recording" : ""}`}>{mode === "record-video" ? <video ref={videoPreview} autoPlay muted playsInline /> : <div className="recording-live-wave"><i /><i /><i /><i /><i /><i /><i /></div>}<span className="recording-capture-status">{recording ? `Recording ${formatDuration(recordingSeconds)}` : mode === "record-video" ? "Camera ready when you are" : "Microphone ready when you are"}</span><div className="recording-capture-actions">{recording ? <Button variant="danger" onClick={stopCapture}><span aria-hidden="true">■</span> Stop recording</Button> : <Button onClick={() => void startCapture()}><span aria-hidden="true">●</span> Start recording</Button>}</div>{captureError && <p className="recording-error" role="alert">{captureError}</p>}<small className="recording-headphone-note">Use headphones if the sruthi companion is playing.</small></div>}
    {existingUrlLoading && <div className="recording-preview-loading" role="status">Loading your draft preview…</div>}
    {existingUrlFailed && !file && !mediaUrl && <ErrorBlock role="alert" message="Your saved take could not be loaded." onRetry={retryPreview} />}
    {(file || mediaUrl) && !existingUrlLoading && <div className="recording-preview-card">{mediaKind === "video" ? <video src={mediaUrl || undefined} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : mediaUrl ? <WaveformPlayer url={mediaUrl} /> : null}<div className="recording-preview-meta"><span>{file?.name || "Saved draft preview"}</span><span>{formatDuration(recordingSeconds || draft?.duration_seconds)}</span><button type="button" onClick={retake}>{draft ? "Replace file" : "Retake"}</button></div></div>}
    </TabPanel>
    <ShruthiCompanion />
  </div>;
}
