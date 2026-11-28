"use client";

import { formatDateOrNone } from "../../../lib/format";
import { isImageResource, type LibraryTab } from "../../../lib/resources-query";
import { ErrorBlock } from "../../../components/ui/error-block";
import { LoadErrorBanner } from "../../../components/ui/load-error";
import { SkeletonRows } from "../../../components/ui/skeleton";
import { formatBytes, itemIcon } from "../model";
import type { ResourceItem } from "../types";
import { ResourceIcon } from "./resource-icon";
import styles from "./resources.module.css";

// One row of the list (or tile of the grid): its picture or kind, name, a line about it, size and date.
function ResourceRow({ item, onOpen }: { item: ResourceItem; onOpen: (item: ResourceItem) => void }) {
  return <button type="button" className={styles.resourceRow} onClick={() => onOpen(item)}>
      {/* Signed Supabase URLs are short-lived and dynamic, so a native img is intentional here instead of next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.node_kind === "file" && isImageResource(item) && item.signedUrl ? <img src={item.signedUrl} alt="" className={styles.thumbnail} loading="lazy" decoding="async" /> : <div className={`${styles.typeIcon} ${item.node_kind === "folder" ? styles.folderIcon : ""}`}><ResourceIcon name={itemIcon(item)} size={20} /></div>}
      <div className={styles.resourceCopy}><div className={styles.resourceTitle}>{item.title}{item.is_pinned ? <span className={styles.pinned}>Pinned</span> : null}{item.status === "failed" ? <span className={styles.failedBadge}>Upload failed</span> : null}</div><p>{item.description || (item.node_kind === "folder" ? "Folder" : item.node_kind === "link" ? item.external_url : item.original_filename) || "No description"}</p></div>
      <div className={styles.resourceMeta}><span>{item.node_kind === "folder" ? "Folder" : item.node_kind === "link" ? "Link" : formatBytes(item.byte_size)}</span><span>{formatDateOrNone(item.updated_at)}</span></div><ResourceIcon name="arrow" size={17} /></button>;
}

// What the screen shows of the rows it has read: the rows, or why there are none (still reading, could not be read, nothing
// here), with the banner over rows that may be out of date and the button for the next page.
export function ResourceList({ items, loading, loadError, hasMore, loadingMore, search, showArchived, folderId, canAdd, display, tab, onOpenItem, onRetry, onClearSearch, onAddFirst, onShowMore }: {
  items: ResourceItem[]; loading: boolean; loadError: string; hasMore: boolean; loadingMore: boolean;
  /** What the database was asked to find (the search box after its pause). */
  search: string; showArchived: boolean; folderId: number | null; canAdd: boolean; display: "list" | "grid"; tab: LibraryTab;
  onOpenItem: (item: ResourceItem) => void; onRetry: () => void; onClearSearch: () => void; onAddFirst: () => void; onShowMore: () => void;
}) {
  return <>
    {!loading && loadError && items.length > 0 && <LoadErrorBanner message={`${loadError} What is shown may be out of date.`} onRetry={onRetry} />}
    {loading ? <SkeletonRows rows={5} label="Opening the library" className={styles.loadingList} /> : loadError && items.length === 0 ? <div className={styles.state}><div className={styles.stateIcon}><ResourceIcon name="refresh" size={22} /></div><h2>Something interrupted the shelf</h2><ErrorBlock role="alert" className={styles.stateMessage} message={loadError} onRetry={onRetry} /></div> : items.length === 0 ? <div className={styles.state}><div className={styles.stateIcon}><ResourceIcon name={search ? "search" : "folder"} size={23} /></div><h2>{showArchived ? "Nothing is archived here" : search ? "No matching resources" : folderId ? "This folder is ready for something" : "Your resource shelf is empty"}</h2><p>{search ? "Try a shorter search or clear the search field." : canAdd ? "Create a folder, add a useful link, or upload a set of files to get started." : "Resources shared with your membership will appear here."}</p>{search ? <button type="button" className={styles.secondaryButton} onClick={onClearSearch}>Clear search</button> : canAdd ? <button type="button" className={styles.secondaryButton} onClick={onAddFirst}><ResourceIcon name="plus" size={15} /> Add the first resource</button> : null}</div> : <div className={display === "grid" || tab === "photos" ? styles.resourceGrid : styles.resourceList}>{items.map((item) => <ResourceRow key={item.id} item={item} onOpen={onOpenItem} />)}</div>}
    {!loading && !loadError && hasMore ? <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}><button type="button" className={styles.secondaryButton} onClick={onShowMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}</button></div> : null}
  </>;
}
