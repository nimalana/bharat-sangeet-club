"use client";

import type { User } from "@supabase/supabase-js";
import { formatDate } from "../../../lib/format";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { useRecordingDetail } from "../hooks/use-recording-detail";
import type { Group, Recording } from "../model";
import { RecordingManageBar } from "./recording-manage";
import { RecordingNotes } from "./recording-notes";
import { WaveformPlayer } from "./waveform-player";

/** One recording: the player, its notation, and (for its owner or a manager) the controls to edit, archive or delete it. */
export function RecordingDetailDialog({ recording, user, canManage, groups, onChanged, onRemoved, onClose }: { recording: Recording; user: User; canManage: boolean; groups: Group[]; onChanged: () => void | Promise<void>; onRemoved: () => void | Promise<void>; onClose: () => void }) {
  const { url, notes, loadNotes, openNote } = useRecordingDetail(recording);
  const group = groups.find((item) => item.id === recording.subgroup_id);
  return <Dialog open onClose={onClose} className="recording-detail-dialog"><div className="studio-heading"><div><p className="eyebrow">{group?.name || "SUBGROUP"} · {recording.recording_kind}</p><h2>{recording.title}</h2><p>{[recording.raga, recording.tala, recording.sruthi, recording.tempo].filter(Boolean).join(" · ") || recording.description || "No musical details added yet."}</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close recording">×</Button></div>{url ? recording.media_kind === "video" ? <video className="recording-detail-video" src={url} controls playsInline><track kind="captions" srcLang="en" label="Recording captions" /></video> : <WaveformPlayer url={url} /> : <div className="recording-preview-loading">Loading the recording…</div>}<div className="recording-detail-meta"><span>{recording.description || "Shared with this subgroup"}</span><time>{formatDate(recording.published_at || recording.created_at)}</time></div><RecordingNotes notes={notes} user={user} canManage={canManage} onOpenNote={(note) => void openNote(note)} onChanged={loadNotes} /><RecordingManageBar recording={recording} user={user} canManage={canManage} notes={notes} onChanged={onChanged} onRemoved={onRemoved} /></Dialog>;
}
