"use client";

import { formatDateOrNone } from "../../../lib/format";
import { isImageResource } from "../../../lib/resources-query";
import { formatBytes, itemIcon } from "../model";
import type { ResourceItem } from "../types";
import { ResourceActions } from "./resource-actions";
import { ResourceIcon } from "./resource-icon";
import styles from "./resources.module.css";

// The side panel of one item: what it is and where it sits, opening it, and the controls of someone who manages it.
export function ResourceDetailPanel({ item, location, groupById, events, canManage, canManageClub, childCountState, onClose, onOpenFile, onChanged, onRemoved }: {
  item: ResourceItem;
  /** The folders above the item, top first. */
  location: ResourceItem[];
  groupById: ReadonlyMap<number, string>;
  events: Array<{ id: number; title: string }>;
  /** The person may change this item (the database enforces it either way). */
  canManage: boolean;
  canManageClub: boolean;
  /** How many items the folder holds, once it has been asked. */
  childCountState: { id: number; count: number } | null;
  onClose: () => void;
  onOpenFile: (item: ResourceItem) => Promise<void>;
  onChanged: () => void | Promise<void>;
  onRemoved: () => void | Promise<void>;
}) {
  return <div className={styles.scrim} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={styles.detailPanel} role="dialog" aria-modal="true" aria-labelledby="resource-detail-title"><div className={styles.panelHeader}><div><p className={styles.kicker}>{item.node_kind === "folder" ? "Collection" : item.node_kind === "link" ? "Saved link" : "Resource detail"}</p><h2 id="resource-detail-title">{item.title}</h2></div><button type="button" className={styles.iconButton} onClick={() => onClose()} aria-label="Close resource details"><ResourceIcon name="close" size={18} /></button></div>{item.node_kind === "file" && isImageResource(item) && item.signedUrl ? <img className={styles.detailImage} src={item.signedUrl} alt={item.title} /> : <div className={styles.detailIcon}><ResourceIcon name={itemIcon(item)} size={32} /></div>}<dl className={styles.detailList}><div><dt>Location</dt><dd>{location.map((crumb) => crumb.title).join(" / ") || "Resources"}</dd></div><div><dt>Scope</dt><dd>{item.subgroup_id === null ? "Club-wide" : groupById.get(item.subgroup_id) || "Group"}{item.visibility === "executives" ? <span className={styles.privateLabel}><ResourceIcon name="lock" size={13} /> Executives only</span> : null}</dd></div><div><dt>Updated</dt><dd>{formatDateOrNone(item.updated_at)}</dd></div><div><dt>Format</dt><dd>{item.mime_type || (item.node_kind === "link" ? "Web link" : item.node_kind)}</dd></div>{item.byte_size ? <div><dt>Size</dt><dd>{formatBytes(item.byte_size)}</dd></div> : null}{item.event_id ? <div><dt>Event</dt><dd>{events.find((event) => event.id === item.event_id)?.title || "Related club event"}</dd></div> : null}</dl>{item.description ? <p className={styles.detailDescription}>{item.description}</p> : null}{item.node_kind === "folder" ? null : <button type="button" className={styles.primaryButton} onClick={() => void onOpenFile(item)} disabled={item.status !== "ready" && !(item.status === "archived" && canManage)}>{item.node_kind === "link" ? <><ResourceIcon name="external" size={16} /> Open link</> : <><ResourceIcon name="arrow" size={16} /> Open file</>}</button>}{item.status === "failed" ? <p className={styles.formError}>This upload failed. Discard it below and upload the file again.</p> : null}{<ResourceActions key={item.id} item={item} canManage={canManage} isExecutive={canManageClub} childCount={item.node_kind !== "folder" ? 0 : childCountState?.id === item.id ? childCountState.count : 1} onChanged={onChanged} onRemoved={onRemoved} />}</aside></div>;
}
