"use client";

import type { User } from "@supabase/supabase-js";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { useRecordingFields } from "../hooks/use-recording-fields";
import { useRecordingMedia } from "../hooks/use-recording-media";
import { useRecordingSave } from "../hooks/use-recording-save";
import type { Group, Recording } from "../model";
import { StudioCapture } from "./studio-capture";
import { StudioForm } from "./studio-form";

/** Capture or upload a take, describe it, attach notation, and save it as a draft or publish it to the subgroup. */
export function RecordingStudioDialog({ user, groups, draft, onClose, onSaved }: { user: User; groups: Group[]; draft: Recording | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const media = useRecordingMedia(draft);
  const fields = useRecordingFields(draft, groups);
  const { saving, save } = useRecordingSave({ user, draft, fields, file: media.file, mediaKind: media.mediaKind, recordingSeconds: media.recordingSeconds, onSaved });

  return <Dialog open onClose={onClose} className="recording-studio-dialog"><div className="studio-heading"><div><p className="eyebrow">{draft ? "RETURN TO DRAFT" : "NEW SUBGROUP RECORDING"}</p><h2>{draft ? "Finish this recording" : "Recording studio"}</h2><p>{draft ? "Review your take, add notes, and publish it when the subgroup is ready to hear it." : "Capture a rehearsal or upload a take without leaving the subgroup workspace."}</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close recording studio">×</Button></div>
    <div className="studio-layout">
      <StudioCapture media={media} draft={draft} />
      <StudioForm fields={fields} groups={groups} saving={saving} canSave={Boolean(media.file || draft)} onSave={(status) => void save(status)} />
    </div></Dialog>;
}
