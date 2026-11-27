// A code-split screen can fail to load: a deploy replaced the file while the
// page was open, or the connection dropped. Retrying the render cannot help,
// because React keeps the failed import; only a fresh page load does.
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  const text = typeof message === "string" ? message : "";
  return /loading chunk [\w-]+ failed|loading css chunk|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load chunk/i.test(text);
}
