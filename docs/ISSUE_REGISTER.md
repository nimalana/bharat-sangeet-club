# Bharat Sangeet Issue Register

Last updated: **August 19, 2026**

This document tracks findings from the live Supabase security review, rollback-only functional QA, deployed-browser smoke testing, and static code review. It is intentionally separate from the product roadmap: roadmap items describe desired capabilities, while this register describes defects, risks, and verification gaps.

## Labels

| Label | Meaning |
| --- | --- |
| P0 | Immediate security, privacy, financial-integrity, or blocking workflow issue |
| P1 | High-impact permission, data-integrity, or core-functionality issue |
| P2 | Incorrect behavior, reliability problem, or substantial UX inconsistency |
| P3 | Hardening, maintainability, accessibility, or future-work gap |
| Confirmed live | Reproduced against the deployed database or application |
| Confirmed static | Directly established from the current code or migration |
| Conditional | Requires a dashboard setting or runtime condition that was not independently verified |
| Planned gap | A requested capability that has not been implemented yet |

## P0 — Immediate

### P0-01 — Require membership approval before granting member access

- **Status:** Confirmed live
- **Finding:** Any Google account can authenticate and the signup trigger automatically creates a `member` profile. That account can then access the member directory and club-wide internal content.
- **Acceptance criteria:** A new OAuth identity remains pending or denied until invited/approved; only active members can read member-only tables and files; existing approved members continue to sign in normally.

### P0-02 — Enforce executive visibility for subgroup files

- **Status:** Confirmed live
- **Finding:** An active subgroup member can read archive metadata and obtain storage access for subgroup items marked `visibility = 'executives'` because the subgroup policy omits the visibility check.
- **Acceptance criteria:** Ordinary subgroup members cannot select or sign executive-only files; subgroup managers/executives retain the intended access; database and storage policies are covered by automated RLS tests.

### P0-03 — Revoke member-wide access when an account is removed

- **Status:** Confirmed live
- **Finding:** Deleting an Auth user does not invalidate an existing JWT, and multiple member policies only require the `authenticated` role rather than an active profile.
- **Acceptance criteria:** Removal revokes active sessions where possible, all member policies require an active profile/membership, and a deleted user's previously issued token cannot read internal club data.

### P0-04 — Add a subgroup enrollment review workflow

- **Status:** Confirmed static
- **Finding:** Approval-based enrollment correctly creates `pending` memberships, but no client code calls `review_subgroup_enrollment`. Requests cannot be approved, waitlisted, or declined in the application.
- **Acceptance criteria:** Authorized executives/managers can view a request queue and approve, waitlist, or decline requests; the member sees the updated state without re-authenticating.

### P0-05 — Make reimbursement submission and receipt storage atomic

- **Status:** Confirmed live
- **Finding:** A reimbursement is submitted before its receipt upload/link succeeds. The database also permits finance-document metadata without a real storage object.
- **Acceptance criteria:** A submitted reimbursement always has its required receipt and a retrievable storage object; failures roll back the finance rows and remove uploaded objects; users receive a recoverable error.

### P0-06 — Enforce a valid funding-claim state machine

- **Status:** Confirmed live
- **Finding:** A claim can be marked `approved` with a null approved amount. Payments are then accepted while the claim remains `partially_paid` indefinitely. Other invalid status jumps are also possible through direct updates.
- **Acceptance criteria:** Database constraints/RPCs enforce valid transitions; approved claims require an approved amount; received funds cannot exceed approval; every payment reaches a consistent claim state.

## P1 — High priority

### P1-01 — Remove historical attendance access after subgroup removal

- **Status:** Confirmed live
- **Finding:** A removed member can still query their historical attendance rows because the original own-record policy does not check active subgroup membership.
- **Acceptance criteria:** A removed/inactive member cannot read subgroup attendance unless an explicit retention policy permits a limited personal summary.

### P1-02 — Honor subgroup manager and leader permissions in the UI

- **Status:** Confirmed static
- **Finding:** The database grants subgroup managers attendance/session authority, but the UI hides every management control from users whose global role is `member`.
- **Acceptance criteria:** Active subgroup managers/leaders can use exactly the roster, session, attendance, and resource controls allowed by database policy without receiving global executive access.

### P1-03 — Require complete event evidence for event-related expenses

- **Status:** Confirmed live
- **Finding:** `event_related = true` is accepted with no event name, date/time, attendee count, or schedule.
- **Acceptance criteria:** Event-related expenses cannot be submitted or made claim-ready until every required event field or linked calendar event is present.

### P1-04 — Require payment-card evidence for claimable purchases

- **Status:** Confirmed live
- **Finding:** Club expenses can be recorded without the payment card's final four digits even though the reimbursement checklist requires them.
- **Acceptance criteria:** Claimable card purchases require four numeric digits; legitimate non-card purchases use an explicit payment-method exemption rather than missing data.

### P1-05 — Bind finance documents to a real uploader-owned storage path

- **Status:** Confirmed live
- **Finding:** Finance metadata can reference a missing object or, conditionally, a known orphaned path under another user's prefix.
- **Acceptance criteria:** Database validation binds `storage_path` to `uploaded_by`, verifies the expected object lifecycle, and removes orphaned objects/metadata after partial failures.

### P1-06 — Require MFA/step-up authentication for administrators

- **Status:** Confirmed live
- **Finding:** Four of five current users have administrator access and none has verified Supabase MFA; sensitive RPCs do not require AAL2.
- **Acceptance criteria:** Administrator count is minimized, sensitive admin actions require AAL2, and every active administrator completes MFA enrollment.

### P1-07 — Clear private client state during account changes

- **Status:** Confirmed static
- **Finding:** In-flight requests and cached signed URLs are not consistently tied to `user.id`; data from the previous account can finish rendering after sign-out or account switching.
- **Acceptance criteria:** The authenticated tree is keyed by identity, private state clears immediately, stale responses are ignored/aborted, and shared-browser account-switch tests pass.

### P1-08 — Fix post-`await` form event handling

- **Status:** Confirmed static
- **Finding:** Announcement and attendance creation access `event.currentTarget.reset()` after awaiting Supabase, when `currentTarget` may be null.
- **Acceptance criteria:** Forms capture the element before awaiting; successful mutations always reset, refresh, and show feedback without console exceptions.

### P1-09 — Replace the stale starter-template test suite

- **Status:** Confirmed static
- **Finding:** Both current automated tests fail because they reference removed `_sites-preview` starter files and starter metadata instead of Bharat Sangeet behavior.
- **Acceptance criteria:** `npm test` covers authentication, RLS, subgroup enrollment, attendance, finance, uploads, calendar, and admin flows and exits successfully.

### P1-10 — Clear the lint gate

- **Status:** Confirmed static
- **Finding:** `npm run lint` reports 20 errors and 5 warnings, including effect-state patterns, dead expressions, unused navigation props, and inaccessible modal interactions.
- **Acceptance criteria:** Lint exits zero with no errors; any intentionally retained warning is documented.

### P1-11 — Disable the password/email side door if Google-only login is intended

- **Status:** Conditional
- **Finding:** Three email identities exist alongside Google identities, and leaked-password protection is disabled. Dashboard provider enablement could not be verified through the available API.
- **Acceptance criteria:** Email/password authentication is disabled, or it is intentionally supported with leaked-password protection, strong password policy, and equivalent membership approval.

### P1-12 — Make funding-claim creation atomic

- **Status:** Confirmed static
- **Finding:** Claim insertion, expense linking, and approval-document upload are separate operations, leaving partial claims or orphaned documents on failure.
- **Acceptance criteria:** A single transactional workflow creates the claim and links, with compensating storage cleanup and a visible retry path.

## P2 — Medium priority

### P2-01 — Correct rejection audit semantics

- **Status:** Confirmed live
- **Finding:** Rejecting a reimbursement still sets `approved_by` and `approved_at` on its expense.
- **Acceptance criteria:** Rejected expenses record reviewer metadata without using approval fields; audit history clearly distinguishes approval from rejection.

### P2-02 — Exclude pending payments from available cash

- **Status:** Confirmed static
- **Finding:** The dashboard excludes only voided payments, so pending entries are included despite the label saying "Posted and cleared payments."
- **Acceptance criteria:** Available cash and recorded income include only the documented statuses, with calculation tests for pending, posted, cleared, and voided entries.

### P2-03 — Correct finance summary status filters

- **Status:** Confirmed static
- **Finding:** Spending includes draft/submitted expenses, and the member "Requested" total includes rejected/voided reimbursements.
- **Acceptance criteria:** Every dashboard metric has a documented status definition and tests that match its label.

### P2-04 — Add void/correction workflows for approved finance records

- **Status:** Planned gap
- **Finding:** Void statuses exist in the schema, but there is no supported RPC or UI action to void a payment, expense, or reimbursement with a reason.
- **Acceptance criteria:** Authorized users can void rather than delete finalized records; a reason and actor are required; balances and audit history update correctly.

### P2-05 — Prevent race conditions in funding allocations

- **Status:** Confirmed static
- **Finding:** Allocation validation sums existing links without locking the claim/expense rows, so concurrent inserts can exceed allowed totals.
- **Acceptance criteria:** Allocation writes serialize or use an equivalent concurrency-safe constraint; a concurrent test cannot exceed claim or expense limits.

### P2-06 — Keep attachment changes in the finance audit trail

- **Status:** Confirmed static
- **Finding:** Finance documents and link tables have no audit triggers, so attachment creation/deletion is absent from history.
- **Acceptance criteria:** Attachment add/remove actions record actor, entity, document type, timestamp, and before/after relationship without exposing file contents.

### P2-07 — Let members correct or remove bad finance attachments

- **Status:** Confirmed static
- **Finding:** Members can insert their finance documents but have no working deletion/correction flow.
- **Acceptance criteria:** Owners can replace/remove documents while a request is editable; finalized requests preserve audit history and require an authorized correction flow.

### P2-08 — Align admin archive controls

- **Status:** Confirmed static
- **Finding:** Admins can upload gallery photos, but recording/document buttons require `role === 'executive'` even though database authorization includes admins.
- **Acceptance criteria:** All archive controls use one capability check that matches database policy.

### P2-09 — Restore navigation from login to the public site

- **Status:** Confirmed static
- **Finding:** `LoginScreen` receives `onBack` but renders no Back/Cancel control.
- **Acceptance criteria:** A keyboard-accessible action returns to the public page without losing necessary state.

### P2-10 — Preserve workspace context during navigation

- **Status:** Confirmed static
- **Finding:** Selecting a workspace always routes to the subgroup overview; "Discover subgroups" can reopen the active subgroup instead of discovery.
- **Acceptance criteria:** Switching subgroups preserves the current logical section when appropriate, while Discover always opens discovery and club-wide reset remains explicit.

### P2-11 — Add mutation loading and duplicate-submit protection

- **Status:** Confirmed static
- **Finding:** Attendance session creation, attendance marking, roster changes, and several finance actions lack per-action loading/disabled states.
- **Acceptance criteria:** Every mutation shows adjacent loading/success/error feedback and prevents duplicate submission while in flight.

### P2-12 — Add archive/upload retry and cleanup handling

- **Status:** Confirmed static
- **Finding:** Cleanup failures after an archive or finance insert error are ignored, which can leave orphaned storage objects.
- **Acceptance criteria:** Failed multi-step uploads are tracked, cleaned up, retried safely, and reported without leaving invisible objects.

### P2-13 — Define claim-expense unlink semantics

- **Status:** Confirmed static
- **Finding:** Removing a claim-expense link does not reconcile requested, approved, or received totals.
- **Acceptance criteria:** Unlinking is blocked after submission or recalculates totals through a documented, audited workflow.

### P2-14 — Add bounded administrator session policies

- **Status:** Confirmed static
- **Finding:** Browser sessions persist and auto-refresh; shared computers can remain signed in after the tab closes.
- **Acceptance criteria:** Administrators have inactivity/max-lifetime controls and clear sign-out guidance; shared-device testing confirms private state is removed.

### P2-15 — Shorten and lazily issue sensitive signed URLs

- **Status:** Confirmed static
- **Finding:** Signed URLs are bearer links; photo URLs last one hour and remain usable after permission changes until expiry.
- **Acceptance criteria:** Sensitive URLs are created only when opened, use the shortest practical TTL, and permission-change behavior is documented/tested.

## P3 — Hardening and planned work

### P3-01 — Add server-enforced archive upload restrictions

- **Status:** Confirmed live
- **Finding:** `club-archive` is private but has no server-enforced size or MIME restrictions.
- **Acceptance criteria:** The bucket enforces approved MIME types and size limits; client checks mirror, but do not replace, server validation.

### P3-02 — Add browser security headers

- **Status:** Confirmed static
- **Finding:** The application does not define a CSP, referrer policy, permissions policy, or explicit frame protection.
- **Acceptance criteria:** Production responses include reviewed headers without breaking OAuth, Supabase, media, or signed-file flows.

### P3-03 — Self-host or proxy third-party visual assets

- **Status:** Confirmed static
- **Finding:** Public pages load third-party images, disclosing request metadata and creating a hotlink/substitution dependency.
- **Acceptance criteria:** Approved assets are stored under club control or the privacy/dependency exception is documented.

### P3-04 — Remove the hardcoded bootstrap administrator email

- **Status:** Confirmed static
- **Finding:** A migration contains a personal email used for admin bootstrap.
- **Acceptance criteria:** Bootstrap elevation is supplied securely out of band and migrations contain no personal administrator identifier.

### P3-05 — Restrict broad sequence grants and mutable attribution fields

- **Status:** Confirmed static
- **Finding:** Authenticated users receive broad sequence privileges, and some writable attribution fields are not constrained to `auth.uid()`.
- **Acceptance criteria:** Grants follow least privilege and user-writable rows cannot forge creator/marker attribution.

### P3-06 — Prevent preferred-name carryover between signups

- **Status:** Confirmed static
- **Finding:** A pending signup name in `sessionStorage` can be applied to a later account in the same tab.
- **Acceptance criteria:** Pending profile data is bound to the matching OAuth attempt and cleared on cancel, error, sign-out, and completion.

### P3-07 — Add self-service attendance sessions and codes

- **Status:** Planned gap
- **Finding:** Attendance is still manually marked; there is no time-limited code, member check-in, explicit session closure, or automatic absence calculation.
- **Acceptance criteria:** Authorized users open/close a subgroup session, active members check in with a short-lived code, and absences are calculated only after closure.

### P3-08 — Add attendance flags and notifications

- **Status:** Planned gap
- **Finding:** Absence thresholds, excused-absence correction, executive flags, and notifications are not implemented.
- **Acceptance criteria:** Configurable thresholds create private, auditable flags and notify only authorized people.

### P3-09 — Add session cancellation/deletion controls

- **Status:** Planned gap
- **Finding:** The UI cannot cancel or delete an attendance session even though database managers can manage sessions.
- **Acceptance criteria:** Authorized users can cancel/delete with confirmation; canceled rehearsals never generate absences; history retention is explicit.

### P3-10 — Improve calendar scope and integration

- **Status:** Planned gap
- **Finding:** Calendar events are club-wide only; subgroup-scoped dates and calendar subscription/synchronization are not implemented.
- **Acceptance criteria:** Events can target the club or a subgroup, respect membership permissions, and expose a safe subscription/export path if retained in scope.

### P3-11 — Add accessible modal and control behavior

- **Status:** Confirmed static
- **Finding:** Lint reports non-interactive modal containers with mouse handlers and remaining native-looking controls have inconsistent interaction feedback.
- **Acceptance criteria:** Modals support focus trapping, Escape, keyboard activation, labeled controls, and accessible success/error states.

### P3-12 — Add observability for failed workflows

- **Status:** Planned gap
- **Finding:** Upload, finance, OAuth, and database failures rely primarily on transient toasts and provider logs.
- **Acceptance criteria:** Structured application errors identify the workflow and correlation ID without logging private document contents or credentials.

## Verified working during the August 19 QA pass

- Multiple subgroups and isolated attendance sessions
- Attendance upserts and duplicate-session prevention
- Active-roster validation and member session isolation
- Open, approval, and invitation-only enrollment database behavior
- Reimbursement approval/payment and duplicate-payment prevention
- Direct expense, income, funding-allocation limits, and finance audit writes
- Calendar and announcement creation/read/delete permissions
- Member self-edit and administrator role/delete protections
- Anonymous public-recording and member/executive club archive separation
- Public deployment render, Google OAuth redirect, and error-free browser smoke test

## Test-environment notes

- Functional database fixtures were created inside transactions and rolled back.
- Cleanup verification found zero QA subgroups, events, announcements, archive items, expenses, claims, or documents.
- Authenticated binary upload/signed-file opening still needs a browser test session because automated OAuth stopped at Google's credential screen.
- The isolated production build was blocked by unavailable Google Font downloads; TypeScript checking passed and the deployed Vercel application loaded correctly.
