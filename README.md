# Bharat Sangeet at UNC Chapel Hill

Bharat Sangeet's shared digital home for the Carnatic music community at the University of North Carolina at Chapel Hill. The application combines a public club presence with private club-wide and subgroup workspaces for members, executives, and administrators.

## UI styling conventions

Tailwind CSS v4 is the default styling layer for new and substantially changed UI. Shared primitives live in `components/ui` and follow the shadcn/ui approach: small, composable, locally owned components whose variants are expressed with Tailwind utilities rather than a large runtime theme.

- Use `components/ui` primitives such as `Button`, `Badge`, and `Dialog` before creating a new control style.
- Use Tailwind utilities for component spacing, responsive grids, typography, states, and overflow behavior.
- Keep `app/globals.css` for product tokens, the existing shell, broad layout rules, and legacy surfaces that have not been migrated yet.
- Every constrained grid child should be allowed to shrink (`min-w-0`, `minmax(0, ...)`); long labels and tags must wrap instead of creating horizontal overflow.
- Keep the Carolina blue, dark navy/ink, ivory, and condensed editorial type system intact while migrating. The current identity is Carolina-led; `--maroon` is a legacy compatibility token and should not be used for new components.

### Migration boundary

The shared primitives are the migration seam. New or substantially changed controls should use `Button`, `Badge`, `Dialog`, `Input`, or `Textarea` and compose Tailwind utilities for layout. The older semantic selectors (`.primary`, `.secondary`, `.modal`, and page-specific shell classes) remain only where replacing them would change an existing surface without a visual review; do not extend those selectors for new UI. When a legacy surface is next touched, migrate its controls first, then remove its unused selectors from `app/globals.css`.

## Living roadmap

Last updated: **August 12, 2026**

This README is the project's source of truth for product direction. Update the checkboxes and decision log whenever a roadmap item is shipped or the club changes direction.

Legend: ✅ shipped · 🚧 in progress · 📌 planned · 💡 future idea

## Product model

- **Public site:** Club information and selected concert recordings for anyone.
- **Club workspace:** Announcements, dates, members, and resources shared across Bharat Sangeet.
- **Subgroup workspaces:** A member can belong to several subgroups, each with its own roster, recordings, documents, and attendance.
- **Permissions:** New accounts become members automatically. Executives manage club operations and all subgroups; administrators also manage identities and permissions.

## Current capabilities

- [x] Google sign-in and automatic member profile creation
- [x] Member names and contact-information directory
- [x] Public club page with a curated concert archive
- [x] Club-wide dashboard, calendar, documents, recordings, and photos
- [x] Switchable subgroup workspaces with open, approval-based, or invitation-only enrollment
- [x] Subgroup-specific documents and recordings
- [x] Subgroup rosters and attendance sessions
- [x] Executive finance ledger with income, expenses, categories, and running totals
- [x] Member reimbursement requests with receipt uploads, review, approval, and payment tracking
- [x] Senate/GPSG funding claim workspaces with requirement checklists and private supporting documents
- [x] Administrator tools for member removal, role changes, announcements, and audit history
- [x] Automatic production deployments from `main` and preview deployments from other Git branches

## Roadmap

### 1. Finance workspace — next priority

The finance ledger should be the source of truth. Balances must be calculated from transactions rather than entered manually.

- [x] Replace signed amounts with explicit cash direction and payment purposes for income, expenses, reimbursements, refunds, transfers, fees, and adjustments
- [x] Add separate lifecycle statuses for expenses, payments, reimbursements, and funding claims
- [x] Add payment accounts, transaction dates, categories, notes, counterparties, and related members
- [x] Associate expenses with a subgroup, calendar event, or documented external event
- [ ] Add receipt and invoice uploads with an in-page preview
- [ ] Expand the searchable cash ledger with date, category, subgroup, event, account, and status filters
- [ ] Add a transaction detail panel showing its receipt, approvals, and complete history
- [x] Show available cash, recorded income, club spending, pending reimbursements, and expected external funding
- [ ] Preserve approved transactions by voiding them with a reason instead of permanently deleting them
- [ ] Add CSV export for treasurer and university reporting

### 2. Reimbursements and budgets

- [x] Let members submit reimbursement requests with receipts and track their status
- [ ] Let treasurers request corrections or missing documentation
- [ ] Add review, approval, payment, and reconciliation steps
- [ ] Support club-wide, semester, subgroup, event, and category budgets
- [ ] Compare budgeted, committed, and actual spending
- [ ] Warn executives at configurable budget thresholds without automatically blocking valid spending
- [ ] Consider two-person approval for unusually large expenses

### 3. Self-service attendance

- [ ] Let an executive open a time-limited attendance session for a subgroup
- [ ] Generate a short code that members enter while the session is open
- [ ] Prevent members outside the subgroup from checking into its session
- [ ] Close sessions explicitly and calculate absences only after closure
- [ ] Allow executives to mark excused absences and correct exceptional cases
- [ ] Flag members after a configurable number of absences
- [ ] Notify relevant executives while keeping attendance private from other members
- [ ] Keep canceled rehearsals out of attendance calculations by not creating or by canceling their session

### 4. Subgroup-centered organization

- [ ] Make the workspace selector the consistent way to move between the whole club and a member's subgroups
- [ ] Show each workspace's overview, dates, documents, recordings, announcements, roster, and attendance in one logical place
- [ ] Distinguish club-wide resources from subgroup resources to remove redundant archive pages
- [ ] Add an enrollment-request queue for executives and subgroup managers
- [ ] Add clear join, pending, approved, waitlisted, and invitation-only states
- [ ] Preserve access for members who belong to multiple subgroups
- [ ] Add subgroup-level leadership permissions without granting full executive access

### 4a. Member roster administration

- [x] Let administrators edit member profile details and assign active subgroups in one workflow
- [x] Show subgroup tags on the member roster and filter the roster by subgroup

### 5. UI, reliability, and accessibility

- [ ] Replace remaining native-looking controls with accessible components that match the Carolina/classical visual system
- [ ] Add loading, disabled, success, error, and optimistic states to every mutation
- [ ] Confirm destructive actions and explain what data will be retained
- [ ] Improve mobile layouts, keyboard navigation, focus states, and screen-reader labels
- [ ] Add friendly empty states and first-use guidance for new members and executives
- [ ] Add automated tests for authentication, permissions, subgroup enrollment, uploads, and finance calculations
- [ ] Add monitoring for failed uploads, database errors, and failed production deployments

## Future ideas

- [ ] Email or in-app notifications for announcements, approvals, attendance flags, and upcoming dates
- [ ] Calendar subscription or Google Calendar synchronization
- [ ] Concert planning checklists and event-specific workspaces
- [ ] Semester rollover and archived seasons
- [ ] Member participation summaries that respect privacy
- [ ] Optional receipt data extraction after the manual finance workflow is reliable

## Technical guardrails

- Authorization must be enforced in the database, not only by hiding UI controls.
- All database changes should be captured as versioned migrations in `supabase/migrations/`.
- Financial balances must be derived from ledger entries.
- Approved financial records and administrative actions need an audit trail.
- Private subgroup content must require an active subgroup membership or an appropriate management role.
- Public concert recordings must be explicitly marked public; internal files remain private by default.
- Every asynchronous action needs visible feedback and a recoverable failure state.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-08-12 | Organize the member experience around club-wide and subgroup workspaces rather than disconnected resource pages. |
| 2026-08-12 | Allow members to belong to multiple subgroups and support open, approval-based, and invitation-only enrollment. |
| 2026-08-12 | Model attendance as real sessions; a canceled rehearsal creates no absence-producing session. |
| 2026-08-12 | Treat the finance ledger as the source of truth and preserve approved records through voiding and audit history. |
| 2026-08-12 | Separate purchases, cash payments, personal reimbursements, and external funding claims so linked workflows never double-count spending. |
| 2026-08-12 | Store sensitive finance files in a dedicated private area; statements must be PDFs and never appear in the general club archive. |
| 2026-08-12 | Deploy `main` automatically to production and use other branches for Vercel previews. |

## Updating this roadmap

When a change is made:

1. Mark completed roadmap items with `[x]`.
2. Add newly discovered work beneath the appropriate phase.
3. Record consequential product or architecture choices in the decision log.
4. Keep roadmap entries focused on user outcomes rather than implementation details.
5. Commit the README update with the related feature whenever possible.

## Local development

Requirements: Node.js `>=22.13.0` and a configured Supabase project.

```bash
npm install
npm run dev
npm run build
npm test
```

Create `.env.local` with:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Google authentication uses this Supabase callback URL:

```text
https://zykujvpioxkktqppeqpu.supabase.co/auth/v1/callback
```

Production: [bharat-sangeet-club.vercel.app](https://bharat-sangeet-club.vercel.app/)
