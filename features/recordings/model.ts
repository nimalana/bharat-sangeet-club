// What the recordings screens share: the shapes of a recording and its group, the tonics of the sruthi companion, and how a
// length is written. Pure (type-only imports): node loads this file in tests/recordings-model.test.mjs.
import type { Tables } from "../../lib/db";
import type { ManagedNote } from "./components/recording-manage";

export type Group = { id: number; name: string; description: string };
export type Membership = { subgroup_id: number; status: string };
export type RecordingAudience = "subgroup" | "club" | "public";
// media_kind and audience are text columns with a CHECK constraint, so the generated type is `string`; the UI knows the values.
export type Recording = Pick<Tables<"recordings">, "id" | "title" | "description" | "subgroup_id" | "uploaded_by" | "storage_path" | "mime_type" | "status" | "recording_kind"
  | "event_date" | "raga" | "tala" | "sruthi" | "tempo" | "duration_seconds" | "created_at" | "updated_at" | "published_at">
  & Partial<Pick<Tables<"recordings">, "storage_bucket">> & { media_kind: "audio" | "video"; audience: RecordingAudience };
export type RecordingNote = ManagedNote;
export type Scope = "all" | number;
/** The three lists of the workspace: what is published, my own drafts, what is archived. */
export type RecordingView = "published" | "drafts" | "archived";
/** Where the studio takes its take from. */
export type StudioMode = "upload" | "record-audio" | "record-video";

export const TONICS = [
  { label: "C", frequency: 130.81 }, { label: "C♯ / D♭", frequency: 138.59 }, { label: "D", frequency: 146.83 },
  { label: "D♯ / E♭", frequency: 155.56 }, { label: "E", frequency: 164.81 }, { label: "F", frequency: 174.61 },
  { label: "F♯ / G♭", frequency: 185 }, { label: "G", frequency: 196 }, { label: "G♯ / A♭", frequency: 207.65 },
  { label: "A", frequency: 220 }, { label: "A♯ / B♭", frequency: 233.08 }, { label: "B", frequency: 246.94 },
];

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Which of the loaded recordings the list shows. The server already filters by view, audience and search; this keeps what was
 * on screen right while a newer answer is on its way (drafts and archives are the viewer's own, unless they manage the club).
 */
export function visibleRecordings(recordings: Recording[], { view, scope, query, userId, canManage }: { view: RecordingView; scope: Scope; query: string; userId: string; canManage: boolean }) {
  return recordings.filter((recording) => {
    const matchesView = view === "drafts" ? recording.status === "draft" && recording.uploaded_by === userId : view === "archived" ? recording.status === "archived" && (canManage || recording.uploaded_by === userId) : recording.status === "published";
    const matchesScope = scope === "all" || recording.subgroup_id === scope;
    const haystack = `${recording.title} ${recording.description} ${recording.raga || ""} ${recording.tala || ""} ${recording.recording_kind}`.toLowerCase();
    return matchesView && matchesScope && haystack.includes(query.toLowerCase());
  });
}
