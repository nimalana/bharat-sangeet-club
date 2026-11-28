import type { Subgroup } from "../../lib/portal-types";

export function ContentScopeLabel({ subgroupId, groups }: { subgroupId?: number | null; groups: Subgroup[] }) {
  return <span className={`content-scope ${subgroupId ? "subgroup" : "club"}`}>{subgroupId ? groups.find((group) => group.id === subgroupId)?.name || "Subgroup" : "Club-wide"}</span>;
}
