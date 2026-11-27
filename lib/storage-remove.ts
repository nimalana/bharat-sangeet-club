// Reading the answer of supabase.storage.from(bucket).remove([...]).
//
// Storage does not report a refused delete as an error. When a delete policy
// hides the object, remove() answers 200 with an empty list (confirmed against
// real Supabase). The same empty list also comes back when the object is
// already gone. Code that only looks at `error` therefore tells the person a
// file was deleted when it was not.

type StorageError = { message?: string; code?: string } | null;
type RemoveAnswer = { data: unknown[] | null; error: StorageError };
type SignAnswer = { data: { signedUrl: string } | null; error?: unknown };

// The part of the Supabase client this file needs, so it can be tested with a fake.
export type StorageClient = {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<RemoveAnswer>;
      createSignedUrl(path: string, seconds: number): PromiseLike<SignAnswer>;
    };
  };
};

export type RemoveVerdict = "removed" | "nothing_removed" | "error";

// "removed" only when storage returned a row for every requested path.
export function judgeRemove(answer: RemoveAnswer | null | undefined, requested = 1): RemoveVerdict {
  if (!answer || answer.error) return "error";
  return Array.isArray(answer.data) && answer.data.length >= requested ? "removed" : "nothing_removed";
}

export const FILE_NOT_DELETED = "The file could not be deleted, so nothing was removed.";

export type RemoveOptions = {
  // Turns a storage error into a sentence for the person.
  describeError: (error: StorageError) => string;
  // Said when storage removed nothing and the file may still exist.
  refusedMessage?: string;
  // Callers that delete a file in several steps can be retried after a partial
  // failure, when part of the files are already gone. For those, an empty answer
  // is accepted only if the file can no longer be signed (it really is gone).
  // Leave it off when the person cannot read the file any more (its database
  // row is deleted first): there an empty answer is never proof of anything.
  confirmGone?: boolean;
};

// Resolves to null when the file is gone, or to the sentence to show when it is not.
export async function removeAndVerify(client: StorageClient, bucket: string, path: string, options: RemoveOptions): Promise<string | null> {
  const refused = options.refusedMessage ?? FILE_NOT_DELETED;
  const bucketApi = client.storage.from(bucket);
  let answer: RemoveAnswer;
  try {
    answer = await bucketApi.remove([path]);
  } catch (thrown) {
    return options.describeError({ message: thrown instanceof Error ? thrown.message : "Failed to fetch" });
  }
  const verdict = judgeRemove(answer);
  if (verdict === "removed") return null;
  if (verdict === "error") return options.describeError(answer?.error ?? null);
  if (!options.confirmGone) return refused;
  try {
    const check = await bucketApi.createSignedUrl(path, 60);
    return check.data?.signedUrl ? refused : null;
  } catch {
    // The file could not be checked, so it cannot be called gone.
    return refused;
  }
}
