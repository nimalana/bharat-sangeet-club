"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useMemo, useState } from "react";
import type { ClubRole, Tables } from "../../../lib/db";
import { PreviewDialog } from "../../../components/ui/preview-dialog";
import { canManageGroupResources, isExecutive } from "../../../lib/permissions";
import { useResourceForms } from "../hooks/use-resource-forms";
import { useResourceList } from "../hooks/use-resource-list";
import { useResourceSelection } from "../hooks/use-resource-selection";
import { useResourceUploads } from "../hooks/use-resource-uploads";
import type { ComposerMode, ResourceItem } from "../types";
import { ResourceComposer } from "./resource-composer";
import { ResourceDetailPanel } from "./resource-detail-panel";
import { ResourceList } from "./resource-list";
import { ResourceBreadcrumb, ResourceFilters, ResourceHeading, ResourceTabs } from "./resource-toolbar";
import styles from "./resources.module.css";

export type { ResourceItem } from "../types";

export type ResourceLibraryProps = {
  user: User;
  role: ClubRole;
  groups: Array<{ id: number; name: string }>;
  memberships: Array<Pick<Tables<"subgroup_memberships">, "subgroup_id" | "status" | "membership_role">>;
  events: Array<{ id: number; title: string; starts_at: string; subgroup_id: number | null }>;
  onResourceCountChange?: (count: number) => void;
  initialScope?: "all" | "club" | number;
};

export function ResourceLibrary({ user, role, groups, memberships, events, onResourceCountChange, initialScope = "all" }: ResourceLibraryProps) {
  const list = useResourceList({ userId: user.id, onResourceCountChange, initialScope });
  const { scope, setScope, folderId, changeFolder, crumbs, currentFolder, showArchived, refreshAll, addRow, replaceRow } = list;
  const [display, setDisplay] = useState<"list" | "grid">("list");
  const [composer, setComposer] = useState<ComposerMode>(null);
  const [composerError, setComposerError] = useState("");

  const activeMemberships = useMemo(() => new Set(memberships.filter((membership) => membership.status === "active").map((membership) => membership.subgroup_id)), [memberships]);
  const canManageClub = isExecutive(role);
  const availableGroups = canManageClub ? groups : groups.filter((group) => activeMemberships.has(group.id));
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const canManageSubgroup = useCallback((subgroupId: number | null) => Boolean(subgroupId && canManageGroupResources(role, memberships.filter((membership) => membership.subgroup_id === subgroupId))), [role, memberships]);
  const canWriteScope = useCallback((subgroupId: number | null) => subgroupId === null ? canManageClub : canManageSubgroup(subgroupId), [canManageClub, canManageSubgroup]);
  const canManageItem = (item: ResourceItem) => canManageClub || (item.visibility === "members" && canManageSubgroup(item.subgroup_id));

  const selection = useResourceSelection({ itemById: list.itemById, version: list.version, changeFolder, fetchOneFolder: list.fetchOneFolder, refreshAll, replaceRow });
  const { setSelected, selectedCurrent, previewing } = selection;

  const destinationScope = currentFolder ? currentFolder.subgroup_id : scope === "club" || scope === "all" ? null : scope;
  const canAdd = canWriteScope(destinationScope) && (folderId === null || currentFolder !== null);
  const destination = { userId: user.id, folderId, destinationScope, currentFolderVisibility: currentFolder?.visibility, canManageClub, canWriteScope, addRow, refreshAll, setComposer, setComposerError };
  const forms = useResourceForms(destination);
  const uploads = useResourceUploads({ ...destination, folderDepth: crumbs.length, replaceRow });

  function openComposer(mode: Exclude<ComposerMode, null>) {
    setComposerError("");
    setComposer(mode);
    if (mode === "files" || mode === "folder-upload") uploads.chooseMode(mode);
  }

  function closeComposer() {
    if (forms.saving || uploads.uploading) return;
    setComposer(null);
    setComposerError("");
    uploads.clearEntries();
  }

  const scopeLabel = scope === "all" ? "All spaces" : scope === "club" ? "Club-wide" : groupById.get(scope) || "Group";

  return <section className={styles.library} aria-label="Resources">
    <ResourceHeading canAdd={canAdd} onAdd={() => openComposer("menu")} />
    <ResourceFilters query={list.query} onQueryChange={list.setQuery} scope={scope} availableGroups={availableGroups} onScopeChange={(next) => { setScope(next); changeFolder(null); }}
      sort={list.sort} onSortChange={list.setSort} display={display} onDisplayChange={setDisplay}
      hasArchived={list.hasArchivedItems} showArchived={showArchived} onToggleArchived={() => { list.setShowArchived((value) => !value); changeFolder(null); }} />
    <ResourceTabs tab={list.tab} onTabChange={list.setTab} total={list.total} loading={list.loading} />
    <ResourceBreadcrumb folderId={folderId} breadcrumb={crumbs} currentFolder={currentFolder} showArchived={showArchived} canSettings={Boolean(currentFolder && !showArchived && canManageItem(currentFolder))}
      scopeLabel={scopeLabel} onOpenFolder={changeFolder} onFolderSettings={() => setSelected(currentFolder)} />
    <ResourceList items={list.visibleItems} loading={list.loading} loadError={list.loadError} hasMore={list.hasMore} loadingMore={list.loadingMore} search={list.search} showArchived={showArchived}
      folderId={folderId} canAdd={canAdd} display={display} tab={list.tab} onOpenItem={selection.openItem} onRetry={() => refreshAll()}
      onClearSearch={() => { list.setQuery(""); list.setSearch(""); }} onAddFirst={() => openComposer("menu")} onShowMore={() => void list.loadPage(true)} />
    {composer ? <ResourceComposer mode={composer} currentFolder={currentFolder} destinationScope={destinationScope} groupById={groupById} canManageClub={canManageClub}
      busy={forms.saving || uploads.uploading} error={composerError} forms={forms} uploads={uploads} onOpen={openComposer} onClose={closeComposer} /> : null}
    {selectedCurrent ? <ResourceDetailPanel item={selectedCurrent} location={selection.selectedLocation} groupById={groupById} events={events} canManage={canManageItem(selectedCurrent)} canManageClub={canManageClub}
      childCountState={selection.childCountState} onClose={() => setSelected(null)} onOpenFile={selection.openFile} onChanged={selection.afterChange}
      onRemoved={() => { const removedId = selectedCurrent.id; setSelected(null); if (folderId === removedId) changeFolder(selectedCurrent.parent_id); refreshAll(); }} /> : null}
    <PreviewDialog open={previewing !== null} onClose={() => selection.setPreviewing(null)} title={previewing?.title ?? ""} load={() => (previewing ? selection.previewFile(previewing) : Promise.reject(new Error("")))} />
  </section>;
}
