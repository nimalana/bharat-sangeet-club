import type { GroupOption } from "../../lib/db";

export function ContentScopeLabel({ subgroupId, groups }: { subgroupId?: number | null; groups: GroupOption[] }) {
  return <span className={`content-scope ${subgroupId ? "subgroup" : "club"}`}>{subgroupId ? groups.find((group) => group.id === subgroupId)?.name || "Subgroup" : "Club-wide"}</span>;
}
