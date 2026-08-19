# Concurrent Issue-Resolution Plan

Last updated: **August 19, 2026**

This plan divides the [issue register](./ISSUE_REGISTER.md) among **Nimalan Arulvelan**, **Aditya Mehta**, and **Pranav** so all three can work concurrently with minimal file and migration conflicts. The three work branches are combined on an integration branch only after each owner completes their assigned verification.

## Working model

| Owner | Branch | Primary responsibility | Exclusive file ownership |
| --- | --- | --- | --- |
| Nimalan | `work/nimalan/security-foundation` | Authentication, RLS, storage security, session hardening, deployment configuration | Security/auth migrations, `lib/supabase.ts`, `next.config.ts`, `app/layout.tsx` |
| Aditya Mehta | `work/aditya/club-workspaces-ui` | Club, subgroup, attendance, member, archive, calendar, navigation, and admin UI | `app/page.tsx` and club-facing portions of `app/globals.css` |
| Pranav | `work/pranav/finance-reliability` | Finance database invariants, finance UI, finance uploads, and automated tests | Finance migrations, `app/finance.tsx`, `tests/**`, and test scripts/configuration |

No one should edit an existing applied migration. Every database change must be a new migration.

## Shared rules

1. Start from commit `57b6e06` or a newer `main` containing `docs/ISSUE_REGISTER.md`.
2. Never commit directly to `main` during this work wave.
3. Do not edit another person's exclusive files. Request the owner to make the change instead.
4. Keep each commit focused and reference issue IDs in its message, for example `Fix subgroup archive visibility (P0-02)`.
5. Do not commit `.env*`, credentials, service-role keys, `.next`, generated build output, or unrelated formatting changes.
6. Database authorization remains authoritative. Hiding a button is not an authorization fix.
7. Announce any RPC signature, enum, table, or response-shape change before dependent UI code is finalized.
8. Do not edit `docs/ISSUE_REGISTER.md`, `docs/CONCURRENT_WORK_PLAN.md`, or the roadmap from the three work branches. Nimalan updates them once integration is complete.

## Migration namespace

To prevent duplicate filenames while Nimalan and Pranav work concurrently:

- Nimalan owns migration timestamps from `20260820010000` through `20260820015959`.
- Pranav owns migration timestamps from `20260820020000` through `20260820025959`.
- Aditya does not create or edit migrations. Database requests go to the relevant owner.
- Create migrations with `supabase migration new <descriptive_name>` and rename only before they are applied anywhere if the generated timestamp is outside the reserved range.
- Never rename, reorder, or edit a migration after it has been applied to a shared environment.

## Track A — Nimalan: security and platform foundation

### Assigned issues

| Issue | Deliverable |
| --- | --- |
| P0-01 | Introduce an active/pending membership gate so OAuth authentication alone does not grant member data access. |
| P0-02 | Correct archive metadata and storage RLS so subgroup members cannot read executive-only material. |
| P0-03 | Require active profiles in member policies and revoke/limit sessions during member deletion. |
| P1-01 | Remove historical attendance visibility after subgroup membership becomes inactive or is removed. |
| P1-05 | Enforce uploader-owned finance storage paths and harden metadata/object consistency at the policy layer. |
| P1-06 | Reduce administrator exposure and document/enforce AAL2 for sensitive administration. |
| P1-11 | Confirm and lock the intended Google-only authentication configuration. |
| P2-14 | Add bounded administrator session behavior and shared-device safeguards that belong in auth/client configuration. |
| P3-01 | Add server-enforced archive MIME-type and size restrictions. |
| P3-02 | Add CSP, referrer, permissions, and frame-protection headers without breaking OAuth or media. |
| P3-04 | Replace the hardcoded bootstrap administrator email with an out-of-band process. |
| P3-05 | Reduce sequence grants and prevent forged creator/marker fields. |
| P3-12 | Define privacy-safe error correlation and platform observability. |

### Expected migrations and configuration

Suggested migration names within Nimalan's reserved range:

- `20260820010000_active_member_access_gate.sql`
- `20260820011000_harden_archive_storage_rls.sql`
- `20260820012000_harden_attendance_and_member_removal.sql`
- `20260820013000_harden_finance_document_paths.sql`
- `20260820014000_reduce_privileges_and_attribution.sql`

Combine migrations where one coherent change is safer; do not create empty placeholder migrations.

### Required verification

- RLS matrix for anonymous, pending member, active member, other subgroup member, subgroup manager, executive, and administrator.
- A pending or removed account cannot read profiles, member archives, events, announcements, subgroups, or attendance.
- An ordinary subgroup member cannot read/sign `visibility = 'executives'` files.
- Finance document paths must start with the authenticated uploader's UUID.
- Every new `SECURITY DEFINER` function has `SET search_path = ''`, explicit caller checks, and no `PUBLIC`/`anon` execution.
- Run Supabase security advisors after migrations are applied to the test environment.

### Handoff contract for Aditya

Before Aditya finalizes membership UI, provide:

- the exact profile/member status values;
- how the UI determines pending versus active access;
- the RPC used to approve/deny membership, if any;
- expected errors for pending, removed, and unauthorized accounts.

## Track B — Aditya Mehta: club and subgroup experience

### Branch setup

```bash
git switch main
git pull --ff-only origin main
git switch -c work/aditya/club-workspaces-ui
```

### Assigned issues

| Issue | Deliverable |
| --- | --- |
| P0-04 | Add the executive/manager enrollment-request queue and approve, waitlist, and decline actions. |
| P1-02 | Show subgroup-scoped management controls to active leaders/managers without exposing club-wide executive tools. |
| P1-07 | Clear user-scoped state and ignore stale responses when identities change. |
| P1-08 | Capture form elements before awaits and guarantee reset/refresh feedback after successful mutations. |
| P1-10 | Resolve lint errors originating in `app/page.tsx` and Aditya-owned styles. |
| P2-08 | Use one capability check for admin/executive archive controls. |
| P2-09 | Add accessible Back/Cancel navigation from login to the public site. |
| P2-10 | Preserve logical section when switching workspaces and make Discover always open discovery. |
| P2-11 | Add loading, disabled, success, and error states to club/subgroup mutations. |
| P2-12 | Add archive upload retry and visible cleanup/error handling on the client. |
| P2-15 | Lazily create short-lived archive/photo signed URLs within Aditya-owned surfaces. |
| P3-03 | Self-host or replace third-party page imagery. |
| P3-06 | Bind preferred-name state to the correct OAuth attempt and clear abandoned state. |
| P3-07 | Build the member-facing attendance-code and session interaction after the database contract is agreed. |
| P3-08 | Add private absence flags/notification presentation after the backend contract exists. |
| P3-09 | Add confirmed cancel/delete attendance-session controls. |
| P3-10 | Add club/subgroup calendar scope in the UI when the data contract is ready. |
| P3-11 | Fix modal focus, keyboard behavior, labels, and accessible feedback. |

### File boundaries

Aditya may edit:

- `app/page.tsx`
- club/subgroup/admin/calendar/member selectors in `app/globals.css`
- new club-UI test files under `tests/club/**` after coordinating filenames with Pranav

Aditya must not edit:

- `app/finance.tsx`
- existing or new Supabase migrations
- auth/storage client configuration owned by Nimalan
- shared test scripts in `package.json` without asking Pranav

### Required verification

- Test member, subgroup-manager, executive, and administrator views separately.
- Open enrollment becomes active; approval enrollment remains pending until reviewed; invite-only enrollment rejects self-join.
- A manager can manage only their active subgroup.
- Switching users in one browser never displays the previous user's data or signed URLs.
- Switching subgroup while on Attendance stays on Attendance; Discover always shows discoverable groups.
- Every mutation prevents duplicate submission and shows adjacent success/error feedback.
- Keyboard-only testing covers menus, modals, forms, and destructive confirmations.
- Capture screenshots of the enrollment queue, manager attendance controls, and mobile workspace navigation for the PR.

### Pull-request checklist for Aditya

```text
Branch: work/aditya/club-workspaces-ui
Owned files changed:
Issue IDs completed:
Database/RPC contract used:
Roles tested: member / manager / executive / admin
Commands run:
Screenshots attached:
Known follow-ups:
```

## Track C — Pranav: finance reliability and automated tests

### Branch setup

```bash
git switch main
git pull --ff-only origin main
git switch -c work/pranav/finance-reliability
```

### Assigned issues

| Issue | Deliverable |
| --- | --- |
| P0-05 | Make reimbursement, receipt metadata, object storage, and linking behave atomically or compensate safely. |
| P0-06 | Enforce valid funding-claim transitions and approved/received amounts. |
| P1-03 | Require complete event evidence for event-related finance submissions. |
| P1-04 | Require card evidence or an explicit non-card payment method. |
| P1-05 | Implement finance-side object/metadata cleanup in cooperation with Nimalan's storage policy. |
| P1-09 | Replace starter tests with Bharat Sangeet functional tests. |
| P1-10 | Resolve lint errors originating in `app/finance.tsx`, tests, and test configuration. |
| P1-12 | Make claim creation, expense links, and approval-document handling atomic/recoverable. |
| P2-01 | Stop rejected expenses from receiving approval metadata. |
| P2-02 | Exclude pending payments from available cash and recorded income. |
| P2-03 | Define and test the status filters for every finance summary metric. |
| P2-04 | Add audited void/correction RPCs and finance UI. |
| P2-05 | Make claim allocation concurrency-safe. |
| P2-06 | Audit finance attachment/link changes. |
| P2-07 | Let members correct attachments while the request is editable. |
| P2-11 | Add per-action mutation feedback and duplicate-submit protection in finance. |
| P2-12 | Add finance upload retry and orphan cleanup. |
| P2-13 | Define and implement safe claim-expense unlink behavior. |
| P2-15 | Lazily create short-lived finance signed URLs. |

### File and migration boundaries

Pranav may edit:

- `app/finance.tsx`
- finance-specific selectors in `app/globals.css` only; coordinate before touching shared selectors
- new migrations from `20260820020000` through `20260820025959`
- `tests/**`, `package.json`, and test/lint configuration

Pranav must not edit:

- `app/page.tsx`
- Nimalan's security/auth/storage migrations
- any existing applied migration
- club/subgroup test files actively owned by Aditya

Suggested finance migrations:

- `20260820020000_enforce_finance_invariants.sql`
- `20260820021000_harden_finance_workflow_rpcs.sql`
- `20260820022000_audit_finance_documents.sql`

### Required verification

- Full lifecycle: member submits reimbursement with receipt → executive approves/rejects → approved request is paid exactly once.
- Receipt/object/link failure leaves no submitted-but-undocumented request and no orphaned object.
- Direct expense creates exactly one outflow; income creates exactly one inflow.
- Event-related expenses fail without the required evidence packet.
- Claims cannot skip states, exceed approved/requested amounts, or remain permanently partial because approval is null.
- Two concurrent allocation/payment attempts cannot exceed limits or create duplicate payments.
- Pending payments are excluded from cash totals; posted/cleared/voided behavior matches labels.
- Finance document add/remove actions appear in the audit trail.
- `npm test`, TypeScript, and finance-focused browser tests pass.

### Pull-request checklist for Pranav

```text
Branch: work/pranav/finance-reliability
Owned files/migrations changed:
Issue IDs completed:
Migration order and RPC signatures:
Finance lifecycles tested:
Failure/rollback cases tested:
Commands run:
Known follow-ups:
```

## Communication and contract changes

Use this template whenever one track needs another track to change something:

```text
Contract request
From:
To:
Issue ID:
Current behavior/signature:
Requested behavior/signature:
Reason:
Example input/output or SQL row:
Blocking or non-blocking:
```

Do not solve a cross-track request by editing the other owner's file. The owner implements it and replies with the final contract and commit SHA.

## Daily synchronization

At the beginning of each work session:

```bash
git status --short --branch
git fetch origin
git merge origin/main
```

Before pushing:

```bash
git diff --check
git status --short
git push -u origin HEAD
```

Do not force-push a branch another person uses. If conflicts appear in an owned file, stop and contact its owner rather than choosing `ours` or `theirs` blindly.

## Integration and merge procedure

Nimalan is the integration owner.

### 1. Freeze and prepare

- Each person pushes their final branch and posts the PR checklist.
- No new feature commits after the integration freeze unless Nimalan requests a fix.
- Confirm each branch started from the issue-register baseline and contains no unrelated files.

### 2. Create the integration branch

```bash
git switch main
git pull --ff-only origin main
git switch -c integration/issue-wave-1
```

### 3. Merge in dependency order

```bash
git merge --no-ff origin/work/nimalan/security-foundation
git merge --no-ff origin/work/pranav/finance-reliability
git merge --no-ff origin/work/aditya/club-workspaces-ui
```

Order rationale:

1. Nimalan establishes authentication, RLS, and shared security guarantees.
2. Pranav adds finance migrations and the finance client against that baseline.
3. Aditya adds the club/subgroup UI against the final membership/permission contract.

Resolve conflicts according to current intended behavior and file ownership. Never resolve a migration conflict by editing or deleting an already-applied migration.

### 4. Integration gates

Run all of the following before opening the final PR:

```bash
git diff --check origin/main...HEAD
npx tsc --noEmit --incremental false
npm run lint
npm test
npm run build
```

Also require:

- complete RLS actor matrix;
- migration replay against a clean test database;
- Supabase security and performance advisors;
- member, manager, executive, and admin browser flows;
- finance lifecycle and failure-recovery tests;
- shared-browser account-switch test;
- no secrets, generated output, temporary fixtures, or QA rows;
- a Vercel preview smoke test with no console/runtime errors.

### 5. Final PR and merge

- Push `integration/issue-wave-1` and open one PR into `main`.
- Each of the other two contributors reviews the parts outside their ownership area.
- Nimalan updates `docs/ISSUE_REGISTER.md` with completed/deferred status in the integration branch.
- Merge only after every gate passes or a failure is explicitly documented and removed from the claimed scope.
- After production deployment, repeat the critical auth, RLS, attendance, finance, calendar, and upload smoke tests before deleting work branches.

## Definition of done

A track is done only when:

- its assigned issue IDs have evidence against their acceptance criteria;
- authorization is enforced in the database, not only the UI;
- migrations are new, ordered, replayable, and advisor-checked;
- relevant type, lint, unit, integration, and browser tests pass;
- the PR lists contracts, risks, and remaining work;
- another contributor reviewed the changes;
- the branch contains only owned and explicitly coordinated files.
