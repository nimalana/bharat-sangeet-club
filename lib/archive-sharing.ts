// A club-archive recording can also be the file behind a group's recording-room
// copy: both rows point at the same object in the club-archive bucket. Members
// can only sign that object while the archive item's access is "All club
// members" (or public), so lowering it to "Executives only" stops the group
// from playing its own copy. The old delete message even recommended that.
//
// Pure, so the rules can be tested without a browser (tests/archive-sharing.test.mjs).

export type ArchiveAccess = "public" | "members" | "executives";

type AccessFields = { visibility: string; is_public?: boolean | null };

export function archiveAccess(item: AccessFields): ArchiveAccess {
  return item.is_public ? "public" : item.visibility === "executives" ? "executives" : "members";
}

// The two columns the access choice is stored in.
export function accessColumns(access: ArchiveAccess): { visibility: "members" | "executives"; is_public: boolean } {
  return { visibility: access === "executives" ? "executives" : "members", is_public: access === "public" };
}

// Only lowering access to Executives only can stop a group's copy from
// playing; every other change is safe, so only this one needs the sharing check.
export function loweringToExecutivesOnly(current: ArchiveAccess, next: ArchiveAccess): boolean {
  return next === "executives" && current !== "executives";
}

// Lowering access to Executives only for a file a group still plays would break
// the group's copy.
export function accessChangeBreaksPlayback(current: ArchiveAccess, next: ArchiveAccess, sharedWithRecordingRoom: boolean): boolean {
  return sharedWithRecordingRoom && loweringToExecutivesOnly(current, next);
}

export const SHARED_DELETE_NOTICE = {
  title: "This recording is in a group's recording room",
  body: "The same file plays in a group's recording room, so it cannot be deleted here. To take it off the public concert page, set its access to All club members; the group can keep playing it.",
} as const;

export const SHARED_ACCESS_NOTICE = "This file also plays in a group's recording room. Executives only would stop that group from playing it, so nothing was saved. Choose All club members or Everyone (public concert).";
