// The app's view of the database types. Everything the app needs from lib/database.types.ts (generated, never edited)
// is re-exported from here, so the rest of the code imports one small file and never the generated one.
//
//   Tables<"events">                 a row as select("*") returns it
//   TablesInsert<"events">           what insert() takes
//   TablesUpdate<"events">           what update() takes
//   Enums<"club_role">               an enum as a union of its values
//   Functions<"get_finance_summary"> { Args, Returns } of an RPC as generated
//   RpcArgs<"x"> / RpcReturns<"x">   what a call may pass (null allowed for arguments with a default) / what it returns
//
// Type-only: this file has no run-time code, so importing it adds nothing to a bundle and node's test runner can load
// the lib modules that import it (they must `import type` from here).
//
// Union types for the values the UI switches on (roles, statuses, scopes) are DERIVED from the enums below, so a
// migration that adds an enum value reaches the UI as a compile error instead of a screen that mislabels it. Values the
// database does not have but the UI needs (for example "no mark yet" next to the attendance statuses) are added where
// they are used, as `AttendanceStatus | "pending"`, never here.
import type { Database as GeneratedDatabase, Enums as GeneratedEnums, Json, Tables as GeneratedTables, TablesInsert as GeneratedTablesInsert, TablesUpdate as GeneratedTablesUpdate } from "./database.types";

export type { Json };
export type Tables<N extends keyof GeneratedDatabase["public"]["Tables"] | keyof GeneratedDatabase["public"]["Views"]> = GeneratedTables<N>;
export type TablesInsert<N extends keyof GeneratedDatabase["public"]["Tables"]> = GeneratedTablesInsert<N>;
export type TablesUpdate<N extends keyof GeneratedDatabase["public"]["Tables"]> = GeneratedTablesUpdate<N>;
export type Enums<N extends keyof GeneratedDatabase["public"]["Enums"]> = GeneratedEnums<N>;

export type TableName = keyof GeneratedDatabase["public"]["Tables"];
export type RpcName = keyof GeneratedDatabase["public"]["Functions"];
export type Functions<N extends RpcName> = GeneratedDatabase["public"]["Functions"][N];
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
export type ArchiveType = Enums<"archive_type">;
export type ArchiveVisibility = Enums<"archive_visibility">;
export type RecordingStatus = Enums<"recording_status">;
export type ResourceMediaKind = Enums<"resource_media_kind">;
export type ResourceNodeKind = Enums<"resource_node_kind">;
export type ResourceStatus = Enums<"resource_status">;
export type EnrollmentMode = Enums<"subgroup_enrollment_mode">;
export type GroupRole = Enums<"subgroup_membership_role">;
export type MembershipStatus = Enums<"subgroup_membership_status">;
export type AttendanceScope = Enums<"attendance_scope">;
export type SessionStatus = Enums<"attendance_session_status">;
/** A mark in the database. The UI adds "pending" (no mark yet) where it needs it. */
export type AttendanceStatus = Enums<"attendance_status">;
export type MarkSource = Enums<"attendance_mark_source">;
export type ExcuseStatus = Enums<"attendance_excuse_status">;
export type RemediationStatus = Enums<"attendance_remediation_status">;
export type EligibilityStatus = Enums<"attendance_eligibility_status">;
