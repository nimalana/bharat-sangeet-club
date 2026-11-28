"use client";

// The Members page's read: the active members, the groups and who is in which group, cached for the person (lib/hooks/use-query.ts).
// Reopening the page shows the last directory at once and refreshes behind it; a failed refresh keeps the directory already shown
// instead of emptying it. The three lists are one read: if any of them fails the whole read counts as failed.
import type { User } from "@supabase/supabase-js";
import { getMemberDirectory, type MemberDirectory } from "../../../lib/api/members";
import { useQuery } from "../../../lib/hooks/use-query";
import { useToast } from "../../../components/ui/toast";

const EMPTY: MemberDirectory = { members: [], groups: [], memberships: [] };

export function useMemberDirectory(user: User) {
  const { notify } = useToast();
  const directory = useQuery<MemberDirectory>({
    userId: user.id,
    key: "members",
    load: getMemberDirectory,
    onError: () => notify("The member directory could not be loaded"),
  });
  const { members, groups, memberships } = directory.data || EMPTY;
  return { members, groups, memberships, loading: directory.loading, failed: directory.failed, reload: directory.refetch };
}
