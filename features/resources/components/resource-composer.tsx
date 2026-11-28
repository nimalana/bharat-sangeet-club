"use client";

import { useEffect, useRef } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { useResourceForms } from "../hooks/use-resource-forms";
import { useResourceUploads } from "../hooks/use-resource-uploads";
import type { ComposerMode, ResourceItem, Visibility } from "../types";
import { ResourceIcon } from "./resource-icon";
import { ResourceUploadPanel } from "./resource-upload-panel";
import styles from "./resources.module.css";

function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Saving…" : "Save resource"}</button></div>;
}

type NodeForm = { title: string; setTitle: (value: string) => void; description: string; setDescription: (value: string) => void; visibility: Visibility; setVisibility: (value: Visibility) => void };
type FormProps = { saving: boolean; hasOpenFolder: boolean; canManageClub: boolean; onSubmit: NonNullable<React.ComponentProps<"form">["onSubmit"]>; onCancel: () => void };

// "Create folder": a name, what belongs here, and who may see it (a folder inside another keeps that folder's visibility).
function FolderForm({ form, saving, hasOpenFolder, canManageClub, onSubmit, onCancel }: FormProps & { form: NodeForm }) {
  return <form className={styles.form} onSubmit={onSubmit}><label>Folder name<input value={form.title} onChange={(event) => form.setTitle(event.target.value)} maxLength={160} placeholder="e.g. Fall concert planning" /></label><label>Description <span className={styles.optional}>Optional</span><textarea value={form.description} onChange={(event) => form.setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="What belongs here?" /></label><label>Visibility<select value={form.visibility} disabled={hasOpenFolder} onChange={(event) => form.setVisibility(event.target.value as Visibility)}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label><FormActions saving={saving} onCancel={onCancel} /></form>;
}

// "Add link": a title, a web address, what it is for, and who may see it.
function LinkForm({ form, saving, hasOpenFolder, canManageClub, onSubmit, onCancel }: FormProps & { form: NodeForm & { url: string; setUrl: (value: string) => void } }) {
  return <form className={styles.form} onSubmit={onSubmit}><label>Link title<input value={form.title} onChange={(event) => form.setTitle(event.target.value)} maxLength={160} placeholder="e.g. Repertoire spreadsheet" /></label><label>Web address<input value={form.url} onChange={(event) => form.setUrl(event.target.value)} inputMode="url" placeholder="https://…" /></label><label>Description <span className={styles.optional}>Optional</span><textarea value={form.description} onChange={(event) => form.setDescription(event.target.value)} maxLength={1000} rows={3} placeholder="A sentence of context helps later." /></label><label>Visibility<select value={form.visibility} disabled={hasOpenFolder} onChange={(event) => form.setVisibility(event.target.value as Visibility)}><option value="members">Members</option>{canManageClub ? <option value="executives">Executives only</option> : null}</select></label><FormActions saving={saving} onCancel={onCancel} /></form>;
}

// The "Add resource" panel, a dialog at the side of the screen: where the new item goes, the four things that can be added, the form of the
// one chosen, and its error. Escape closes it, and so does a click beside it while nothing has been chosen yet; neither does while a
// save or an upload is on the way, and a click beside a form or a set of chosen files does not lose what was typed or chosen.
export function ResourceComposer({ mode, currentFolder, destinationScope, groupById, canManageClub, busy, error, forms, uploads, onOpen, onClose }: {
  mode: Exclude<ComposerMode, null>;
  currentFolder: ResourceItem | null;
  destinationScope: number | null;
  groupById: ReadonlyMap<number, string>;
  canManageClub: boolean;
  /** A save or an upload is on the way: the panel cannot be closed. */
  busy: boolean;
  error: string;
  forms: ReturnType<typeof useResourceForms>;
  uploads: ReturnType<typeof useResourceUploads>;
  onOpen: (mode: Exclude<ComposerMode, null>) => void;
  onClose: () => void;
}) {
  const hasOpenFolder = Boolean(currentFolder);
  // Choosing one of the four things replaces the menu, whose button had the focus: the focus goes to the first thing to fill in or press.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "menu") bodyRef.current?.querySelector<HTMLElement>('input:not([type="file"]):not([type="hidden"]),select,textarea,button')?.focus();
  }, [mode]);
  return <Dialog open onClose={onClose} labelledBy="resource-composer-title" dismissible={!busy} closeOnBackdrop={mode === "menu" && !busy} className={styles.composer}><div className={styles.panelHeader}><div><p className={styles.kicker}>Protected workspace</p><h2 id="resource-composer-title">Add resource</h2></div><IconButton className={styles.iconButton} onClick={onClose} disabled={busy} aria-label="Close add resource"><ResourceIcon name="close" size={18} /></IconButton></div><p className={styles.panelContext}>Adding to <strong>{currentFolder?.title || (destinationScope === null ? "Club-wide" : groupById.get(destinationScope) || "group")}</strong>{currentFolder ? ` · ${currentFolder.visibility || "members"} access` : ""}</p>
      <div ref={bodyRef}>{mode === "menu" ? <div className={styles.composerMenu}><button type="button" onClick={() => onOpen("folder")}><span className={styles.menuIcon}><ResourceIcon name="folder" size={20} /></span><span><strong>Create folder</strong><small>Keep related materials together</small></span><ResourceIcon name="arrow" size={16} /></button><button type="button" onClick={() => onOpen("link")}><span className={styles.menuIcon}><ResourceIcon name="link" size={20} /></span><span><strong>Add link</strong><small>Save a useful web address</small></span><ResourceIcon name="arrow" size={16} /></button><button type="button" onClick={() => onOpen("files")}><span className={styles.menuIcon}><ResourceIcon name="upload" size={20} /></span><span><strong>Upload files</strong><small>Add individual documents or images</small></span><ResourceIcon name="arrow" size={16} /></button><button type="button" onClick={() => onOpen("folder-upload")}><span className={styles.menuIcon}><ResourceIcon name="folder" size={20} /></span><span><strong>Upload folder</strong><small>Preserve an existing folder structure</small></span><ResourceIcon name="arrow" size={16} /></button></div> : mode === "folder" ? <FolderForm form={forms.folder} saving={forms.saving} hasOpenFolder={hasOpenFolder} canManageClub={canManageClub} onSubmit={forms.createFolder} onCancel={onClose} /> : mode === "link" ? <LinkForm form={forms.link} saving={forms.saving} hasOpenFolder={hasOpenFolder} canManageClub={canManageClub} onSubmit={forms.createLink} onCancel={onClose} /> : <ResourceUploadPanel mode={mode} uploads={uploads} hasOpenFolder={hasOpenFolder} canManageClub={canManageClub} onClose={onClose} />}</div>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}</Dialog>;
}
