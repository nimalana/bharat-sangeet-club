// Writes entries back out as CSS text: one rule per line, consecutive rules with the same @media wrapped once.
import { entryText } from "./stylesheet.mjs";

/** The text of a list of entries (kept in the order given). `annotate` adds a comment where the area changes. */
export function renderEntries(entries, { annotate = false } = {}) {
  const lines = [];
  let openMedia = null;
  const close = () => {
    if (openMedia !== null) lines.push("}");
    openMedia = null;
  };
  let lastArea = null;
  for (const entry of entries) {
    const comment = entry.comment ? entry.comment.trimEnd() : "";
    if (annotate && entry.area !== lastArea) {
      close();
      lines.push(`/* ${entry.area} */`);
      lastArea = entry.area;
    }
    if (comment) close();
    if (comment) lines.push(comment);
    if (entry.layer) {
      close();
      lines.push(entryText(entry));
    } else if (entry.media) {
      if (openMedia !== entry.media) {
        close();
        lines.push(`@media ${entry.media}{`);
        openMedia = entry.media;
      }
      lines.push(entry.raw);
    } else {
      close();
      lines.push(entry.raw);
    }
  }
  close();
  return lines.join("\n");
}
