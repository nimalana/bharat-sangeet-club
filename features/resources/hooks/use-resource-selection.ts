// The item whose details are open in the side panel: where it sits in the folder tree, how many items a folder holds, opening it
// (a folder is entered, a file or link is opened), and reading it again after a change made to it.
import { useEffect, useMemo, useState } from "react";
import { countFolderChildren, resourcesAvailable, signResourceFile } from "../../../lib/api/resources";
import { chainFromKnown, resolveFolderChain } from "../../../lib/resources-query";
import type { Notify } from "../../../lib/toast";
import type { ResourceItem } from "../types";

export type ResourceSelectionOptions = {
  itemById: ReadonlyMap<number, ResourceItem>;
  /** Bumped after any change: the child count is asked again. */
  version: number;
  notify: Notify;
  changeFolder: (next: number | null) => void;
  fetchOneFolder: (id: number) => Promise<ResourceItem | null>;
  refreshAll: () => void;
  replaceRow: (id: number, change: (item: ResourceItem) => ResourceItem) => void;
};

export function useResourceSelection({ itemById, version, notify, changeFolder, fetchOneFolder, refreshAll, replaceRow }: ResourceSelectionOptions) {
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [childCountState, setChildCountState] = useState<{ id: number; count: number } | null>(null);
  const [selectedChain, setSelectedChain] = useState<{ id: number; chain: ResourceItem[] } | null>(null);

  // Where the selected item sits, resolved from what is known and fetched only when it is not.
  useEffect(() => {
    if (!selected || selected.parent_id === null) return;
    const parentId = selected.parent_id;
    const known = chainFromKnown(parentId, itemById);
    if (known) return;
    let cancelled = false;
    void resolveFolderChain(parentId, itemById, fetchOneFolder).then((chain) => { if (!cancelled) setSelectedChain({ id: selected.id, chain }); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.parent_id]);
  const selectedLocation = useMemo(() => {
    if (!selected || selected.parent_id === null) return [];
    return chainFromKnown(selected.parent_id, itemById) || (selectedChain?.id === selected.id ? selectedChain.chain : []);
  }, [itemById, selected, selectedChain]);

  // A folder's contents are not loaded, so how many it holds is asked on its own.
  const selectedFolderId = selected?.node_kind === "folder" ? selected.id : null;
  useEffect(() => {
    if (!resourcesAvailable() || selectedFolderId === null) return;
    let cancelled = false;
    countFolderChildren(selectedFolderId).then((count) => {
      if (!cancelled) setChildCountState({ id: selectedFolderId, count: count || 0 });
    }, () => { /* a count that cannot be read leaves the folder as "not empty" */ });
    return () => { cancelled = true; };
  }, [selectedFolderId, version]);

  const selectedCurrent = selected ? itemById.get(selected.id) || selected : null;

  function openItem(item: ResourceItem) {
    if (item.node_kind === "folder" && item.status !== "archived") { changeFolder(item.id); setSelected(null); return; }
    setSelected(item);
  }

  async function openFile(item: ResourceItem) {
    if (item.node_kind === "link" && item.external_url) { window.open(item.external_url, "_blank", "noopener,noreferrer"); return; }
    if (!resourcesAvailable() || !item.storage_path) return;
    // Open the tab during the click, before waiting for the link, so browsers
    // that block pop-ups opened after a delay still allow it.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const signed = await signResourceFile(item.storage_bucket || "club-resources", item.storage_path);
    if (!signed) { tab?.close(); notify("This resource could not be opened"); return; }
    if (tab) tab.location.replace(signed); else window.location.assign(signed);
  }

  // After an action on the selected item: read it again, then the lists.
  async function afterChange() {
    const id = selected?.id;
    refreshAll();
    if (id === undefined) return;
    const fresh = await fetchOneFolder(id);
    if (fresh) { setSelected(fresh); replaceRow(id, () => fresh); }
  }

  return { selected, setSelected, selectedCurrent, selectedLocation, childCountState, openItem, openFile, afterChange };
}
