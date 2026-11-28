// The "Create folder" and "Add link" forms of the add-resource panel: what was typed (kept until the item is saved, also when the
// panel is closed and opened again) and what saving does. The panel itself (which form is open, its error) belongs to the screen.
import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { createResourceFolder, createResourceLink, resourcesAvailable } from "../../../lib/api/resources";
import type { ArchiveVisibility } from "../../../lib/db";
import { ApiError, toApiError } from "../../../lib/errors";
import { useToast } from "../../../components/ui/toast";
import { normalizeUrl } from "../model";
import type { ComposerMode, ResourceItem, Visibility } from "../types";

export type ResourceFormsOptions = {
  userId: string;
  /** The open folder, and where a new item goes. */
  folderId: number | null;
  destinationScope: number | null;
  currentFolderVisibility: ArchiveVisibility | undefined;
  canManageClub: boolean;
  canWriteScope: (subgroupId: number | null) => boolean;
  addRow: (item: ResourceItem) => void;
  refreshAll: () => void;
  setComposer: Dispatch<SetStateAction<ComposerMode>>;
  setComposerError: Dispatch<SetStateAction<string>>;
};

export function useResourceForms({ userId, folderId, destinationScope, currentFolderVisibility, canManageClub, canWriteScope, addRow, refreshAll, setComposer, setComposerError }: ResourceFormsOptions) {
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  // Both forms save one thing at a time: a second submit that lands before the button is disabled sends nothing.
  const saveInFlight = useRef(false);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderVisibility, setFolderVisibility] = useState<Visibility>("members");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkVisibility, setLinkVisibility] = useState<Visibility>("members");

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resourcesAvailable() || !canWriteScope(destinationScope) || saveInFlight.current) return;
    if (!folderTitle.trim()) { setComposerError("Give this folder a clear name."); return; }
    saveInFlight.current = true;
    setSaving(true);
    let data: ResourceItem | null = null;
    let error: ApiError | null = null;
    try { data = await createResourceFolder({ title: folderTitle.trim(), description: folderDescription.trim(), parentId: folderId, subgroupId: destinationScope, visibility: currentFolderVisibility || (canManageClub ? folderVisibility : "members"), userId }); } catch (caught) { error = toApiError(caught); }
    saveInFlight.current = false;
    setSaving(false);
    if (error || !data) { setComposerError(error?.message || "This folder could not be created."); return; }
    addRow(data); refreshAll();
    setFolderTitle(""); setFolderDescription(""); setComposer(null); notify("Folder created");
  }

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resourcesAvailable() || !canWriteScope(destinationScope) || saveInFlight.current) return;
    if (!linkTitle.trim()) { setComposerError("Give this link a clear title."); return; }
    let normalized: string;
    try { normalized = normalizeUrl(linkUrl); } catch { setComposerError("Enter a complete web address, such as docs.google.com/document/…"); return; }
    saveInFlight.current = true;
    setSaving(true);
    let data: ResourceItem | null = null;
    let error: ApiError | null = null;
    try { data = await createResourceLink({ title: linkTitle.trim(), description: linkDescription.trim(), parentId: folderId, subgroupId: destinationScope, visibility: currentFolderVisibility || (canManageClub ? linkVisibility : "members"), externalUrl: normalized, userId }); } catch (caught) { error = toApiError(caught); }
    saveInFlight.current = false;
    setSaving(false);
    if (error || !data) { setComposerError(error?.message || "This link could not be saved."); return; }
    addRow(data); refreshAll();
    setLinkTitle(""); setLinkUrl(""); setLinkDescription(""); setComposer(null); notify("Link added to Resources");
  }

  return {
    saving, createFolder, createLink,
    folder: { title: folderTitle, setTitle: setFolderTitle, description: folderDescription, setDescription: setFolderDescription, visibility: folderVisibility, setVisibility: setFolderVisibility },
    link: { title: linkTitle, setTitle: setLinkTitle, url: linkUrl, setUrl: setLinkUrl, description: linkDescription, setDescription: setLinkDescription, visibility: linkVisibility, setVisibility: setLinkVisibility },
  };
}
