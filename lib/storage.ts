import { friendlyError } from "./errors";
import { supabase } from "./supabase";
import { removeAndVerify, type RemoveOptions } from "./storage-remove";

// Deletes one stored file and resolves to null on success, or to a sentence
// that says why the file is still there. Every caller shows that sentence;
// none may assume that a remove() without an error removed the file.
export async function removeStoredFile(bucket: string, path: string, options: Pick<RemoveOptions, "confirmGone" | "refusedMessage" | "failedMessage"> = {}): Promise<string | null> {
  if (!supabase) return "The portal is not connected.";
  return removeAndVerify(supabase, bucket, path, { ...options, describeError: (error) => friendlyError(error, "The file could not be deleted.") });
}
