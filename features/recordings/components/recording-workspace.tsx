"use client";

import { useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Notify } from "../../../lib/toast";
import { Button } from "../../../components/ui/button";
import { useRecordingsList } from "../hooks/use-recordings-list";
import type { Group, Membership, Recording, Scope } from "../model";
import { RecordingDetailDialog } from "./recording-detail";
import { NoGroupsNotice, RecordingControls, RecordingList } from "./recording-list";
import { RecordingStudioDialog } from "./recording-studio";

type WorkspaceProps = { user: User; groups: Group[]; memberships: Membership[]; canManage: boolean; initialScope?: Scope; notify: Notify; onDataChanged?: () => void };

export function RecordingWorkspace({ user, groups, memberships, canManage, initialScope = "all", notify, onDataChanged }: WorkspaceProps) {
  const activeGroups = useMemo(() => canManage ? groups : groups.filter((group) => memberships.some((membership) => membership.subgroup_id === group.id && membership.status === "active")), [canManage, groups, memberships]);
  // What is read (the list for the view, group and search in force) and what the person has open (the studio, one recording).
  const list = useRecordingsList({ userId: user.id, canManage, initialScope, notify });
  const { recordings, load } = list;
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Recording | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);

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

    {!activeGroups.length ? <NoGroupsNotice /> : <>
      <RecordingControls view={list.view} query={list.query} scope={list.scope} groups={activeGroups} onView={list.chooseView} onQuery={list.setQuery} onScope={list.chooseScope} />
      <RecordingList view={list.view} loading={list.loading} loadFailed={list.loadFailed} recordings={recordings} visible={list.visible} total={list.total} groups={groups}
        onLoad={() => void load()} onOpen={openRecording} onShowMore={list.showMore} onCreate={beginNewRecording} />
    </>}

    {studioOpen && <RecordingStudioDialog user={user} groups={activeGroups} draft={editingDraft} notify={notify} onClose={() => { setStudioOpen(false); setEditingDraft(null); }} onSaved={async () => { setStudioOpen(false); setEditingDraft(null); await refresh(); }} />}
    {selectedRecording && <RecordingDetailDialog key={selectedRecording.id} recording={recordings.find((item) => item.id === selectedRecording.id) || selectedRecording} user={user} canManage={canManage} groups={groups} notify={notify} onChanged={refresh} onRemoved={async () => { setSelectedRecording(null); await refresh(); }} onClose={() => setSelectedRecording(null)} />}
  </section>;
}
