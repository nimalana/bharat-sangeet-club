"use client";

import { resourcesAvailable } from "../../../lib/api/resources";
import { IconButton } from "../../../components/ui/icon-button";
import type { ScopeFilter } from "../../../lib/db";
import type { LibraryTab, SortKey } from "../../../lib/resources-query";
import type { ResourceItem } from "../types";
import { ResourceIcon } from "./resource-icon";
import styles from "./resources.module.css";

// The title of the screen and the button that opens the add-resource panel.
export function ResourceHeading({ canAdd, onAdd }: { canAdd: boolean; onAdd: () => void }) {
  return <div className={styles.headingRow}>
      <div><p className={styles.kicker}>Club library</p><h1>Resources</h1><p className={styles.intro}>A shared shelf for rehearsal notes, repertoire, event material, and useful links.</p></div>
      <button className={styles.addButton} type="button" onClick={onAdd} disabled={!resourcesAvailable() || !canAdd} title={!canAdd ? "You need an executive or subgroup manager role to add here" : undefined}><ResourceIcon name="plus" size={16} /> Add resource</button>
    </div>;
}

// Search, audience, sort order, list or grid, and the archived view.
export function ResourceFilters({ query, onQueryChange, scope, availableGroups, onScopeChange, sort, onSortChange, display, onDisplayChange, hasArchived, showArchived, onToggleArchived }: {
  query: string; onQueryChange: (value: string) => void;
  scope: ScopeFilter; availableGroups: Array<{ id: number; name: string }>; onScopeChange: (scope: ScopeFilter) => void;
  sort: SortKey; onSortChange: (sort: SortKey) => void;
  display: "list" | "grid"; onDisplayChange: (display: "list" | "grid") => void;
  hasArchived: boolean; showArchived: boolean; onToggleArchived: () => void;
}) {
  return <div className={styles.toolbar}>
      <label className={styles.search}><ResourceIcon name="search" size={17} /><span className={styles.srOnly}>Search resources</span><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search title, filename, or description" /></label>
      <label className={styles.selectWrap}><span className={styles.srOnly}>Scope</span><select value={String(scope)} onChange={(event) => { const value = event.target.value; onScopeChange(value === "all" ? "all" : value === "club" ? "club" : Number(value)); }}><option value="all">All spaces</option><option value="club">Club-wide</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ResourceIcon name="chevron" size={15} /></label>
      <label className={styles.selectWrap}><span className={styles.srOnly}>Sort resources</span><select value={sort} onChange={(event) => onSortChange(event.target.value as SortKey)}><option value="updated">Recently updated</option><option value="created">Recently added</option><option value="name">Name</option><option value="event">Event date</option></select><ResourceIcon name="chevron" size={15} /></label>
      <div className={styles.viewToggle} role="group" aria-label="Display mode"><IconButton className={display === "list" ? styles.activeToggle : ""} onClick={() => onDisplayChange("list")} aria-label="List view" aria-pressed={display === "list"}><ResourceIcon name="list" size={17} /></IconButton><IconButton className={display === "grid" ? styles.activeToggle : ""} onClick={() => onDisplayChange("grid")} aria-label="Grid view" aria-pressed={display === "grid"}><ResourceIcon name="grid" size={17} /></IconButton></div>
      {(hasArchived || showArchived) && <button type="button" className={styles.secondaryButton} aria-pressed={showArchived} onClick={onToggleArchived}>{showArchived ? "Back to library" : "Show archived"}</button>}
    </div>;
}

// All, documents, links, photos; the open one shows how many items it holds once they are read.
export function ResourceTabs({ tab, onTabChange, total, loading }: { tab: LibraryTab; onTabChange: (tab: LibraryTab) => void; total: number | null; loading: boolean }) {
  return <nav className={styles.tabs} aria-label="Resource views">{(["all", "documents", "links", "photos"] as LibraryTab[]).map((value) => <button key={value} className={tab === value ? styles.activeTab : ""} onClick={() => onTabChange(value)} type="button" aria-pressed={tab === value}>{value[0].toUpperCase() + value.slice(1)}{tab === value && total !== null && !loading ? <> <span>{total}</span></> : null}</button>)}</nav>;
}

// Resources / Folder / Subfolder, the way back up, and the open folder's settings and audience.
export function ResourceBreadcrumb({ folderId, breadcrumb, currentFolder, showArchived, canSettings, scopeLabel, onOpenFolder, onFolderSettings }: {
  folderId: number | null; breadcrumb: ResourceItem[]; currentFolder: ResourceItem | null; showArchived: boolean;
  /** The folder is open, is not seen in the archived view, and the person may manage it: its settings are offered. */
  canSettings: boolean; scopeLabel: string;
  onOpenFolder: (id: number | null) => void; onFolderSettings: () => void;
}) {
  return <div className={styles.breadcrumbRow} role="group" aria-label="Folder path"><button type="button" onClick={() => onOpenFolder(null)} className={folderId === null ? styles.currentCrumb : ""} aria-current={folderId === null ? "location" : undefined}>Resources</button>{breadcrumb.map((crumb) => <span key={crumb.id} className={styles.crumb}><ResourceIcon name="chevron" size={13} /><button type="button" onClick={() => onOpenFolder(crumb.id)} className={crumb.id === folderId ? styles.currentCrumb : ""} aria-current={crumb.id === folderId ? "location" : undefined}>{crumb.title}</button></span>)}{currentFolder && canSettings ? <button type="button" onClick={onFolderSettings}>Folder settings</button> : null}<span className={styles.scopeHint}>{showArchived ? "Archived · " : ""}{scopeLabel}{currentFolder?.visibility === "executives" ? <><span className={styles.dot}>·</span><ResourceIcon name="lock" size={13} /></> : null}</span></div>;
}
