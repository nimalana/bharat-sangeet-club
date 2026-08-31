"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import type { User } from "@supabase/supabase-js";
import { useDropzone, type DropzoneOptions } from "react-dropzone";
import WaveSurfer from "wavesurfer.js";
import * as Tone from "tone";
import { supabase } from "../../lib/supabase";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

type Group = { id: number; name: string; description: string };
type Membership = { subgroup_id: number; status: string };
type RecordingStatus = "draft" | "published" | "archived";
type RecordingAudience = "subgroup" | "club" | "public";
type Recording = {
  id: number;
  title: string;
  description: string;
  subgroup_id: number | null;
  uploaded_by: string;
  storage_path: string;
  mime_type: string;
  media_kind: "audio" | "video";
  status: RecordingStatus;
  audience: RecordingAudience;
  recording_kind: string;
  event_date: string | null;
  raga: string | null;
  tala: string | null;
  sruthi: string | null;
  tempo: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};
type RecordingNote = { id: number; recording_id: number; title: string; note_type: "text" | "file"; body: string; storage_path: string | null; mime_type: string | null };
type WorkspaceProps = { user: User; groups: Group[]; memberships: Membership[]; canManage: boolean; initialScope?: Scope; notify: (message: string) => void; onDataChanged?: () => void };
type Scope = "all" | number;

const TONICS = [
  { label: "C", frequency: 130.81 }, { label: "C♯ / D♭", frequency: 138.59 }, { label: "D", frequency: 146.83 },
  { label: "D♯ / E♭", frequency: 155.56 }, { label: "E", frequency: 164.81 }, { label: "F", frequency: 174.61 },
  { label: "F♯ / G♭", frequency: 185 }, { label: "G", frequency: 196 }, { label: "G♯ / A♭", frequency: 207.65 },
  { label: "A", frequency: 220 }, { label: "A♯ / B♭", frequency: 233.08 }, { label: "B", frequency: 246.94 },
];

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function RecordingWorkspace({ user, groups, memberships, canManage, initialScope = "all", notify, onDataChanged }: WorkspaceProps) {
  const activeGroups = useMemo(() => canManage ? groups : groups.filter((group) => memberships.some((membership) => membership.subgroup_id === group.id && membership.status === "active")), [canManage, groups, memberships]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"published" | "drafts">("published");
  const [loading, setLoading] = useState(true);
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Recording | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("recordings").select("*").order("created_at", { ascending: false });
    if (error) notify("The recordings workspace could not be loaded");
    setRecordings((data || []) as Recording[]);
    setLoading(false);
  }, [notify]);

  // The loader synchronizes remote Supabase state into this client component.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const visible = recordings.filter((recording) => {
    const matchesView = view === "drafts" ? recording.status === "draft" && recording.uploaded_by === user.id : recording.status === "published";
    const matchesScope = scope === "all" || recording.subgroup_id === scope;
    const haystack = `${recording.title} ${recording.description} ${recording.raga || ""} ${recording.tala || ""} ${recording.recording_kind}`.toLowerCase();
    return matchesView && matchesScope && haystack.includes(query.toLowerCase());
  });

  function beginNewRecording() {
    setEditingDraft(null);
    setStudioOpen(true);
  }

  function openRecording(recording: Recording) {
    if (recording.status === "draft" && recording.uploaded_by === user.id) {
      setEditingDraft(recording);
      setStudioOpen(true);
    } else setSelectedRecording(recording);
  }

  async function refresh() {
    await load();
    onDataChanged?.();
  }

  return <section className="section-shell page-section recording-workspace">
    <div className="recording-hero">
      <div>
        <p className="eyebrow">SUBGROUP PRACTICE ROOM</p>
        <h1>Recordings</h1>
        <p>Capture a rehearsal, save a take, add the notation, and share it with your subgroup when it is ready.</p>
      </div>
      <Button onClick={beginNewRecording} disabled={!activeGroups.length}>＋ New recording</Button>
    </div>

    {!activeGroups.length ? <div className="recording-empty-state"><span className="recording-empty-mark">♪</span><div><h2>Join a subgroup to start recording</h2><p>Your recordings belong to a subgroup. Join or request access from the Groups page, then come back here.</p></div></div> : <>
      <div className="recording-controls">
        <div className="recording-tabs" role="tablist" aria-label="Recording views">
          <button className={view === "published" ? "active" : ""} role="tab" aria-selected={view === "published"} onClick={() => setView("published")}>Published</button>
          <button className={view === "drafts" ? "active" : ""} role="tab" aria-selected={view === "drafts"} onClick={() => setView("drafts")}>My drafts</button>
        </div>
        <label className="recording-search"><span aria-hidden="true">⌕</span><input aria-label="Search recordings" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, raga, tala, or type" /></label>
        <label className="scope-picker recording-scope-picker"><span>Group</span><select value={scope === "all" ? "all" : String(scope)} onChange={(event) => setScope(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All my groups</option>{activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      </div>

      {loading ? <div className="recording-loading"><span className="recording-loading-line" /><span className="recording-loading-line" /><span className="recording-loading-line" /></div> : visible.length ? <div className="recording-list recording-list-new">{visible.map((recording, index) => {
        const group = groups.find((item) => item.id === recording.subgroup_id);
        return <button className="recording-card" key={recording.id} type="button" onClick={() => openRecording(recording)}>
          <span className="recording-card-index">{String(index + 1).padStart(2, "0")}</span>
          <span className={`recording-card-icon ${recording.media_kind}`} aria-hidden="true">{recording.media_kind === "video" ? "▣" : "◖"}</span>
          <span className="recording-card-main"><strong>{recording.title}</strong><small>{group?.name || "Subgroup"} · {recording.recording_kind} · {formatDuration(recording.duration_seconds)}</small><span>{[recording.raga, recording.tala, recording.sruthi].filter(Boolean).join(" · ") || recording.description || "No musical details added yet"}</span></span>
          <span className="recording-card-status">{view === "drafts" ? "Draft" : recording.media_kind === "video" ? "Video" : "Audio"}</span>
          <span className="recording-card-date">{formatDate(recording.published_at || recording.created_at)}</span>
          <span className="recording-card-arrow" aria-hidden="true">→</span>
        </button>;
      })}</div> : <div className="recording-empty-state compact"><span className="recording-empty-mark">{view === "drafts" ? "✎" : "♪"}</span><div><h2>{view === "drafts" ? "No drafts yet" : "No published recordings in this view"}</h2><p>{view === "drafts" ? "Start a rehearsal capture or upload a take. You can return to it before publishing." : "Be the first person in your subgroup to publish a rehearsal or performance take."}</p><Button variant="secondary" onClick={beginNewRecording}>Create the first recording</Button></div></div>}
    </>}

    {studioOpen && <RecordingStudioDialog user={user} groups={activeGroups} draft={editingDraft} notify={notify} onClose={() => { setStudioOpen(false); setEditingDraft(null); }} onSaved={async () => { setStudioOpen(false); setEditingDraft(null); await refresh(); }} />}
    {selectedRecording && <RecordingDetailDialog recording={selectedRecording} groups={groups} notify={notify} onClose={() => setSelectedRecording(null)} />}
  </section>;
}

function WaveformPlayer({ url, compact = false }: { url: string; compact?: boolean }) {
  const container = useRef<HTMLDivElement | null>(null);
  const wave = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const instance = WaveSurfer.create({ container: container.current, url, height: compact ? 52 : 86, waveColor: "#b8d3e5", progressColor: "#4b9cd3", cursorColor: "#13294b", barWidth: 2, barGap: 2, barRadius: 0, normalize: true });
    wave.current = instance;
    const onReady = () => { setDuration(instance.getDuration()); setReady(true); };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFinish = () => { setPlaying(false); setTime(instance.getDuration()); };
    const onTime = (value: number) => setTime(value);
    instance.on("ready", onReady); instance.on("play", onPlay); instance.on("pause", onPause); instance.on("finish", onFinish); instance.on("timeupdate", onTime);
    return () => { instance.destroy(); wave.current = null; };
  }, [compact, url]);

  function seekBy(amount: number) {
    if (!wave.current) return;
    wave.current.setTime(Math.max(0, Math.min(duration, wave.current.getCurrentTime() + amount)));
  }

  function changeSpeed(event: ChangeEvent<HTMLSelectElement>) {
    const value = Number(event.target.value); setSpeed(value); wave.current?.setPlaybackRate(value);
  }

  return <div className={`waveform-player ${compact ? "compact" : ""}`}><div className="waveform-canvas" ref={container} /><div className="waveform-controls"><button type="button" className="waveform-play" onClick={() => wave.current?.playPause()} disabled={!ready} aria-label={playing ? "Pause" : "Play"}>{playing ? "Ⅱ" : "▶"}</button><button type="button" onClick={() => seekBy(-10)} disabled={!ready}>−10</button><span className="waveform-time">{formatDuration(time)} / {formatDuration(duration)}</span><button type="button" onClick={() => seekBy(10)} disabled={!ready}>＋10</button><label><span>Speed</span><select value={speed} onChange={changeSpeed} disabled={!ready}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label></div></div>;
}

function RecordingStudioDialog({ user, groups, draft, notify, onClose, onSaved }: { user: User; groups: Group[]; draft: Recording | null; notify: (message: string) => void; onClose: () => void; onSaved: () => Promise<void> }) {
  const [mode, setMode] = useState<"upload" | "record-audio" | "record-video">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<"audio" | "video">(draft?.media_kind || "audio");
  const [title, setTitle] = useState(draft?.title || "");
  const [description, setDescription] = useState(draft?.description || "");
  const [groupId, setGroupId] = useState<number>(draft?.subgroup_id || groups[0]?.id || 0);
  const [recordingKind, setRecordingKind] = useState(draft?.recording_kind || "practice");
  const [raga, setRaga] = useState(draft?.raga || "");
  const [tala, setTala] = useState(draft?.tala || "");
  const [sruthi, setSruthi] = useState(draft?.sruthi || "");
  const [tempo, setTempo] = useState(draft?.tempo || "");
  const [notationText, setNotationText] = useState("");
  const [notationFile, setNotationFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [captureError, setCaptureError] = useState("");
  const [existingUrlLoading, setExistingUrlLoading] = useState(Boolean(draft));
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const videoPreview = useRef<HTMLVideoElement | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!draft || !supabase) return;
    void supabase.storage.from("recordings").createSignedUrl(draft.storage_path, 1800).then(({ data }) => { if (!cancelled) { setMediaUrl(data?.signedUrl || null); setExistingUrlLoading(false); } });
    return () => { cancelled = true; };
  }, [draft]);

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
      stream.current = nextStream; recorder.current = nextRecorder; chunks.current = []; startedAt.current = Date.now(); setRecordingSeconds(0); setRecording(true);
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || (video ? "video/webm" : "audio/webm") });
        const extension = video ? "webm" : "webm";
        const recordedFile = new File([blob], `recording-${Date.now()}.${extension}`, { type: blob.type });
        setFile(recordedFile); setMediaUrl(URL.createObjectURL(blob)); setMediaKind(video ? "video" : "audio"); setRecordingSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))); setRecording(false);
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

  async function save(status: "draft" | "published") {
    if (!supabase) return;
    if (!title.trim()) { notify("Give this recording a title first"); return; }
    if (!groupId) { notify("Choose a subgroup for this recording"); return; }
    if (!file && !draft) { notify("Upload a file or record something before saving"); return; }
    setSaving(true);
    let storagePath = draft?.storage_path || "";
    try {
      if (file) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        storagePath = `${user.id}/subgroups/${groupId}/${crypto.randomUUID()}-${safeName}`;
        const upload = await supabase.storage.from("recordings").upload(storagePath, file, { contentType: file.type, upsert: false });
        if (upload.error) throw upload.error;
      }
      const payload = { title: title.trim(), description: description.trim(), subgroup_id: groupId, storage_path: storagePath, mime_type: file?.type || draft?.mime_type || (mediaKind === "video" ? "video/webm" : "audio/webm"), media_kind: mediaKind, status, audience: "subgroup", recording_kind: recordingKind, raga: raga.trim() || null, tala: tala.trim() || null, sruthi: sruthi.trim() || null, tempo: tempo.trim() || null, duration_seconds: recordingSeconds || draft?.duration_seconds || null, published_at: status === "published" ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      const result = draft ? await supabase.from("recordings").update(payload).eq("id", draft.id) : await supabase.from("recordings").insert({ ...payload, uploaded_by: user.id }).select("id").single();
      if (result.error) throw result.error;
      const recordingId = draft?.id || (result.data as { id: number } | null)?.id;
      if (recordingId && (notationText.trim() || notationFile)) {
        let notationPath: string | null = null;
        if (notationFile) {
          const safeName = notationFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          notationPath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
          const notationUpload = await supabase.storage.from("recording-notations").upload(notationPath, notationFile, { contentType: notationFile.type, upsert: false });
          if (notationUpload.error) throw notationUpload.error;
        }
        const noteResult = await supabase.from("recording_notes").insert({ recording_id: recordingId, title: notationFile?.name || "Notation", note_type: notationFile ? "file" : "text", body: notationText.trim(), storage_path: notationPath, mime_type: notationFile?.type || null, uploaded_by: user.id });
        if (noteResult.error) throw noteResult.error;
      }
      notify(status === "published" ? "Published to your subgroup" : "Draft saved"); await onSaved();
    } catch (error) {
      if (storagePath && file) await supabase.storage.from("recordings").remove([storagePath]);
      notify(error instanceof Error ? error.message : "This recording could not be saved");
    } finally { setSaving(false); }
  }

  const activeCapture = mode === "record-audio" || mode === "record-video";
  return <Dialog open onClose={onClose} className="recording-studio-dialog"><div className="studio-heading"><div><p className="eyebrow">{draft ? "RETURN TO DRAFT" : "NEW SUBGROUP RECORDING"}</p><h2>{draft ? "Finish this recording" : "Recording studio"}</h2><p>{draft ? "Review your take, add notes, and publish it when the subgroup is ready to hear it." : "Capture a rehearsal or upload a take without leaving the subgroup workspace."}</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close recording studio">×</Button></div>
    <div className="studio-layout"><div className="studio-capture-column"><div className="studio-mode-tabs" role="tablist" aria-label="Recording source"><button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")} role="tab" aria-selected={mode === "upload"}>Upload file</button><button className={mode === "record-audio" ? "active" : ""} onClick={() => setMode("record-audio")} role="tab" aria-selected={mode === "record-audio"}>Record audio</button><button className={mode === "record-video" ? "active" : ""} onClick={() => setMode("record-video")} role="tab" aria-selected={mode === "record-video"}>Record video</button></div>
      {mode === "upload" && !file && !mediaUrl && !existingUrlLoading && <div {...getRootProps({ className: `recording-dropzone ${isDragActive ? "drag-active" : ""}` })}><input {...inputProps} /><span className="recording-dropzone-mark">↑</span><strong>{isDragActive ? "Drop the take here" : "Drop an audio or video take here"}</strong><small>or choose a file from your device</small><em>MP3, M4A, WAV, MP4, WebM, and other browser-supported formats</em></div>}
      {activeCapture && !file && !mediaUrl && <div className={`recording-capture-card ${recording ? "is-recording" : ""}`}>{mode === "record-video" ? <video ref={videoPreview} autoPlay muted playsInline /> : <div className="recording-live-wave"><i /><i /><i /><i /><i /><i /><i /></div>}<span className="recording-capture-status">{recording ? `Recording ${formatDuration(recordingSeconds)}` : mode === "record-video" ? "Camera ready when you are" : "Microphone ready when you are"}</span><div className="recording-capture-actions">{recording ? <Button variant="danger" onClick={stopCapture}>■ Stop recording</Button> : <Button onClick={startCapture}>● Start recording</Button>}</div>{captureError && <p className="recording-error" role="alert">{captureError}</p>}<small className="recording-headphone-note">Use headphones if the sruthi companion is playing.</small></div>}
      {existingUrlLoading && <div className="recording-preview-loading">Loading your draft preview…</div>}
      {(file || mediaUrl) && !existingUrlLoading && <div className="recording-preview-card">{mediaKind === "video" ? <video src={mediaUrl || undefined} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : mediaUrl ? <WaveformPlayer url={mediaUrl} /> : null}<div className="recording-preview-meta"><span>{file?.name || "Saved draft preview"}</span><span>{formatDuration(recordingSeconds || draft?.duration_seconds)}</span><button type="button" onClick={retake}>{draft ? "Replace file" : "Retake"}</button></div></div>}
      <ShruthiCompanion />
    </div><form className="studio-form" onSubmit={(event) => { event.preventDefault(); void save("published"); }}><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Wednesday rehearsal, varnam take 2" required /></label><label>Subgroup<select value={groupId} onChange={(event) => setGroupId(Number(event.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="form-pair"><label>Recording type<select value={recordingKind} onChange={(event) => setRecordingKind(event.target.value)}><option value="practice">Practice</option><option value="rehearsal">Rehearsal</option><option value="lesson">Lesson</option><option value="performance">Performance</option><option value="workshop">Workshop</option></select></label><label>Tempo / laya<input value={tempo} onChange={(event) => setTempo(event.target.value)} placeholder="Madhyama, 96 bpm" /></label></div><div className="form-pair"><label>Raga / raag<input value={raga} onChange={(event) => setRaga(event.target.value)} placeholder="Bhairavi / Bhairav" /></label><label>Tala / taal<input value={tala} onChange={(event) => setTala(event.target.value)} placeholder="Adi / Teentaal" /></label></div><div className="form-pair"><label>Sruthi / tonic<input value={sruthi} onChange={(event) => setSruthi(event.target.value)} placeholder="C, D, or 1 kattai" /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should the group listen for?" /></label></div><label>Notation text<textarea value={notationText} onChange={(event) => setNotationText(event.target.value)} rows={5} placeholder="Add lyrics, sahitya, swara, sargam, bols, or rehearsal notes" /></label><label className="notation-file-input">Notation file<input type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" onChange={(event) => setNotationFile(event.target.files?.[0] || null)} /><small>{notationFile ? notationFile.name : "Optional PDF, DOC, DOCX, image, or text file"}</small></label><div className="studio-publish-note"><span className="scope-dot" /> Publishing shares this recording with <strong>{groups.find((group) => group.id === groupId)?.name || "your subgroup"}</strong> only.</div><div className="studio-actions"><Button variant="secondary" type="button" onClick={() => void save("draft")} disabled={saving || (!file && !draft)}>{saving ? "Saving…" : "Save draft"}</Button><Button type="submit" disabled={saving || (!file && !draft)}>{saving ? "Publishing…" : "Publish to subgroup"}</Button></div></form></div></Dialog>;
}

function RecordingDetailDialog({ recording, groups, notify, onClose }: { recording: Recording; groups: Group[]; notify: (message: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<RecordingNote[]>([]);
  const group = groups.find((item) => item.id === recording.subgroup_id);
  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;
    void Promise.all([supabase.storage.from("recordings").createSignedUrl(recording.storage_path, 1800), supabase.from("recording_notes").select("*").eq("recording_id", recording.id).order("created_at")]).then(([fileResult, notesResult]) => { if (cancelled) return; if (fileResult.error || !fileResult.data) notify("This recording could not be opened"); else setUrl(fileResult.data.signedUrl); if (!notesResult.error) setNotes((notesResult.data || []) as RecordingNote[]); });
    return () => { cancelled = true; };
  }, [notify, recording]);
  async function openNote(note: RecordingNote) {
    if (!note.storage_path || !supabase) return;
    const { data, error } = await supabase.storage.from("recording-notations").createSignedUrl(note.storage_path, 900);
    if (error || !data) notify("This notation file could not be opened"); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  return <Dialog open onClose={onClose} className="recording-detail-dialog"><div className="studio-heading"><div><p className="eyebrow">{group?.name || "SUBGROUP"} · {recording.recording_kind}</p><h2>{recording.title}</h2><p>{[recording.raga, recording.tala, recording.sruthi, recording.tempo].filter(Boolean).join(" · ") || recording.description || "No musical details added yet."}</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close recording">×</Button></div>{url ? recording.media_kind === "video" ? <video className="recording-detail-video" src={url} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : <WaveformPlayer url={url} /> : <div className="recording-preview-loading">Loading the recording…</div>}<div className="recording-detail-meta"><span>{recording.description || "Shared with this subgroup"}</span><time>{formatDate(recording.published_at || recording.created_at)}</time></div><section className="notation-panel"><div className="notation-panel-heading"><div><p className="eyebrow">FOLLOW ALONG</p><h3>Notation and notes</h3></div><span>{notes.length}</span></div>{notes.length ? notes.map((note) => <article className="notation-item" key={note.id}>{note.note_type === "file" ? <button type="button" onClick={() => void openNote(note)}><span>▤</span>{note.title}<i>Open file →</i></button> : <><h4>{note.title}</h4><p>{note.body}</p></>}</article>) : <p className="notation-empty">No notation attached yet.</p>}</section></Dialog>;
}

function ShruthiCompanion() {
  const [tonic, setTonic] = useState(TONICS[0]);
  const [pattern, setPattern] = useState<"pa" | "ma">("pa");
  const [volume, setVolume] = useState(45);
  const [active, setActive] = useState(false);
  const synth = useRef<Tone.Synth | null>(null);
  const event = useRef<number | null>(null);
  const step = useRef(0);

  function stop() {
    if (event.current !== null) Tone.Transport.clear(event.current);
    event.current = null; Tone.Transport.stop(); synth.current?.triggerRelease(); synth.current?.dispose(); synth.current = null; setActive(false);
  }

  async function toggle() {
    if (active) { stop(); return; }
    await Tone.start();
    const nextSynth = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.08, decay: 0.7, sustain: 0.2, release: 1.2 } }).toDestination();
    nextSynth.volume.value = -34 + volume * 0.28; synth.current = nextSynth; step.current = 0;
    const fifth = pattern === "pa" ? tonic.frequency * 1.5 : tonic.frequency * 1.3335;
    const notes = [tonic.frequency, fifth, tonic.frequency * 2, fifth];
    event.current = Tone.Transport.scheduleRepeat((time) => { nextSynth.triggerAttackRelease(notes[step.current % notes.length], 1.25, time); step.current += 1; }, 1.5);
    Tone.Transport.start(); setActive(true);
  }

  useEffect(() => { if (synth.current) synth.current.volume.value = -34 + volume * 0.28; }, [volume]);
  useEffect(() => () => stop(), []);

  return <section className={`shruthi-companion ${active ? "active" : ""}`}><div className="shruthi-heading"><div><span className="shruthi-mark">Sa</span><div><strong>Sruthi companion</strong><small>Keep your tonic close while you record.</small></div></div><button type="button" onClick={() => void toggle()} className="shruthi-toggle">{active ? "Stop drone" : "Start drone"}</button></div><div className="shruthi-controls"><label><span>Sa</span><select value={tonic.label} onChange={(event) => { const next = TONICS.find((item) => item.label === event.target.value); if (next) { if (active) stop(); setTonic(next); } }}>{TONICS.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}</select></label><label><span>Pattern</span><select value={pattern} onChange={(event) => { const next = event.target.value as "pa" | "ma"; if (active) stop(); setPattern(next); }}><option value="pa">Sa · Pa · Sa</option><option value="ma">Sa · Ma · Sa</option></select></label><label className="shruthi-volume"><span>Volume</span><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label></div><p className="shruthi-note">Use headphones during recording so the drone does not bleed into the microphone.</p></section>;
}
