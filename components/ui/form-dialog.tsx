"use client";

import type { FormEvent } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./input";
import { Textarea } from "./textarea";

export type FormField = {
  name: string; label: string; type?: "text" | "textarea" | "number" | "date" | "select";
  defaultValue?: string; required?: boolean; placeholder?: string; help?: string;
  min?: number; max?: number; step?: number; minLength?: number; maxLength?: number; pattern?: string;
  options?: Array<{ value: string; label: string }>;
};

// A small dialog that collects a few values before an action runs: a reason
// for voiding, an approved amount, edited details. With no fields it is a
// plain confirmation.
export function FormDialog({ open, title, description, fields, submitLabel, danger = false, busy = false, onSubmit, onCancel }: {
  open: boolean; title: string; description?: string; fields: FormField[]; submitLabel: string; danger?: boolean; busy?: boolean;
  onSubmit: (values: Record<string, string>) => void; onCancel: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit(Object.fromEntries(fields.map((field) => [field.name, String(form.get(field.name) ?? "").trim()])));
  }
  // A form does not close on a click beside it (what was typed would be lost); Escape and Cancel still do. With no fields it is a plain
  // confirmation and the backdrop cancels. While `busy` nothing closes it.
  return <Dialog open={open} onClose={onCancel} dismissible={!busy} closeOnBackdrop={fields.length === 0} labelledBy="form-dialog__title" describedBy={description ? "form-dialog__description" : undefined} className="max-w-[520px]">
    <h2 id="form-dialog__title" className="m-0 text-2xl">{title}</h2>
    {description && <p id="form-dialog__description" className="mt-3 text-sm leading-relaxed text-[#4c5f6b]">{description}</p>}
    <form className="mt-4 grid gap-3" onSubmit={submit}>
      {fields.map((field) => {
        const id = `form-dialog-${field.name}`;
        const shared = { id, name: field.name, defaultValue: field.defaultValue, required: field.required, placeholder: field.placeholder };
        return <label key={field.name} className="grid gap-1 text-sm font-semibold" htmlFor={id}>{field.label}
          {field.type === "textarea" ? <Textarea {...shared} rows={3} minLength={field.minLength} maxLength={field.maxLength ?? 500} />
            : field.type === "select" ? <select {...shared} className="h-11 border border-[var(--line)] bg-[var(--paper)] px-3 text-sm">{(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : <Input {...shared} type={field.type || "text"} min={field.min} max={field.max} step={field.step} minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} inputMode={field.type === "number" ? "decimal" : undefined} />}
          {field.help && <small className="font-normal text-[#4c5f6b]">{field.help}</small>}
        </label>;
      })}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>{busy ? "Working…" : submitLabel}</Button>
      </div>
    </form>
  </Dialog>;
}
