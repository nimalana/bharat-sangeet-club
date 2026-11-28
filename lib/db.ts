// The app's view of the database types. Everything the app needs from lib/database.types.ts (generated, never edited)
// is re-exported from here, so the rest of the code imports one small file and never the generated one.
//
//   Tables<"events">                 a row as select("*") returns it
//   TablesInsert<"events">           what insert() takes
//   TablesUpdate<"events">           what update() takes
//   RpcArgs<"x"> / RpcReturns<"x">   what a call may pass (null allowed for arguments with a default) / what it returns
//   ClubRole, AttendanceStatus ...   an enum as a union of its values (derived below with the local `Enums<"club_role">`; add one
//                                    here when a screen needs it, not before)
//
// Type-only: this file has no run-time code, so importing it adds nothing to a bundle and node's test runner can load
// the lib modules that import it (they must `import type` from here).
//
// Row shapes (Subgroup, ClubEvent, Profile ...) are tables narrowed with Pick to the columns the screens read, written once here.
// A screen that needs fewer columns narrows one of these again (GroupOption, EventOption) instead of declaring its own copy, so a
// column that changes in a migration changes in one place and a caller is never asked for a column the screen does not read.
//
// Union types for the values the UI switches on (roles, statuses, scopes) are DERIVED from the enums below, so a
// migration that adds an enum value reaches the UI as a compile error instead of a screen that mislabels it. Values the
// database does not have but the UI needs (for example "no mark yet" next to the attendance statuses) are added where
// they are used, as `AttendanceStatus | "pending"`, never here.
import type { Database as GeneratedDatabase, Enums as GeneratedEnums, Tables as GeneratedTables, TablesInsert as GeneratedTablesInsert, TablesUpdate as GeneratedTablesUpdate } from "./database.types";

export type Tables<N extends keyof GeneratedDatabase["public"]["Tables"] | keyof GeneratedDatabase["public"]["Views"]> = GeneratedTables<N>;
export type TablesInsert<N extends keyof GeneratedDatabase["public"]["Tables"]> = GeneratedTablesInsert<N>;
export type TablesUpdate<N extends keyof GeneratedDatabase["public"]["Tables"]> = GeneratedTablesUpdate<N>;
type Enums<N extends keyof GeneratedDatabase["public"]["Enums"]> = GeneratedEnums<N>;

type RpcName = keyof GeneratedDatabase["public"]["Functions"];
export type RpcReturns<N extends RpcName> = GeneratedDatabase["public"]["Functions"][N]["Returns"];

// ---------------------------------------------------------------- the typed client's schema
//
// The generator writes an argument that has a default as `p_x?: T`. A call that sends `p_x: null` is not allowed by
// that type, but it is valid: the client sends JSON null, PostgREST passes SQL NULL (not the default), and none of the
// functions is STRICT (checked against the replayed database), so the function sees NULL and decides. The generator
// has no way to say "nullable argument", so the schema the client is built from adds `| null` to the optional
// arguments and to nothing else: a required argument still cannot be null, and a column still follows its Row type.
type NullableWhenOptional<Args> = Args extends Record<string, unknown> ? { [K in keyof Args]: undefined extends Args[K] ? Args[K] | null : Args[K] } : Args;
type WithNullableOptionalArgs<Schema extends { Functions: Record<string, { Args: unknown }> }> = Omit<Schema, "Functions"> & {
  Functions: { [F in keyof Schema["Functions"]]: Omit<Schema["Functions"][F], "Args"> & { Args: NullableWhenOptional<Schema["Functions"][F]["Args"]> } };
};
export type AppDatabase = Omit<GeneratedDatabase, "public"> & { public: WithNullableOptionalArgs<GeneratedDatabase["public"]> };
export type RpcArgs<N extends RpcName> = AppDatabase["public"]["Functions"][N]["Args"];

// ---------------------------------------------------------------- unions derived from the enums
export type ClubRole = Enums<"club_role">;
export type ArchiveVisibility = Enums<"archive_visibility">;
export type ResourceMediaKind = Enums<"resource_media_kind">;
export type EnrollmentMode = Enums<"subgroup_enrollment_mode">;
export type GroupRole = Enums<"subgroup_membership_role">;
export type MembershipStatus = Enums<"subgroup_membership_status">;
export type SessionStatus = Enums<"attendance_session_status">;
/** A mark in the database. The UI adds "pending" (no mark yet) where it needs it. */
export type AttendanceStatus = Enums<"attendance_status">;
export type RemediationStatus = Enums<"attendance_remediation_status">;
export type EligibilityStatus = Enums<"attendance_eligibility_status">;

// ---------------------------------------------------------------- row shapes the screens share
// Rows are the generated table types, narrowed to the columns the screens read; what only the UI knows is added next to them.
// The club archive: `ClubArchiveItem` is the row, `ArchiveItem` is how the shell holds it (marked as a recording, with the signed
// address once one has been asked for).
export type ClubArchiveItem = Pick<Tables<"archive_items">, "id" | "title" | "description" | "storage_path" | "visibility" | "event_date" | "raga" | "tala" | "created_at">
  & Partial<Pick<Tables<"archive_items">, "is_public" | "subgroup_id">>;
export type ArchiveItem = ClubArchiveItem & { type: "recording"; signedUrl?: string };

export type ClubEvent = Pick<Tables<"events">, "id" | "title" | "description" | "starts_at" | "location" | "created_at" | "subgroup_id">;
/** An event as a choice or a label: what a picker and a related-event line show. */
export type EventOption = Pick<ClubEvent, "id" | "title" | "starts_at">;

export type Announcement = Pick<Tables<"announcements">, "id" | "title" | "body" | "is_pinned" | "published_at" | "subgroup_id">;

export type Subgroup = Pick<Tables<"subgroups">, "id" | "name" | "description" | "enrollment_mode" | "archived_at">;
/** A group as a choice or a label (an audience picker, "Posted to ..."): its id and name. */
export type GroupOption = Pick<Subgroup, "id" | "name">;

export type SubgroupMembership = Pick<Tables<"subgroup_memberships">, "subgroup_id" | "member_id" | "status" | "membership_role">;

export type AccountStatus = "active" | "deactivated"; // profiles.status is text with a CHECK constraint

export type MemberProfile = Pick<Tables<"profiles">, "id" | "full_name" | "email" | "role"> & Partial<Pick<Tables<"profiles">, "phone" | "class_year" | "specialty" | "joined_at">> & { status?: AccountStatus };
/** Who a row points at (a requester, a payee, a member in a roster): the columns a name line needs. */
export type Profile = Pick<Tables<"profiles">, "id" | "full_name" | "email">;

/** The audience a screen is showing: everything, the club-wide items, or one subgroup's. A UI choice, not a column. */
export type ScopeFilter = "all" | "club" | number;
