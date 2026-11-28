// Pure helpers behind the resource library's screen: how a size is written, what a file's place in storage is called, what kind a
// file is, what an upload batch says about itself. No React and no Supabase (the planner of the lists is lib/resources-query.ts).
import type { ResourceMediaKind } from "../../lib/db";
import { MAX_FOLDER_DEPTH, isImageResource } from "../../lib/resources-query";
import type { ResourceItem } from "./types";

export function formatBytes(bytes: number | null) {
  if (!bytes || bytes < 1) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// One folder or file name as it is written in storage: letters, digits, dot, underscore and dash.
export function safeSegment(value: string) {
  return value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

export function itemIcon(item: ResourceItem) {
  if (item.node_kind === "folder") return "folder" as const;
  if (item.node_kind === "link") return "link" as const;
  return isImageResource(item) ? "image" as const : "file" as const;
}

// A web address as the form takes it: https is assumed when no scheme is typed; anything but http and https is refused.
export function normalizeUrl(value: string) {
  const raw = value.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Links must use http or https");
  return url.toString();
}

// What kind of file this is, from its type and name.
export function mediaKindOf(file: Pick<File, "type" | "name">): ResourceMediaKind {
  return file.type.startsWith("image/") ? "image" : file.type.startsWith("text/") || file.type === "application/pdf" || Boolean(file.name.match(/\.(docx?|xlsx?|pptx?|csv)$/i)) ? "document" : "other";
}

// "Concert/Notes/a.pdf" is the file `a.pdf` inside the folders `Concert` and `Notes`.
export function splitRelativePath(relativePath: string): { folders: string[]; fileName: string | undefined } {
  const parts = relativePath.split("/").filter(Boolean);
  const fileName = parts.pop();
  return { folders: parts, fileName };
}

// Where a file of an upload batch is kept: the person, the batch, then its folders and its name, each written safely.
export function storagePathOf(userId: string, importId: string, folders: string[], fileName: string) {
  return `${userId}/${importId}/${folders.map(safeSegment).join("/")}${folders.length ? "/" : ""}${safeSegment(fileName)}`;
}

// How many folder levels the selection would add under the open folder, at most.
export function deepestFolderLevel(relativePaths: string[]) {
  return relativePaths.reduce((deepest, relativePath) => Math.max(deepest, splitRelativePath(relativePath).folders.length), 0);
}

// The sentence for a selection that would make the tree deeper than the database allows, or null when it fits.
export function tooDeepMessage(destinationFolderDepth: number, deepestSelection: number): string | null {
  if (destinationFolderDepth + deepestSelection <= MAX_FOLDER_DEPTH) return null;
  return `This selection would create more than three folder levels (destination is already ${destinationFolderDepth} level${destinationFolderDepth === 1 ? "" : "s"} deep). Choose a shallower folder or a less nested selection.`;
}

export const uploadBatchName = (files: Array<Pick<File, "name">>) => files.length === 1 ? files[0].name : `${files.length} uploaded resources`;

// How a finished batch is recorded.
export const uploadBatchStatus = (completed: number, failed: number) => failed ? (completed > 0 ? "partial" as const : "failed" as const) : "completed" as const;

const files = (count: number) => `${count} file${count === 1 ? "" : "s"}`;
export const uploadFailedSentence = (failed: number) => `${files(failed)} failed. You can retry the failed rows after checking their error details.`;
export const uploadToastMessage = (completed: number, failed: number) => failed ? `${files(completed)} uploaded; ${failed} failed` : `${files(completed)} uploaded`;
