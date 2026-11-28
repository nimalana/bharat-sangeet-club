import type { Tables } from "./db";

// Rows are the generated table types (lib/db.ts), narrowed to the columns the shell reads; what only the UI knows is added next to them.
export type ArchiveItem = Pick<Tables<"archive_items">, "id" | "title" | "description" | "storage_path" | "visibility" | "event_date" | "raga" | "tala" | "created_at">
  & Partial<Pick<Tables<"archive_items">, "is_public" | "subgroup_id">> & { type: "recording"; signedUrl?: string };

export type ClubEvent = Pick<Tables<"events">, "id" | "title" | "description" | "starts_at" | "location" | "created_at" | "subgroup_id">;

export type Announcement = Pick<Tables<"announcements">, "id" | "title" | "body" | "is_pinned" | "published_at" | "subgroup_id">;

export type Subgroup = Pick<Tables<"subgroups">, "id" | "name" | "description" | "enrollment_mode" | "archived_at">;

export type SubgroupMembership = Pick<Tables<"subgroup_memberships">, "subgroup_id" | "member_id" | "status" | "membership_role">;

export type AccountStatus = "active" | "deactivated"; // profiles.status is text with a CHECK constraint

export type MemberProfile = Pick<Tables<"profiles">, "id" | "full_name" | "email" | "role"> & Partial<Pick<Tables<"profiles">, "phone" | "class_year" | "specialty" | "joined_at">> & { status?: AccountStatus };

export type ScopeFilter = "all" | "club" | number;
