"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { formatDate } from "../../../lib/format";
import { Dialog } from "../../../components/ui/dialog";
import { ErrorBlock } from "../../../components/ui/error-block";
import { IconButton } from "../../../components/ui/icon-button";
import { PreviewDialog } from "../../../components/ui/preview-dialog";
import { useRecordingDetail } from "../hooks/use-recording-detail";
import type { Group, Recording, RecordingNote } from "../model";
import { RecordingManageBar } from "./recording-manage";
import { RecordingNotes } from "./recording-notes";
import { WaveformPlayer } from "./waveform-player";

/**
 * One recording: the player, its notation, and (for its owner or a manager) the controls to edit, archive or delete it. A notation file opens
 * in a preview over the recording (PreviewDialog) instead of in another tab.
 */
export function RecordingDetailDialog({ recording, user, canManage, groups, onChanged, onRemoved, onClose }: { recording: Recording; user: User; canManage: boolean; groups: Group[]; onChanged: () => void | Promise<void>; onRemoved: () => void | Promise<void>; onClose: () => void }) {
  const { url, urlFailed, retryUrl, notes, notesState, loadNotes, retryNotes, signNote } = useRecordingDetail(recording);
  const [previewing, setPreviewing] = useState<RecordingNote | null>(null);
  const group = groups.find((item) => item.id === recording.subgroup_id);
  return <Dialog open onClose={onClose} className="recording-detail-dialog">
    <div className="studio-heading"><div><p className="eyebrow">{group?.name || "SUBGROUP"} · {recording.recording_kind}</p><h2>{recording.title}</h2><p>{[recording.raga, recording.tala, recording.sruthi, recording.tempo].filter(Boolean).join(" · ") || recording.description || "No musical details added yet."}</p></div><IconButton onClick={onClose} aria-label="Close recording">×</IconButton></div>
    {url ? recording.media_kind === "video" ? <video className="recording-detail-video" src={url} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : <WaveformPlayer url={url} />
      : urlFailed ? <ErrorBlock role="alert" className="recording-preview-loading" message="This recording could not be opened." onRetry={retryUrl} />
      : <div className="recording-preview-loading" role="status">Loading the recording…</div>}
    <div className="recording-detail-meta"><span>{recording.description || "Shared with this subgroup"}</span><time>{formatDate(recording.published_at || recording.created_at)}</time></div>
    <RecordingNotes notes={notes} notesState={notesState} onRetry={retryNotes} user={user} canManage={canManage} onOpenNote={setPreviewing} onChanged={loadNotes} />
    <RecordingManageBar recording={recording} user={user} canManage={canManage} notes={notes} onChanged={onChanged} onRemoved={onRemoved} />
    <PreviewDialog open={previewing !== null} onClose={() => setPreviewing(null)} title={previewing?.title ?? ""} load={() => (previewing ? signNote(previewing) : Promise.reject(new Error("")))} />
  </Dialog>;
}
