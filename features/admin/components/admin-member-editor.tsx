"use client";

import type { FormEvent } from "react";
import type { MemberProfile, Subgroup, SubgroupMembership } from "../../../lib/db";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";

const LABEL = "mb-4 block min-w-0 text-xs font-bold uppercase tracking-[.08em]";

/**
 * Edit one member's directory details and the groups they are in. A dialog (named by its heading): while it is saved the button waits
 * and nothing closes it (Escape, Cancel, Close); a click beside it never closes it (what was typed would be lost), and when the save
 * fails it stays open with everything as it was typed. Every field is a label with its own `htmlFor`.
 */
export function AdminMemberEditor({ member, groups, memberships, saving, onClose, onSubmit }: { member: MemberProfile; groups: Subgroup[]; memberships: SubgroupMembership[]; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const assignedGroupIds = new Set(memberships.filter((item) => item.member_id === member.id && item.status === "active").map((item) => item.subgroup_id));
  return <Dialog open onClose={onClose} dismissible={!saving} closeOnBackdrop={false} className="max-w-[700px]"><form onSubmit={onSubmit}><div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--line)] pb-5"><div><p className="eyebrow">MEMBER PROFILE</p><h2 className="m-0 font-[var(--display)] text-[clamp(2rem,4vw,2.8rem)] font-semibold uppercase tracking-[-.02em]">Edit member</h2></div><IconButton aria-label="Close editor" onClick={onClose} disabled={saving}>×</IconButton></div><p className="mb-5 max-w-[60ch] text-xs leading-relaxed text-[#5c7180]">Update directory details and choose the active subgroups this member can access.</p><div className="grid min-w-0 grid-cols-1 gap-x-4 sm:grid-cols-2">
    <label htmlFor="member-editor-name" className={LABEL}>Preferred name<Input id="member-editor-name" className="mt-1.5 normal-case tracking-normal" name="full_name" required defaultValue={member.full_name} /></label>
    <label htmlFor="member-editor-email" className={LABEL}>Email<Input id="member-editor-email" className="mt-1.5 normal-case tracking-normal" value={member.email} disabled readOnly /></label>
    <label htmlFor="member-editor-phone" className={LABEL}>Phone number<Input id="member-editor-phone" className="mt-1.5 normal-case tracking-normal" name="phone" type="tel" defaultValue={member.phone || ""} placeholder="Optional" /></label>
    <label htmlFor="member-editor-year" className={LABEL}>Class year<Input id="member-editor-year" className="mt-1.5 normal-case tracking-normal" name="class_year" defaultValue={member.class_year || ""} placeholder="2028" /></label>
    <label htmlFor="member-editor-specialty" className={`${LABEL} sm:col-span-2`}>Voice / instrument<Input id="member-editor-specialty" className="mt-1.5 normal-case tracking-normal" name="specialty" defaultValue={member.specialty || ""} placeholder="Vocal, violin, mridangam…" /></label>
  </div><fieldset className="my-5 min-w-0 border border-[var(--line)] p-4"><legend className="px-2 text-xs font-bold uppercase tracking-[.1em] text-[var(--ink)]">Subgroups</legend><p className="mb-3 text-xs leading-relaxed text-[#5f7481]">Selected groups become active immediately. Leave all unchecked for a club-wide-only member.</p><div className="grid min-w-0 grid-cols-1 gap-px overflow-hidden border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">{groups.length ? groups.map((group) => <label className="grid min-h-11 min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 bg-[var(--paper)] p-3 hover:bg-[var(--carolina-pale)]" key={group.id}><input className="row-span-2 mt-0.5 size-4 shrink-0 accent-[var(--carolina)]" type="checkbox" name="subgroup_id" value={group.id} defaultChecked={assignedGroupIds.has(group.id)} /><span className="block break-words font-[var(--display)] text-sm font-bold uppercase tracking-[.02em]">{group.name}</span><small className="mt-1 block break-words text-xs leading-snug text-[#5f7481]">{group.description || "Bharat Sangeet subgroup"}</small></label>) : <span className="workspace-empty">Create a subgroup before assigning members.</span>}</div></fieldset><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" pending={saving}>{saving ? "Saving member…" : "Save member"}</Button></div></form></Dialog>;
}
