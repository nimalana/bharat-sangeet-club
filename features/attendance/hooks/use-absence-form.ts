// A member's absence form: the proof image is uploaded first, then the form is submitted with its path, and a refused form
// takes the proof back out. Also the executive's link to a form's proof.
import type { User } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";
import { attempt } from "../../../lib/api/attempt";
import { createExcuseProofUrl, removeExcuseProof, submitAttendanceExcuse, uploadExcuseProof } from "../../../lib/api/attendance";
import { useToast } from "../../../components/ui/toast";
import type { Excuse } from "../model";
import type { Exclusive } from "./use-exclusive";

export function useAbsenceForm({ user, load, exclusive }: {
  user: User;
  load: (silent?: boolean) => Promise<void>;
  exclusive: Exclusive;
}) {
  const { notify } = useToast();
  const [showExcuse, setShowExcuse] = useState(false);
  // The form whose proof link is being made (the button says so, and a second press waits for the first).
  const [openingProofId, setOpeningProofId] = useState<number | null>(null);

  async function submitExcuse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("proof") as File;
    if (file?.size && file.size > 8 * 1024 * 1024) { notify("Proof images must be smaller than 8 MB", "error"); return; }
    if (file?.size && !file.type.startsWith("image/")) { notify("Choose an image as proof", "error"); return; }
    await exclusive(async () => {
      const sessionId = Number(form.get("session_id"));
      let proofPath: string | null = null;
      if (file?.size) {
        const upload = await attempt(() => uploadExcuseProof(user.id, sessionId, file));
        if (upload.error) { notify(upload.error.message, "error"); return; }
        proofPath = upload.data;
      }
      const { error } = await attempt(() => submitAttendanceExcuse({
        sessionId,
        reason: String(form.get("reason") || ""),
        proofPath,
        reasonCategory: String(form.get("reason_category") || "other"),
        notifiedAt: form.get("notified") === "on" ? new Date().toISOString() : null,
      }));
      if (error) {
        if (proofPath) await removeExcuseProof(proofPath);
        notify(error.message, "error");
        return;
      }
      formElement.reset();
      setShowExcuse(false);
      notify("Absence form submitted");
      load();
    }, "absence");
  }

  async function openProof(excuse: Excuse) {
    const path = excuse.proof_path;
    if (!path || openingProofId !== null) return;
    setOpeningProofId(excuse.id);
    try {
      const { data: signedUrl, error } = await attempt(() => createExcuseProofUrl(path));
      if (error || !signedUrl) notify("Proof could not be opened", "error"); else window.open(signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setOpeningProofId(null);
    }
  }

  return { showExcuse, setShowExcuse, submitExcuse, openProof, openingProofId };
}
