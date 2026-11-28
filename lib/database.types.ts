// GENERATED FILE. Do not edit by hand: every change is lost the next time it is regenerated, and
// `npm run test:types-drift` fails when it no longer matches the database the migrations build.
//
// Source: Supabase's TypeScript type generator (the Supabase MCP tool `generate_typescript_types`, which is the same
//   as `supabase gen types typescript --project-id <ref> --schema public`), run against the TEST project
//   bharat-sangeet-test (ref bldytniesexkwbtyinsi), which has all 63 migrations applied. It matches migration
//   20261127090100 (the last file in supabase/migrations). Postgres 17 catalog, PostgrestVersion 17.1.
// To regenerate it after a new migration: docs/ARCHITECTURE.md, "Database types".
// The app imports it through lib/db.ts (Tables<"x">, Enums<"x">, Functions<"rpc">), never directly.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "17.1"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          target_email: string
          target_id: string
        }
        Insert: {
          action: string
          actor_email: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_email: string
          target_id: string
        }
        Update: {
          action?: string
          actor_email?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          target_email?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: number
          is_pinned: boolean
          published_at: string
          subgroup_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: never
          is_pinned?: boolean
          published_at?: string
          subgroup_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: never
          is_pinned?: boolean
          published_at?: string
          subgroup_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      archive_items: {
        Row: {
          created_at: string
          description: string
          event_date: string | null
          id: number
          is_public: boolean
          raga: string | null
          storage_path: string
          subgroup_id: number | null
          tala: string | null
          title: string
          type: Database["public"]["Enums"]["archive_type"]
          uploaded_by: string | null
          visibility: Database["public"]["Enums"]["archive_visibility"]
        }
        Insert: {
          created_at?: string
          description?: string
          event_date?: string | null
          id?: never
          is_public?: boolean
          raga?: string | null
          storage_path: string
          subgroup_id?: number | null
          tala?: string | null
          title: string
          type: Database["public"]["Enums"]["archive_type"]
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Update: {
          created_at?: string
          description?: string
          event_date?: string | null
          id?: never
          is_public?: boolean
          raga?: string | null
          storage_path?: string
          subgroup_id?: number | null
          tala?: string | null
          title?: string
          type?: Database["public"]["Enums"]["archive_type"]
          uploaded_by?: string | null
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "archive_items_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archive_items_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_eligibility: {
        Row: {
          member_id: string
          reason: string | null
          status: Database["public"]["Enums"]["attendance_eligibility_status"]
          term_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          member_id: string
          reason?: string | null
          status?: Database["public"]["Enums"]["attendance_eligibility_status"]
          term_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          member_id?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["attendance_eligibility_status"]
          term_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_eligibility_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_eligibility_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_excuses: {
        Row: {
          id: number
          member_id: string
          notified_at: string | null
          proof_path: string | null
          reason: string
          reason_category: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at: string
        }
        Insert: {
          id?: never
          member_id: string
          notified_at?: string | null
          proof_path?: string | null
          reason: string
          reason_category?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id: number
          status?: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at?: string
        }
        Update: {
          id?: never
          member_id?: string
          notified_at?: string | null
          proof_path?: string | null
          reason?: string
          reason_category?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: number
          status?: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_excuses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_excuses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_excuses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_record_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          member_id: string
          new_status: Database["public"]["Enums"]["attendance_status"] | null
          note: string | null
          previous_status:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          session_id: number
          source: Database["public"]["Enums"]["attendance_mark_source"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          member_id: string
          new_status?: Database["public"]["Enums"]["attendance_status"] | null
          note?: string | null
          previous_status?:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          session_id: number
          source: Database["public"]["Enums"]["attendance_mark_source"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: never
          member_id?: string
          new_status?: Database["public"]["Enums"]["attendance_status"] | null
          note?: string | null
          previous_status?:
            | Database["public"]["Enums"]["attendance_status"]
            | null
          session_id?: number
          source?: Database["public"]["Enums"]["attendance_mark_source"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_record_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_audit_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          marked_at: string
          marked_by: string | null
          member_id: string
          minutes_late: number
          note: string | null
          session_id: number
          source: Database["public"]["Enums"]["attendance_mark_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          unexcused_units: number
          updated_at: string
        }
        Insert: {
          marked_at?: string
          marked_by?: string | null
          member_id: string
          minutes_late?: number
          note?: string | null
          session_id: number
          source?: Database["public"]["Enums"]["attendance_mark_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          unexcused_units?: number
          updated_at?: string
        }
        Update: {
          marked_at?: string
          marked_by?: string | null
          member_id?: string
          minutes_late?: number
          note?: string | null
          session_id?: number
          source?: Database["public"]["Enums"]["attendance_mark_source"]
          status?: Database["public"]["Enums"]["attendance_status"]
          unexcused_units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_remediations: {
        Row: {
          assigned_by: string | null
          assignment: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          due_at: string | null
          id: number
          member_id: string
          note: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_remediation_status"]
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          assignment?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          id?: never
          member_id: string
          note?: string | null
          session_id: number
          status?: Database["public"]["Enums"]["attendance_remediation_status"]
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          assignment?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          id?: never
          member_id?: string
          note?: string | null
          session_id?: number
          status?: Database["public"]["Enums"]["attendance_remediation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_remediations_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_remediations_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_remediations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_remediations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_session_participants: {
        Row: {
          member_id: string
          session_id: number
          snapshotted_at: string
        }
        Insert: {
          member_id: string
          session_id: number
          snapshotted_at?: string
        }
        Update: {
          member_id?: string
          session_id?: number
          snapshotted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_session_participants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        Insert: {
          cancel_reason?: string | null
          canceled_at?: string | null
          closed_at?: string | null
          closes_at?: string | null
          code_expires_at?: string | null
          code_hash?: string | null
          counts_toward_metrics?: boolean
          created_at?: string
          created_by?: string | null
          id?: never
          opened_at?: string | null
          roster_count?: number
          scope?: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status?: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id?: number | null
          title?: string
        }
        Update: {
          cancel_reason?: string | null
          canceled_at?: string | null
          closed_at?: string | null
          closes_at?: string | null
          code_expires_at?: string | null
          code_hash?: string | null
          counts_toward_metrics?: boolean
          created_at?: string
          created_by?: string | null
          id?: never
          opened_at?: string | null
          roster_count?: number
          scope?: Database["public"]["Enums"]["attendance_scope"]
          session_date?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_sessions_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_settings: {
        Row: {
          critical_absences: number
          id: boolean
          updated_at: string
          updated_by: string | null
          warning_absences: number
        }
        Insert: {
          critical_absences?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          warning_absences?: number
        }
        Update: {
          critical_absences?: number
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          warning_absences?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: number
          location: string
          starts_at: string
          subgroup_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: never
          location?: string
          starts_at: string
          subgroup_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: never
          location?: string
          starts_at?: string
          subgroup_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: number
          entity_type: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id: number
          entity_type: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: number
          entity_type?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "finance_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_claim_documents: {
        Row: {
          claim_id: number
          document_id: number
        }
        Insert: {
          claim_id: number
          document_id: number
        }
        Update: {
          claim_id?: number
          document_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_claim_documents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "funding_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_claim_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_documents: {
        Row: {
          created_at: string
          document_type: string
          file_size_bytes: number
          id: number
          mime_type: string
          payment_card_last4: string | null
          statement_period_end: string | null
          statement_period_start: string | null
          storage_path: string
          title: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          document_type: string
          file_size_bytes: number
          id?: never
          mime_type: string
          payment_card_last4?: string | null
          statement_period_end?: string | null
          statement_period_start?: string | null
          storage_path: string
          title: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          document_type?: string
          file_size_bytes?: number
          id?: never
          mime_type?: string
          payment_card_last4?: string | null
          statement_period_end?: string | null
          statement_period_start?: string | null
          storage_path?: string
          title?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_expense_documents: {
        Row: {
          document_id: number
          expense_id: number
        }
        Insert: {
          document_id: number
          expense_id: number
        }
        Update: {
          document_id?: number
          expense_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_expense_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expense_documents_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "finance_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category: string
          club_event_id: number | null
          created_at: string
          created_by: string | null
          description: string
          event_attendee_count: number | null
          event_name: string
          event_related: boolean
          event_schedule: string
          event_starts_at: string | null
          id: number
          notes: string
          paid_by: string
          paid_by_member_id: string | null
          payment_card_last4: string | null
          purchase_date: string
          status: string
          subgroup_id: number | null
          updated_at: string
          vendor: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          category: string
          club_event_id?: number | null
          created_at?: string
          created_by?: string | null
          description: string
          event_attendee_count?: number | null
          event_name?: string
          event_related?: boolean
          event_schedule?: string
          event_starts_at?: string | null
          id?: never
          notes?: string
          paid_by: string
          paid_by_member_id?: string | null
          payment_card_last4?: string | null
          purchase_date: string
          status?: string
          subgroup_id?: number | null
          updated_at?: string
          vendor?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          club_event_id?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          event_attendee_count?: number | null
          event_name?: string
          event_related?: boolean
          event_schedule?: string
          event_starts_at?: string | null
          id?: never
          notes?: string
          paid_by?: string
          paid_by_member_id?: string | null
          payment_card_last4?: string | null
          purchase_date?: string
          status?: string
          subgroup_id?: number | null
          updated_at?: string
          vendor?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expenses_club_event_id_fkey"
            columns: ["club_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expenses_paid_by_member_id_fkey"
            columns: ["paid_by_member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expenses_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_payments: {
        Row: {
          account_name: string
          amount: number
          category: string
          cleared_date: string | null
          counterparty: string
          created_at: string
          created_by: string | null
          description: string
          direction: string
          expense_id: number | null
          funding_claim_id: number | null
          id: number
          legacy_transaction_id: number | null
          payment_date: string
          purpose: string
          reimbursement_id: number | null
          status: string
          transfer_group_id: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          account_name?: string
          amount: number
          category?: string
          cleared_date?: string | null
          counterparty?: string
          created_at?: string
          created_by?: string | null
          description: string
          direction: string
          expense_id?: number | null
          funding_claim_id?: number | null
          id?: never
          legacy_transaction_id?: number | null
          payment_date?: string
          purpose: string
          reimbursement_id?: number | null
          status?: string
          transfer_group_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          account_name?: string
          amount?: number
          category?: string
          cleared_date?: string | null
          counterparty?: string
          created_at?: string
          created_by?: string | null
          description?: string
          direction?: string
          expense_id?: number | null
          funding_claim_id?: number | null
          id?: never
          legacy_transaction_id?: number | null
          payment_date?: string
          purpose?: string
          reimbursement_id?: number | null
          status?: string
          transfer_group_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "finance_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payments_funding_claim_id_fkey"
            columns: ["funding_claim_id"]
            isOneToOne: false
            referencedRelation: "funding_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payments_legacy_transaction_id_fkey"
            columns: ["legacy_transaction_id"]
            isOneToOne: true
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payments_reimbursement_id_fkey"
            columns: ["reimbursement_id"]
            isOneToOne: false
            referencedRelation: "personal_reimbursements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_reimbursement_documents: {
        Row: {
          document_id: number
          reimbursement_id: number
        }
        Insert: {
          document_id: number
          reimbursement_id: number
        }
        Update: {
          document_id?: number
          reimbursement_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_reimbursement_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "finance_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_reimbursement_documents_reimbursement_id_fkey"
            columns: ["reimbursement_id"]
            isOneToOne: false
            referencedRelation: "personal_reimbursements"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_claim_expenses: {
        Row: {
          claim_id: number
          claimed_amount: number
          created_at: string
          expense_id: number
        }
        Insert: {
          claim_id: number
          claimed_amount: number
          created_at?: string
          expense_id: number
        }
        Update: {
          claim_id?: number
          claimed_amount?: number
          created_at?: string
          expense_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "funding_claim_expenses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "funding_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_claim_expenses_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "finance_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_claims: {
        Row: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approved_amount?: number | null
          award_reference?: string
          created_at?: string
          created_by?: string | null
          funder_name?: string
          heellife_reference?: string
          id?: never
          notes?: string
          received_amount?: number
          requested_amount: number
          reviewed_at?: string | null
          status?: string
          submission_deadline?: string | null
          submitted_at?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approved_amount?: number | null
          award_reference?: string
          created_at?: string
          created_by?: string | null
          funder_name?: string
          heellife_reference?: string
          id?: never
          notes?: string
          received_amount?: number
          requested_amount?: number
          reviewed_at?: string | null
          status?: string
          submission_deadline?: string | null
          submitted_at?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funding_claims_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_claims_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_claims_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_deactivations: {
        Row: {
          deactivated_at: string
          deactivated_by: string | null
          member_id: string
          reason: string
        }
        Insert: {
          deactivated_at?: string
          deactivated_by?: string | null
          member_id: string
          reason?: string
        }
        Update: {
          deactivated_at?: string
          deactivated_by?: string | null
          member_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_deactivations_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_deactivations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_reimbursements: {
        Row: {
          approved_amount: number | null
          created_at: string
          expense_id: number
          id: number
          member_id: string
          member_note: string
          paid_at: string | null
          requested_amount: number
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approved_amount?: number | null
          created_at?: string
          expense_id: number
          id?: never
          member_id: string
          member_note?: string
          paid_at?: string | null
          requested_amount: number
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approved_amount?: number | null
          created_at?: string
          expense_id?: number
          id?: never
          member_id?: string
          member_note?: string
          paid_at?: string | null
          requested_amount?: number
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personal_reimbursements_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "finance_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_reimbursements_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_reimbursements_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_reimbursements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        Insert: {
          class_year?: string
          email: string
          full_name?: string
          id: string
          joined_at?: string
          phone?: string
          role?: Database["public"]["Enums"]["club_role"]
          specialty?: string
          status?: string
        }
        Update: {
          class_year?: string
          email?: string
          full_name?: string
          id?: string
          joined_at?: string
          phone?: string
          role?: Database["public"]["Enums"]["club_role"]
          specialty?: string
          status?: string
        }
        Relationships: []
      }
      recording_notes: {
        Row: {
          body: string
          created_at: string
          id: number
          mime_type: string | null
          note_type: string
          recording_id: number
          storage_path: string | null
          title: string
          uploaded_by: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: never
          mime_type?: string | null
          note_type: string
          recording_id: number
          storage_path?: string | null
          title?: string
          uploaded_by: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: never
          mime_type?: string | null
          note_type?: string
          recording_id?: number
          storage_path?: string | null
          title?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "recording_notes_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_notes_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          audience: string
          created_at: string
          description: string
          duration_seconds: number | null
          event_date: string | null
          id: number
          media_kind: string
          mime_type: string
          published_at: string | null
          raga: string | null
          recording_kind: string
          sruthi: string | null
          status: Database["public"]["Enums"]["recording_status"]
          storage_bucket: string
          storage_path: string
          subgroup_id: number | null
          tala: string | null
          tempo: string | null
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          audience?: string
          created_at?: string
          description?: string
          duration_seconds?: number | null
          event_date?: string | null
          id?: never
          media_kind?: string
          mime_type?: string
          published_at?: string | null
          raga?: string | null
          recording_kind?: string
          sruthi?: string | null
          status?: Database["public"]["Enums"]["recording_status"]
          storage_bucket?: string
          storage_path: string
          subgroup_id?: number | null
          tala?: string | null
          tempo?: string | null
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          audience?: string
          created_at?: string
          description?: string
          duration_seconds?: number | null
          event_date?: string | null
          id?: never
          media_kind?: string
          mime_type?: string
          published_at?: string | null
          raga?: string | null
          recording_kind?: string
          sruthi?: string | null
          status?: Database["public"]["Enums"]["recording_status"]
          storage_bucket?: string
          storage_path?: string
          subgroup_id?: number | null
          tala?: string | null
          tempo?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "recordings_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_imports: {
        Row: {
          completed_files: number
          created_at: string
          created_by: string | null
          failed_files: number
          id: string
          name: string
          root_parent_id: number | null
          status: string
          subgroup_id: number | null
          total_bytes: number
          total_files: number
          updated_at: string
          uploaded_bytes: number
          visibility: Database["public"]["Enums"]["archive_visibility"]
        }
        Insert: {
          completed_files?: number
          created_at?: string
          created_by?: string | null
          failed_files?: number
          id?: string
          name: string
          root_parent_id?: number | null
          status?: string
          subgroup_id?: number | null
          total_bytes?: number
          total_files?: number
          updated_at?: string
          uploaded_bytes?: number
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Update: {
          completed_files?: number
          created_at?: string
          created_by?: string | null
          failed_files?: number
          id?: string
          name?: string
          root_parent_id?: number | null
          status?: string
          subgroup_id?: number | null
          total_bytes?: number
          total_files?: number
          updated_at?: string
          uploaded_bytes?: number
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "resource_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_imports_root_parent_id_fkey"
            columns: ["root_parent_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_imports_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_links: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          id: number
          title: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: never
          title: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          id?: never
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_tag_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          resource_id: number
          tag_id: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          resource_id: number
          tag_id: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          resource_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "resource_tag_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_tag_assignments_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "resource_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: never
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: never
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          byte_size: number | null
          checksum_sha256: string | null
          created_at: string
          created_by: string | null
          description: string
          event_id: number | null
          external_url: string | null
          id: number
          import_id: string | null
          is_pinned: boolean
          media_kind: Database["public"]["Enums"]["resource_media_kind"] | null
          metadata: Json
          mime_type: string | null
          node_kind: Database["public"]["Enums"]["resource_node_kind"]
          occurred_on: string | null
          original_filename: string | null
          parent_id: number | null
          season_label: string | null
          status: Database["public"]["Enums"]["resource_status"]
          storage_bucket: string | null
          storage_path: string | null
          subgroup_id: number | null
          title: string
          updated_at: string
          visibility: Database["public"]["Enums"]["archive_visibility"]
        }
        Insert: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          event_id?: number | null
          external_url?: string | null
          id?: never
          import_id?: string | null
          is_pinned?: boolean
          media_kind?: Database["public"]["Enums"]["resource_media_kind"] | null
          metadata?: Json
          mime_type?: string | null
          node_kind: Database["public"]["Enums"]["resource_node_kind"]
          occurred_on?: string | null
          original_filename?: string | null
          parent_id?: number | null
          season_label?: string | null
          status?: Database["public"]["Enums"]["resource_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          subgroup_id?: number | null
          title: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Update: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          event_id?: number | null
          external_url?: string | null
          id?: never
          import_id?: string | null
          is_pinned?: boolean
          media_kind?: Database["public"]["Enums"]["resource_media_kind"] | null
          metadata?: Json
          mime_type?: string | null
          node_kind?: Database["public"]["Enums"]["resource_node_kind"]
          occurred_on?: string | null
          original_filename?: string | null
          parent_id?: number | null
          season_label?: string | null
          status?: Database["public"]["Enums"]["resource_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          subgroup_id?: number | null
          title?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["archive_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "resource_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_reviews: {
        Row: {
          decided_at: string
          decided_by: string | null
          decision: string
          member_id: string
          reason: string
        }
        Insert: {
          decided_at?: string
          decided_by?: string | null
          decision: string
          member_id: string
          reason?: string
        }
        Update: {
          decided_at?: string
          decided_by?: string | null
          decision?: string
          member_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_reviews_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_reviews_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subgroup_memberships: {
        Row: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        Insert: {
          added_by?: string | null
          joined_at?: string
          member_id: string
          membership_role?: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at?: string
          subgroup_id: number
        }
        Update: {
          added_by?: string | null
          joined_at?: string
          member_id?: string
          membership_role?: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at?: string
          subgroup_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subgroup_memberships_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgroup_memberships_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgroup_memberships_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgroup_memberships_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgroup_memberships_subgroup_id_fkey"
            columns: ["subgroup_id"]
            isOneToOne: false
            referencedRelation: "subgroups"
            referencedColumns: ["id"]
          },
        ]
      }
      subgroups: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string
          enrollment_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id: number
          name: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          enrollment_mode?: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id?: never
          name: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          enrollment_mode?: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id?: never
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "subgroups_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgroups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          description: string
          id: number
          receipt_path: string | null
          transaction_date: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: never
          receipt_path?: string | null
          transaction_date?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: never
          receipt_path?: string | null
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_funding_claim_expense: {
        Args: { p_claim_id: number; p_expense_id: number }
        Returns: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "funding_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_subgroup_member: {
        Args: { p_member_id: string; p_subgroup_id: number }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_change_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["club_role"]
          p_target_id: string
        }
        Returns: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_deactivate_member: {
        Args: { p_reason?: string; p_target_id: string }
        Returns: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_delete_member: { Args: { p_target_id: string }; Returns: undefined }
      admin_reactivate_member: {
        Args: { p_target_id: string }
        Returns: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_member_profile: {
        Args: {
          p_class_year?: string
          p_full_name: string
          p_phone?: string
          p_specialty?: string
          p_subgroup_ids?: number[]
          p_target_id: string
        }
        Returns: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_attendance_session: {
        Args: { p_session_id: number }
        Returns: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_in_attendance: {
        Args: { p_code: string }
        Returns: {
          marked_at: string
          marked_by: string | null
          member_id: string
          minutes_late: number
          note: string | null
          session_id: number
          source: Database["public"]["Enums"]["attendance_mark_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          unexcused_units: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_attendance_status: {
        Args: { p_member_id: string; p_session_id: number }
        Returns: undefined
      }
      close_attendance_session: {
        Args: { p_session_id: number }
        Returns: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_attendance_session: {
        Args: {
          p_scope: string
          p_starts_at: string
          p_subgroup_id: number
          p_title: string
        }
        Returns: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_funding_claim: {
        Args: {
          p_award_reference: string
          p_expense_ids: number[]
          p_funder_name: string
          p_heellife_reference: string
          p_notes: string
          p_submission_deadline: string
          p_title: string
        }
        Returns: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "funding_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_subgroup: {
        Args: {
          subgroup_description?: string
          subgroup_mode?: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          subgroup_name: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string
          enrollment_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id: number
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "subgroups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_attendance_session: {
        Args: { p_session_id: number }
        Returns: undefined
      }
      get_attendance_overview: {
        Args: {
          p_list_limit?: number
          p_scope?: string
          p_since?: string
          p_subgroup_id?: number
          p_term_key?: string
        }
        Returns: Json
      }
      get_attendance_pulse: {
        Args: {
          p_scope?: string
          p_since?: string
          p_subgroup_id?: number
          p_term_key?: string
        }
        Returns: Json
      }
      get_attendance_roster: { Args: { p_session_id: number }; Returns: Json }
      get_attendance_workspace: {
        Args: { p_scope?: string; p_since?: string; p_subgroup_id?: number }
        Returns: Json
      }
      get_finance_summary: { Args: never; Returns: Json }
      get_portal_bootstrap: { Args: never; Returns: Json }
      leave_subgroup: {
        Args: { p_subgroup_id: number }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_pending_members: {
        Args: never
        Returns: {
          decided_at: string
          decided_by_name: string
          email: string
          full_name: string
          member_id: string
          reason: string
          requested_at: string
          status: string
        }[]
      }
      list_subgroup_roster: {
        Args: { p_subgroup_id: number }
        Returns: {
          email: string
          full_name: string
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
        }[]
      }
      open_attendance_session: {
        Args: { p_duration_minutes?: number; p_session_id: number }
        Returns: {
          check_in_code: string
          code_expires_at: string
          eligible_count: number
          session_id: number
        }[]
      }
      pay_personal_reimbursement: {
        Args: {
          p_account_name?: string
          p_payment_date: string
          p_reimbursement_id: number
        }
        Returns: number
      }
      record_club_expense: {
        Args: {
          p_account_name?: string
          p_amount: number
          p_category: string
          p_club_event_id?: number
          p_description: string
          p_event_attendee_count?: number
          p_event_name?: string
          p_event_related?: boolean
          p_event_schedule?: string
          p_event_starts_at?: string
          p_payment_card_last4?: string
          p_purchase_date: string
          p_subgroup_id?: number
          p_vendor: string
        }
        Returns: number
      }
      record_finance_income: {
        Args: {
          p_account_name?: string
          p_amount: number
          p_category: string
          p_counterparty?: string
          p_description: string
          p_payment_date: string
        }
        Returns: number
      }
      record_funding_claim_payment: {
        Args: {
          p_account_name?: string
          p_amount: number
          p_claim_id: number
          p_payment_date: string
        }
        Returns: number
      }
      remove_finance_document: {
        Args: { p_document_id: number }
        Returns: string
      }
      remove_funding_claim_expense: {
        Args: { p_claim_id: number; p_expense_id: number }
        Returns: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "funding_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_subgroup_member: {
        Args: { p_member_id: string; p_subgroup_id: number }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_reimbursement_changes: {
        Args: { p_note: string; p_reimbursement_id: number }
        Returns: {
          approved_amount: number | null
          created_at: string
          expense_id: number
          id: number
          member_id: string
          member_note: string
          paid_at: string | null
          requested_amount: number
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "personal_reimbursements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_subgroup_enrollment: {
        Args: { target_subgroup_id: number }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_attendance_excuse: {
        Args: { p_decision: string; p_excuse_id: number; p_note?: string }
        Returns: {
          id: number
          member_id: string
          notified_at: string | null
          proof_path: string | null
          reason: string
          reason_category: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_excuses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_pending_member: {
        Args: { p_approved: boolean; p_member_id: string; p_reason?: string }
        Returns: {
          class_year: string
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: Database["public"]["Enums"]["club_role"]
          specialty: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_personal_reimbursement: {
        Args: {
          p_approved_amount?: number
          p_decision: string
          p_reimbursement_id: number
          p_review_note?: string
        }
        Returns: {
          approved_amount: number | null
          created_at: string
          expense_id: number
          id: number
          member_id: string
          member_note: string
          paid_at: string | null
          requested_amount: number
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "personal_reimbursements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_subgroup_enrollment: {
        Args: {
          next_status: Database["public"]["Enums"]["subgroup_membership_status"]
          target_member_id: string
          target_subgroup_id: number
        }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_subgroup_request: {
        Args: { p_decision: string; p_member_id: string; p_subgroup_id: number }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rls_auto_enable: { Args: never; Returns: undefined }
      rotate_attendance_code: {
        Args: { p_session_id: number }
        Returns: {
          check_in_code: string
          code_expires_at: string
          session_id: number
        }[]
      }
      set_attendance_eligibility: {
        Args: {
          p_member_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["attendance_eligibility_status"]
          p_term_key: string
        }
        Returns: {
          member_id: string
          reason: string | null
          status: Database["public"]["Enums"]["attendance_eligibility_status"]
          term_key: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "attendance_eligibility"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_attendance_remediation: {
        Args: {
          p_assignment?: string
          p_due_at?: string
          p_note?: string
          p_remediation_id: number
          p_status: Database["public"]["Enums"]["attendance_remediation_status"]
        }
        Returns: {
          assigned_by: string | null
          assignment: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          due_at: string | null
          id: number
          member_id: string
          note: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_remediation_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_remediations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_attendance_status: {
        Args: {
          p_member_id: string
          p_minutes_late?: number
          p_note?: string
          p_session_id: number
          p_status: Database["public"]["Enums"]["attendance_status"]
        }
        Returns: {
          marked_at: string
          marked_by: string | null
          member_id: string
          minutes_late: number
          note: string | null
          session_id: number
          source: Database["public"]["Enums"]["attendance_mark_source"]
          status: Database["public"]["Enums"]["attendance_status"]
          unexcused_units: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_attendance_thresholds: {
        Args: { p_critical: number; p_warning: number }
        Returns: {
          critical_absences: number
          id: boolean
          updated_at: string
          updated_by: string | null
          warning_absences: number
        }
        SetofOptions: {
          from: "*"
          to: "attendance_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_funding_claim_status: {
        Args: {
          p_approved_amount?: number
          p_claim_id: number
          p_note?: string
          p_status: string
        }
        Returns: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "funding_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_resource_archived: {
        Args: { p_archived: boolean; p_resource_id: number }
        Returns: number
      }
      set_resource_visibility: {
        Args: {
          p_resource_id: number
          p_visibility: Database["public"]["Enums"]["archive_visibility"]
        }
        Returns: number
      }
      set_subgroup_archived: {
        Args: { p_archived: boolean; p_subgroup_id: number }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string
          enrollment_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id: number
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "subgroups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_subgroup_enrollment_mode: {
        Args: {
          p_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          p_subgroup_id: number
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string
          enrollment_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id: number
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "subgroups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_subgroup_member_role: {
        Args: {
          next_role: Database["public"]["Enums"]["subgroup_membership_role"]
          target_member_id: string
          target_subgroup_id: number
        }
        Returns: {
          added_by: string | null
          joined_at: string
          member_id: string
          membership_role: Database["public"]["Enums"]["subgroup_membership_role"]
          requested_by: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["subgroup_membership_status"]
          status_updated_at: string
          subgroup_id: number
        }
        SetofOptions: {
          from: "*"
          to: "subgroup_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_attendance_excuse: {
        Args: {
          p_notified_at?: string
          p_proof_path?: string
          p_reason: string
          p_reason_category?: string
          p_session_id: number
        }
        Returns: {
          id: number
          member_id: string
          notified_at: string | null
          proof_path: string | null
          reason: string
          reason_category: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_excuses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_member_reimbursement: {
        Args: {
          p_amount: number
          p_category: string
          p_club_event_id?: number
          p_description: string
          p_event_attendee_count?: number
          p_event_name?: string
          p_event_related?: boolean
          p_event_schedule?: string
          p_event_starts_at?: string
          p_member_note?: string
          p_payment_card_last4: string
          p_purchase_date: string
          p_subgroup_id?: number
          p_vendor: string
        }
        Returns: {
          expense_id: number
          reimbursement_id: number
        }[]
      }
      update_attendance_session: {
        Args: { p_session_id: number; p_starts_at: string; p_title: string }
        Returns: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_finance_expense: {
        Args: {
          p_amount?: number
          p_category: string
          p_club_event_id?: number
          p_description: string
          p_event_attendee_count?: number
          p_event_name?: string
          p_event_related?: boolean
          p_event_schedule?: string
          p_event_starts_at?: string
          p_expense_id: number
          p_payment_card_last4?: string
          p_purchase_date?: string
          p_subgroup_id?: number
          p_vendor: string
        }
        Returns: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category: string
          club_event_id: number | null
          created_at: string
          created_by: string | null
          description: string
          event_attendee_count: number | null
          event_name: string
          event_related: boolean
          event_schedule: string
          event_starts_at: string | null
          id: number
          notes: string
          paid_by: string
          paid_by_member_id: string | null
          payment_card_last4: string | null
          purchase_date: string
          status: string
          subgroup_id: number | null
          updated_at: string
          vendor: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_member_reimbursement: {
        Args: {
          p_amount: number
          p_category: string
          p_club_event_id?: number
          p_description: string
          p_event_attendee_count?: number
          p_event_name?: string
          p_event_related?: boolean
          p_event_schedule?: string
          p_event_starts_at?: string
          p_member_note?: string
          p_payment_card_last4: string
          p_purchase_date: string
          p_reimbursement_id: number
          p_subgroup_id?: number
          p_vendor: string
        }
        Returns: {
          approved_amount: number | null
          created_at: string
          expense_id: number
          id: number
          member_id: string
          member_note: string
          paid_at: string | null
          requested_amount: number
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "personal_reimbursements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_subgroup: {
        Args: { p_description?: string; p_name: string; p_subgroup_id: number }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          description: string
          enrollment_mode: Database["public"]["Enums"]["subgroup_enrollment_mode"]
          id: number
          name: string
        }
        SetofOptions: {
          from: "*"
          to: "subgroups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_attendance_session: {
        Args: { p_reason: string; p_session_id: number }
        Returns: {
          cancel_reason: string | null
          canceled_at: string | null
          closed_at: string | null
          closes_at: string | null
          code_expires_at: string | null
          code_hash: string | null
          counts_toward_metrics: boolean
          created_at: string
          created_by: string | null
          id: number
          opened_at: string | null
          roster_count: number
          scope: Database["public"]["Enums"]["attendance_scope"]
          session_date: string
          starts_at: string
          status: Database["public"]["Enums"]["attendance_session_status"]
          subgroup_id: number | null
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_finance_expense: {
        Args: { p_expense_id: number; p_reason: string }
        Returns: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category: string
          club_event_id: number | null
          created_at: string
          created_by: string | null
          description: string
          event_attendee_count: number | null
          event_name: string
          event_related: boolean
          event_schedule: string
          event_starts_at: string | null
          id: number
          notes: string
          paid_by: string
          paid_by_member_id: string | null
          payment_card_last4: string | null
          purchase_date: string
          status: string
          subgroup_id: number | null
          updated_at: string
          vendor: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_finance_payment: {
        Args: { p_payment_id: number; p_reason: string }
        Returns: {
          account_name: string
          amount: number
          category: string
          cleared_date: string | null
          counterparty: string
          created_at: string
          created_by: string | null
          description: string
          direction: string
          expense_id: number | null
          funding_claim_id: number | null
          id: number
          legacy_transaction_id: number | null
          payment_date: string
          purpose: string
          reimbursement_id: number | null
          status: string
          transfer_group_id: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "finance_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_funding_claim: {
        Args: { p_claim_id: number; p_reason: string }
        Returns: {
          approved_amount: number | null
          award_reference: string
          created_at: string
          created_by: string | null
          funder_name: string
          heellife_reference: string
          id: number
          notes: string
          received_amount: number
          requested_amount: number
          reviewed_at: string | null
          status: string
          submission_deadline: string | null
          submitted_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "funding_claims"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_attendance_excuse: {
        Args: { p_excuse_id: number }
        Returns: {
          id: number
          member_id: string
          notified_at: string | null
          proof_path: string | null
          reason: string
          reason_category: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: number
          status: Database["public"]["Enums"]["attendance_excuse_status"]
          submitted_at: string
        }
        SetofOptions: {
          from: "*"
          to: "attendance_excuses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      withdraw_member_reimbursement: {
        Args: { p_reimbursement_id: number }
        Returns: {
          approved_amount: number | null
          created_at: string
          expense_id: number
          id: number
          member_id: string
          member_note: string
          paid_at: string | null
          requested_amount: number
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "personal_reimbursements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      archive_type: "recording" | "document" | "photo"
      archive_visibility: "members" | "executives"
      attendance_eligibility_status:
        | "eligible"
        | "under_review"
        | "restricted"
        | "reinstated"
      attendance_excuse_status: "pending" | "approved" | "denied" | "withdrawn"
      attendance_mark_source:
        | "self_check_in"
        | "executive"
        | "session_close"
        | "excuse_approval"
      attendance_remediation_status: "pending" | "complete" | "waived"
      attendance_scope: "club" | "subgroup"
      attendance_session_status: "draft" | "open" | "closed" | "canceled"
      attendance_status: "present" | "absent" | "excused" | "tardy"
      club_role: "member" | "executive" | "admin"
      recording_status: "draft" | "published" | "archived"
      resource_media_kind: "document" | "image" | "other"
      resource_node_kind: "folder" | "file" | "link"
      resource_status: "pending_upload" | "ready" | "failed" | "archived"
      subgroup_enrollment_mode: "open" | "approval" | "invite"
      subgroup_membership_role: "member" | "leader" | "manager"
      subgroup_membership_status:
        | "active"
        | "pending"
        | "waitlisted"
        | "inactive"
        | "removed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      archive_type: ["recording", "document", "photo"],
      archive_visibility: ["members", "executives"],
      attendance_eligibility_status: [
        "eligible",
        "under_review",
        "restricted",
        "reinstated",
      ],
      attendance_excuse_status: ["pending", "approved", "denied", "withdrawn"],
      attendance_mark_source: [
        "self_check_in",
        "executive",
        "session_close",
        "excuse_approval",
      ],
      attendance_remediation_status: ["pending", "complete", "waived"],
      attendance_scope: ["club", "subgroup"],
      attendance_session_status: ["draft", "open", "closed", "canceled"],
      attendance_status: ["present", "absent", "excused", "tardy"],
      club_role: ["member", "executive", "admin"],
      recording_status: ["draft", "published", "archived"],
      resource_media_kind: ["document", "image", "other"],
      resource_node_kind: ["folder", "file", "link"],
      resource_status: ["pending_upload", "ready", "failed", "archived"],
      subgroup_enrollment_mode: ["open", "approval", "invite"],
      subgroup_membership_role: ["member", "leader", "manager"],
      subgroup_membership_status: [
        "active",
        "pending",
        "waitlisted",
        "inactive",
        "removed",
      ],
    },
  },
} as const
