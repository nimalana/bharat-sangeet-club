// Signs the thumbnails of what is on screen: one request per bucket, only for images with no fresh link in the cache. Opening any
// other file signs on click (ResourceSelection.openFile).
import { signResourceThumbnails } from "../../lib/api/resources";
import { readCache, writeCache } from "../../lib/cache";
import { isImageResource, thumbnailCacheKey, thumbnailExpiry, thumbnailsToSign, type ThumbnailEntry } from "../../lib/resources-query";
import type { ResourceItem } from "./types";

export async function attachThumbnails(userId: string, list: ResourceItem[]): Promise<ResourceItem[]> {
  const now = Date.now();
  const lookup = (key: string) => readCache<ThumbnailEntry>(userId, key);
  const toSign = thumbnailsToSign(list, lookup, now);
  await Promise.all([...toSign].map(async ([bucket, paths]) => {
    for (const entry of await signResourceThumbnails(bucket, paths)) if (entry.signedUrl && entry.path) writeCache<ThumbnailEntry>(userId, thumbnailCacheKey(bucket, entry.path), { url: entry.signedUrl, expires: thumbnailExpiry(now) });
  }));
  return list.map((item) => {
    if (!item.storage_path || item.node_kind !== "file" || !isImageResource(item)) return item;
    const hit = lookup(thumbnailCacheKey(item.storage_bucket || "club-resources", item.storage_path));
    return hit && hit.expires > now ? { ...item, signedUrl: hit.url } : item;
  });
}
