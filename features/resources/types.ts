// The shapes the resource library's parts share (the screen, its hooks and its panels).
import type { ResourceRow } from "../../lib/api/resources";

// A library row as RESOURCE_FIELDS reads it (every column but `metadata`), plus the signed link the screen attaches.
export type ResourceItem = ResourceRow & { signedUrl?: string };

export type ComposerMode = "menu" | "folder" | "link" | "files" | "folder-upload" | null;

// One file of an upload batch and where it stands.
export type UploadEntry = { file: File; relativePath: string; state: "queued" | "uploading" | "ready" | "failed"; error?: string };

// What a list reads when it is cached for the person (lib/cache.ts), so a folder they left shows at once when they come back.
export type ListSnapshot = { rows: ResourceItem[]; hasMore: boolean; total: number | null; fetched: number };

export type Visibility = "members" | "executives";
