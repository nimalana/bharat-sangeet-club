"use client";

import { Button } from "../../../components/ui/button";
import { UploadProgress, type UploadItem } from "../../../components/ui/upload-progress";
import type { RecordingFields } from "../hooks/use-recording-fields";
import type { Group } from "../model";

/** The right column of the studio: the details of the recording, the notation to attach, and the two ways to save. */
export function StudioForm({ fields, groups, saving, canSave, uploads = [], onRetry, onSave }: {
  fields: RecordingFields; groups: Group[]; saving: boolean;
  /** A take is there: a file was chosen or recorded, or a draft is being finished. */
  canSave: boolean;
  /** The files of this save and how far each got (the take, the notation file). */
  uploads?: UploadItem[];
  onRetry?: () => void;
  onSave: (status: "draft" | "published") => void;
}) {
  const { title, setTitle, description, setDescription, groupId, setGroupId, recordingKind, setRecordingKind, raga, setRaga, tala, setTala, sruthi, setSruthi, tempo, setTempo, notationText, setNotationText, notationFile, setNotationFile } = fields;
  return <form className="studio-form" onSubmit={(event) => { event.preventDefault(); onSave("published"); }}><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Wednesday rehearsal, varnam take 2" required /></label><label>Subgroup<select value={groupId} onChange={(event) => setGroupId(Number(event.target.value))}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><div className="form-pair"><label>Recording type<select value={recordingKind} onChange={(event) => setRecordingKind(event.target.value)}><option value="practice">Practice</option><option value="rehearsal">Rehearsal</option><option value="lesson">Lesson</option><option value="performance">Performance</option><option value="workshop">Workshop</option></select></label><label>Tempo / laya<input value={tempo} onChange={(event) => setTempo(event.target.value)} placeholder="Madhyama, 96 bpm" /></label></div><div className="form-pair"><label>Raga / raag<input value={raga} onChange={(event) => setRaga(event.target.value)} placeholder="Bhairavi / Bhairav" /></label><label>Tala / taal<input value={tala} onChange={(event) => setTala(event.target.value)} placeholder="Adi / Teentaal" /></label></div><div className="form-pair"><label>Sruthi / tonic<input value={sruthi} onChange={(event) => setSruthi(event.target.value)} placeholder="C, D, or 1 kattai" /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What should the group listen for?" /></label></div><label>Notation text<textarea value={notationText} onChange={(event) => setNotationText(event.target.value)} rows={5} placeholder="Add lyrics, sahitya, swara, sargam, bols, or rehearsal notes" /></label><label className="notation-file-input">Notation file<input type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" onChange={(event) => setNotationFile(event.target.files?.[0] || null)} /><small>{notationFile ? notationFile.name : "Optional PDF, DOC, DOCX, image, or text file"}</small></label><div className="studio-publish-note"><span className="scope-dot" /> Publishing shares this recording with <strong>{groups.find((group) => group.id === groupId)?.name || "your subgroup"}</strong> only.</div><UploadProgress items={uploads} label="Files being uploaded" onRetry={saving ? undefined : onRetry} /><div className="studio-actions"><Button variant="secondary" type="button" onClick={() => onSave("draft")} disabled={saving || !canSave}>{saving ? "Saving…" : "Save draft"}</Button><Button type="submit" disabled={saving || !canSave}>{saving ? "Publishing…" : "Publish to subgroup"}</Button></div></form>;
}
