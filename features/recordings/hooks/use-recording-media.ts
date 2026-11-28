// The take in the studio: a file the person drops, or one the browser records from the microphone or camera, its preview address,
// and the saved take of a draft being finished. Nothing here talks to the database except the signed address of the draft's take.
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useDropzone, type DropzoneOptions } from "react-dropzone";
import { attempt } from "../../../lib/api/attempt";
import { createRecordingUrl, recordingBucket } from "../../../lib/api/recordings";
import type { Recording, StudioMode } from "../model";

export function useRecordingMedia(draft: Recording | null) {
  const [mode, setMode] = useState<StudioMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<"audio" | "video">(draft?.media_kind || "audio");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [captureError, setCaptureError] = useState("");
  // What a screen reader is told when the recording starts and when it ends (the elapsed time itself is plain text on the screen).
  const [announcement, setAnnouncement] = useState("");
  const [existingUrlLoading, setExistingUrlLoading] = useState(Boolean(draft));
  // The saved take of a draft could not be signed: said, with Try again, instead of showing an empty drop area as if there were no take.
  const [existingUrlFailed, setExistingUrlFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const videoPreview = useRef<HTMLVideoElement | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!draft) return;
    void attempt(() => createRecordingUrl(recordingBucket(draft), draft.storage_path)).then(({ data }) => { if (!cancelled) { setMediaUrl(data || null); setExistingUrlFailed(!data); setExistingUrlLoading(false); } });
    return () => { cancelled = true; };
  }, [draft, previewAttempt]);
  function retryPreview() { setExistingUrlFailed(false); setExistingUrlLoading(true); setPreviewAttempt((count) => count + 1); }

  useEffect(() => () => { if (mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(mediaUrl); stopCapture(); }, [mediaUrl]);
  useEffect(() => { if (videoPreview.current && stream.current) videoPreview.current.srcObject = stream.current; }, [recording, mode]);

  const onDrop = useCallback((files: File[]) => {
    const next = files[0]; if (!next) return;
    setFile(next); setMediaUrl(URL.createObjectURL(next)); setMediaKind(next.type.startsWith("video/") ? "video" : "audio"); setCaptureError("");
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false, accept: { "audio/*": [], "video/*": [] }, onDragEnter: undefined, onDragLeave: undefined, onDragOver: undefined } as DropzoneOptions);
  const inputProps = getInputProps() as unknown as InputHTMLAttributes<HTMLInputElement>;

  function stopCapture() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; recorder.current = null; setRecording(false);
  }

  async function startCapture() {
    if (!navigator.mediaDevices?.getUserMedia) { setCaptureError("This browser does not support direct recording. Try uploading a file instead."); return; }
    setCaptureError("");
    let nextStream: MediaStream | null = null;
    try {
      const video = mode === "record-video";
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      const candidates = video ? ["video/webm;codecs=vp9,opus", "video/webm"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      const nextRecorder = mimeType ? new MediaRecorder(nextStream, { mimeType }) : new MediaRecorder(nextStream);
      stream.current = nextStream; recorder.current = nextRecorder; chunks.current = []; startedAt.current = Date.now(); setRecordingSeconds(0); setRecording(true); setAnnouncement(video ? "Video recording started" : "Audio recording started");
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || (video ? "video/webm" : "audio/webm") });
        const extension = video ? "webm" : "webm";
        const recordedFile = new File([blob], `recording-${Date.now()}.${extension}`, { type: blob.type });
        const seconds = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        setFile(recordedFile); setMediaUrl(URL.createObjectURL(blob)); setMediaKind(video ? "video" : "audio"); setRecordingSeconds(seconds); setRecording(false);
        setAnnouncement(`Recording stopped after ${seconds} ${seconds === 1 ? "second" : "seconds"}. The take is ready to preview.`);
      };
      nextRecorder.start(250);
      timer.current = window.setInterval(() => setRecordingSeconds(Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))), 1000);
    } catch (error) {
      nextStream?.getTracks().forEach((track) => track.stop());
      setCaptureError(error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone or camera access was blocked. Allow access in your browser, then try again." : "We could not start the recording. Try another input or upload a file instead.");
    }
  }

  function retake() {
    stopCapture(); setFile(null); if (mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(mediaUrl); setMediaUrl(null); setRecordingSeconds(0);
  }

  return {
    mode, setMode, file, mediaUrl, mediaKind, recording, recordingSeconds, captureError, announcement, existingUrlLoading, existingUrlFailed, retryPreview, videoPreview,
    dropzone: { getRootProps, inputProps, isDragActive },
    startCapture, stopCapture, retake,
  };
}
