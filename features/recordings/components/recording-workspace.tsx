"use client";

import { useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Button } from "../../../components/ui/button";
import { useRecordingsList } from "../hooks/use-recordings-list";
import { useSelectedRecording } from "../hooks/use-selected-recording";
import type { Group, Membership, Recording, Scope } from "../model";
import { RecordingDetailDialog } from "./recording-detail";
import { NoGroupsNotice, RecordingControls, RecordingList } from "./recording-list";
import { RecordingStudioDialog } from "./recording-studio";
import { TabPanel } from "./tab-list";

type WorkspaceProps = { user: User; groups: Group[]; memberships: Membership[]; canManage: boolean; initialScope?: Scope; onDataChanged?: () => void };

export function RecordingWorkspace({ user, groups, memberships, canManage, initialScope = "all", onDataChanged }: WorkspaceProps) {
  const activeGroups = useMemo(() => canManage ? groups : groups.filter((group) => memberships.some((membership) => membership.subgroup_id === group.id && membership.status === "active")), [canManage, groups, memberships]);
  // What is read (the list for the view, group and search in force) and what the person has open (the studio, one recording).
  const groupIds = useMemo(() => activeGroups.map((group) => group.id), [activeGroups]);
  const list = useRecordingsList({ userId: user.id, canManage, initialScope, groupIds });
  const { recordings, load } = list;
  const [studioOpen, setStudioOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Recording | null>(null);
  // The recording whose detail is open is in the address (?recording=<id>).
  const selected = useSelectedRecording({ recordings, loading: list.loading });

  function beginNewRecording() {
    setEditingDraft(null);
    setStudioOpen(true);
  }

  function openRecording(recording: Recording) {
    if (recording.status === "draft" && recording.uploaded_by === user.id) {
      setEditingDraft(recording);
      setStudioOpen(true);
    } else selected.open(recording.id);
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
      <TabPanel prefix="recording-view" value={list.view}>
        <RecordingList view={list.view} loading={list.loading} loadFailed={list.loadFailed} recordings={recordings} visible={list.visible} total={list.total} groups={groups}
          onLoad={() => void load()} onOpen={openRecording} onShowMore={list.showMore} onCreate={beginNewRecording} />
      </TabPanel>
    </>}

    {studioOpen && <RecordingStudioDialog user={user} groups={activeGroups} draft={editingDraft} onClose={() => { setStudioOpen(false); setEditingDraft(null); }} onSaved={async () => { setStudioOpen(false); setEditingDraft(null); await refresh(); }} />}
    {selected.recording && <RecordingDetailDialog key={selected.recording.id} recording={selected.recording} user={user} canManage={canManage} groups={groups} onChanged={async () => { await refresh(); selected.refresh(); }} onRemoved={async () => { selected.close(); await refresh(); }} onClose={selected.close} />}
  </section>;
}
