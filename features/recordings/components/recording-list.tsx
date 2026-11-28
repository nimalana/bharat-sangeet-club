"use client";

import { formatDate } from "../../../lib/format";
import { Button } from "../../../components/ui/button";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { formatDuration, type Group, type Recording, type RecordingView, type Scope } from "../model";

/** Shown instead of the list when the person belongs to no subgroup (and does not manage the club). */
export function NoGroupsNotice() {
  return <div className="recording-empty-state"><span className="recording-empty-mark">♪</span><div><h2>Join a subgroup to start recording</h2><p>Your recordings belong to a subgroup. Join or request access from the Groups page, then come back here.</p></div></div>;
}

/** The view tabs, the search box and the group picker. */
export function RecordingControls({ view, query, scope, groups, onView, onQuery, onScope }: {
  view: RecordingView; query: string; scope: Scope; groups: Group[];
  onView: (view: RecordingView) => void; onQuery: (query: string) => void; onScope: (scope: Scope) => void;
}) {
  return <div className="recording-controls">
    <div className="recording-tabs" role="tablist" aria-label="Recording views">
      <button className={view === "published" ? "active" : ""} role="tab" aria-selected={view === "published"} onClick={() => onView("published")}>Published</button>
      <button className={view === "drafts" ? "active" : ""} role="tab" aria-selected={view === "drafts"} onClick={() => onView("drafts")}>My drafts</button>
      <button className={view === "archived" ? "active" : ""} role="tab" aria-selected={view === "archived"} onClick={() => onView("archived")}>Archived</button>
    </div>
    <label className="recording-search"><span aria-hidden="true">⌕</span><input aria-label="Search recordings" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search title, raga, tala, or type" /></label>
    <label className="scope-picker recording-scope-picker"><span>Group</span><select value={scope === "all" ? "all" : String(scope)} onChange={(event) => onScope(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All my groups</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
  </div>;
}

function RecordingCard({ recording, index, view, group, onOpen }: { recording: Recording; index: number; view: RecordingView; group: Group | undefined; onOpen: (recording: Recording) => void }) {
  return <button className="recording-card" type="button" onClick={() => onOpen(recording)}>
    <span className="recording-card-index">{String(index + 1).padStart(2, "0")}</span>
    <span className={`recording-card-icon ${recording.media_kind}`} aria-hidden="true">{recording.media_kind === "video" ? "▣" : "◖"}</span>
    <span className="recording-card-main"><strong>{recording.title}</strong><small>{group?.name || "Subgroup"} · {recording.recording_kind} · {formatDuration(recording.duration_seconds)}</small><span>{[recording.raga, recording.tala, recording.sruthi].filter(Boolean).join(" · ") || recording.description || "No musical details added yet"}</span></span>
    <span className="recording-card-status">{view === "drafts" ? "Draft" : view === "archived" ? "Archived" : recording.media_kind === "video" ? "Video" : "Audio"}</span>
    <span className="recording-card-date">{formatDate(recording.published_at || recording.created_at)}</span>
    <span className="recording-card-arrow" aria-hidden="true">→</span>
  </button>;
}

function EmptyList({ view, onCreate }: { view: RecordingView; onCreate: () => void }) {
  return <div className="recording-empty-state compact"><span className="recording-empty-mark">{view === "drafts" ? "✎" : "♪"}</span><div><h2>{view === "drafts" ? "No drafts yet" : view === "archived" ? "Nothing archived in this view" : "No published recordings in this view"}</h2><p>{view === "drafts" ? "Start a rehearsal capture or upload a take. You can return to it before publishing." : view === "archived" ? "Archived recordings stay here until they are restored or deleted." : "Be the first person in your subgroup to publish a rehearsal or performance take."}</p><Button variant="secondary" onClick={onCreate}>Create the first recording</Button></div></div>;
}

/** The refresh banner, then the loading lines, the cards with "Show more", or the empty state. */
export function RecordingList({ view, loading, loadFailed, recordings, visible, total, groups, onLoad, onOpen, onShowMore, onCreate }: {
  view: RecordingView; loading: boolean; loadFailed: boolean; recordings: Recording[]; visible: Recording[]; total: number; groups: Group[];
  onLoad: () => void; onOpen: (recording: Recording) => void; onShowMore: () => void; onCreate: () => void;
}) {
  return <>
    {!loading && loadFailed && <LoadErrorBanner message={recordings.length ? "The list could not be refreshed, so it may be out of date." : "The recordings could not be loaded."} onRetry={onLoad} />}
    {loading ? <div className="recording-loading"><span className="recording-loading-line" /><span className="recording-loading-line" /><span className="recording-loading-line" /></div> : visible.length ? <div className="recording-list recording-list-new">{visible.map((recording, index) =>
      <RecordingCard key={recording.id} recording={recording} index={index} view={view} group={groups.find((item) => item.id === recording.subgroup_id)} onOpen={onOpen} />)}
      {total > recordings.length && <button type="button" className="recording-load-more" onClick={onShowMore}>Show more ({total - recordings.length} more)</button>}</div> : loadFailed ? null : <EmptyList view={view} onCreate={onCreate} />}
  </>;
}
