import { cn } from "../../lib/utils";
import { Button } from "./button";

// One row per file that is being uploaded: its name, what it is doing (waiting, uploading with a bar, saving, uploaded, failed with a
// Retry button). It draws; the screen owns the list and updates it as uploadWithProgress (lib/api/_core.ts) reports.
//
//   const [uploads, setUploads] = useState<UploadItem[]>([]);
//   const patch = (id: string, change: Partial<UploadItem>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u)));
//   async function send(item: UploadItem, file: File) {
//     patch(item.id, { status: "uploading", loaded: 0, total: file.size, error: undefined });
//     const answer = await uploadWithProgress(client, "recordings", path, file, {}, (p) => patch(item.id, p));
//     patch(item.id, answer.error ? { status: "failed", error: friendlyError(answer.error) } : { status: "done" });
//   }
//   <UploadProgress items={uploads} onRetry={(id) => send(uploads.find((u) => u.id === id)!, filesById[id])} />
//
// For a screen reader: the list is named (`label`); every row has a status that is spoken only when the state changes (not at every
// percent), a progressbar with its value while bytes are on the way, and a Retry button named after the file.

type UploadStatus = "waiting" | "uploading" | "done" | "failed";
/** `loaded` and `total` are the bytes uploadWithProgress reports; `error` is the sentence a failed upload shows. */
export type UploadItem = { id: string; name: string; status: UploadStatus; loaded?: number; total?: number; error?: string };

/** How far an upload is, 0 to 99. 100 is "uploaded", which only the server's answer can say, so the bar never claims it before. */
export function uploadPercent({ loaded = 0, total = 0 }: Pick<UploadItem, "loaded" | "total">): number {
  return total > 0 ? Math.min(99, Math.max(0, Math.floor((loaded / total) * 100))) : 0;
}

function UploadRow({ item, onRetry }: { item: UploadItem; onRetry?: (id: string) => void }) {
  const uploading = item.status === "uploading";
  const percent = uploadPercent(item);
  // Every byte has left but the server has not answered yet: the file is being stored.
  const saving = uploading && (item.total ?? 0) > 0 && (item.loaded ?? 0) >= (item.total ?? 0);
  const state = item.status === "waiting" ? "Waiting"
    : item.status === "done" ? "Uploaded"
    : item.status === "failed" ? (item.error ? `Failed: ${item.error}` : "Failed")
    : saving ? "Saving" : "Uploading";
  return <li className="upload-item" data-status={item.status}>
    <span className="upload-name">{item.name}</span>
    <span className="upload-state" role="status">{state}</span>
    {uploading && <>
      <div className="upload-bar" role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={saving ? "Saving" : `${percent}%`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {!saving && <span className="upload-percent" aria-hidden="true">{percent}%</span>}
    </>}
    {item.status === "failed" && onRetry && <Button size="sm" variant="secondary" className="upload-retry" aria-label={`Retry ${item.name}`} onClick={() => onRetry(item.id)}>Retry</Button>}
  </li>;
}

export function UploadProgress({ items, onRetry, label = "Uploads", className }: { items: UploadItem[]; onRetry?: (id: string) => void; label?: string; className?: string }) {
  if (!items.length) return null;
  return <ul aria-label={label} className={cn("upload-list", className)}>
    {items.map((item) => <UploadRow key={item.id} item={item} onRetry={onRetry} />)}
  </ul>;
}
