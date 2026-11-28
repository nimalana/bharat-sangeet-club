// The breadcrumb: the open folder and its ancestors, fetching only what is missing. A folder that cannot be found (it was deleted, is
// archived outside the archived view, or cannot be read) sends the library back to the top with a toast.
import { useEffect, useMemo, useState } from "react";
import { readCache, writeCache } from "../../../lib/cache";
import { crumbCacheKey, resolveFolderChain } from "../../../lib/resources-query";
import type { Notify } from "../../../lib/toast";
import type { ResourceItem } from "../types";

export type ResourceBreadcrumbOptions = {
  userId: string;
  notify: Notify;
  folderId: number | null;
  /** Bumped after any change: the chain is read again. */
  version: number;
  showArchived: boolean;
  /** The rows on screen: ancestors among them are not fetched again. */
  items: ResourceItem[];
  changeFolder: (next: number | null) => void;
  fetchOneFolder: (id: number) => Promise<ResourceItem | null>;
};

export function useResourceBreadcrumb({ userId, notify, folderId, version, showArchived, items, changeFolder, fetchOneFolder }: ResourceBreadcrumbOptions) {
  const [crumbState, setCrumbState] = useState<ResourceItem[]>([]);
  // Everything on screen that is known by id: the rows and the open folder's ancestors.
  const itemById = useMemo(() => new Map([...crumbState, ...items].map((item) => [item.id, item])), [crumbState, items]);

  useEffect(() => {
    if (folderId === null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const cachedChain = readCache<ResourceItem[]>(userId, crumbCacheKey(folderId));
      if (cachedChain) setCrumbState(cachedChain);
      const known = new Map(itemById);
      const chain = await resolveFolderChain(folderId, known, fetchOneFolder);
      if (cancelled) return;
      const found = chain[chain.length - 1];
      if (!found || found.id !== folderId || (found.status === "archived" && !showArchived)) {
        notify("That folder could not be found");
        changeFolder(null);
        return;
      }
      writeCache(userId, crumbCacheKey(folderId), chain);
      setCrumbState(chain);
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, version]);

  // The open folder with its ancestors, once it has been read; empty while another folder's chain is still shown.
  const crumbs = useMemo(() => folderId !== null && crumbState.length && crumbState[crumbState.length - 1].id === folderId ? crumbState : [], [crumbState, folderId]);
  const currentFolder = crumbs.length ? crumbs[crumbs.length - 1] : null;

  return { itemById, crumbs, currentFolder };
}
