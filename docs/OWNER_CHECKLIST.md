# Owner checklist

What only the owner of the club's accounts can do: settings in the Supabase, Vercel, Google and GitHub dashboards, and a few decisions. None of it is a code change, and none of it can be done from this repository. Each item says why it matters, where it is, what to set, how to check that it took, and what it costs.

How to read it:

- **Production** is the Supabase project the live site uses. **Test** is `bharat-sangeet-test`, which only the test suites use. A setting below is for Production unless it says otherwise; the Test project keeps email sign-in on on purpose (decision D7: the test accounts sign in with a password).
- The dashboards rename and move their menus. The names below are the ones in Supabase's, Vercel's and GitHub's public documentation in November 2026, written without access to the club's real projects, so **nothing here has been seen in your dashboard**. Where a feature depends on the paid plan it says so; confirm the plan's current limits on the vendor's pricing page before you rely on a number.
- Nothing in this repository holds a key, a password or the address of the Production project, and this file does not either: `<...>` is something you read from a dashboard.
- How to run, change and repair the site is in `docs/RUNBOOK.md`. Draft files for the automated chores (backup, keep-alive, error reporting) are in `docs/ops-templates/`; they do nothing until you copy them.

## Summary

| # | Item | Where | Plan | Before launch? |
|---|---|---|---|---|
| 1 | Administrator MFA | Supabase Auth, then a code and database change (design below) | Free (TOTP) | Recommended, needs a build first |
| 2 | Google-only sign-in | Supabase, Authentication, Sign In / Providers | Free | Yes |
| 3 | Leaked-password protection | Same page | Pro | Only if email sign-in stays on |
| 4 | Bounded sessions, JWT expiry | Supabase, Authentication, Sessions; Project Settings | Pro for time-box and inactivity | Decide |
| 5 | Upload size limit of 500 MiB or more | Supabase, Project Settings, Storage | Pro for anything above 50 MB | Yes, if recordings are that big |
| 6 | SMTP | Supabase, Authentication, Emails | Free | Only if the site sends email |
| 7 | Redirect allow-list and Site URL | Supabase, Authentication, URL Configuration; Google Cloud | Free | Yes |
| 8 | Custom domain | Vercel, Domains; optionally Supabase | Free (Vercel); paid add-on (Supabase) | Optional |
| 9 | Backups and point-in-time recovery | Supabase, Database, Backups | Pro and above | Yes |
| 10 | Pausing and keep-alive | Supabase | Free pauses; Pro does not | Yes on Free |
| 11 | Spend caps | Supabase, Organization, Billing; Vercel, Settings | Pro | Yes |
| 12 | Vercel environment variables | Vercel, Project, Settings, Environment Variables | any | Yes |
| 13 | Protect `main`, require the CI checks | GitHub, Settings, Rules | Free for public repos; paid for private | Yes |

## Decisions that are yours to make

Each has a recommendation and what it costs. The people who built the site cannot make these for the club.

| Decision | Options | Recommendation |
|---|---|---|
| **Error reporting.** Today nobody is told when the site breaks in someone's browser; the only signal is a member saying so | Nothing; a minimal beacon the club hosts; a service such as Sentry. `docs/ops-templates/error-reporting-options.md` lists each with what it learns about members | A minimal beacon that sends the message, the page name and the build, and nothing that names a person, once somebody is willing to read the result. Until then nothing, and a way for members to say "it broke" (a named email address). Do not install a third-party script without writing it into `docs/ASSETS.md` and the Content-Security-Policy |
| **Backup destination and retention.** Where does a copy of the database live that is not Supabase, and for how long | The plan's own daily backups only; plus a nightly dump to a private storage the club controls; plus point-in-time recovery | Daily backups of the plan (Pro) plus the nightly dump template (`docs/ops-templates/nightly-backup.yml`) into a private bucket or drive that is not in the Supabase account, kept 30 days of nightlies and 12 of monthlies. Files in Storage are in neither and need their own copy (see item 9) |
| **Keep-alive.** A Free project pauses after about a week without activity | Pay for Pro (no pausing); a scheduled request every few days (`docs/ops-templates/keep-alive.yml`); accept pauses | Pro, because the same plan gives the backups and the 500 MiB upload limit. A scheduled request is the bridge if the club stays on Free |
| **Which plan.** Items 3, 4, 5, 9, 10 and 11 all depend on it | Free; Supabase Pro | Pro. The upload limit of the recordings (item 5), the backups (item 9) and the no-pause rule (item 10) cannot be had on Free |
| **How strict administrator MFA is** and when it starts | Soft (required only for administrators who have enrolled), then strict; strict from the first day | Soft first, strict after every administrator has two factors enrolled (item 1) |
| **How long a session lasts** | Supabase's defaults (a session lasts until sign-out); an inactivity limit and a maximum life for everyone | Seven days of inactivity and thirty days in all (item 4) |
| **Whether Preview deployments may use the Production project** | Never; yes | Never. Previews use the Test project or a third project (item 12) |

## 1. Administrator MFA (P1-06)

**Why.** An administrator can change anybody's role, deactivate and delete accounts, and read the audit trail. Their sign-in is a Google account; if that account is taken over, so is the club. Supabase can ask for a second factor and records the result in the person's token. The database can then refuse the administrator functions unless the token says the second factor was used.

**What is already there.** Supabase Auth supports authenticator-app (TOTP) factors on every plan. Nothing in the portal enrols or asks for one, and no database function looks at it. So this is **three pieces of work in this order, and the third is the one that can lock people out**:

1. a screen in the portal where an administrator enrols an authenticator app and, after signing in, is asked for a code (the Supabase client has the calls: enrol, challenge, verify, and a call that says which assurance level the session has);
2. every administrator enrols, and enrols a second factor as a spare;
3. only then a database migration that makes the administrator functions require the second factor.

### The design of step 3 (no SQL is written here)

**The signal.** After the person has entered a code, Supabase issues a new token whose claim `aal` is `aal2`. Before that, and for anyone who signed in with Google only, it is `aal1`. A database function reads it as `auth.jwt()->>'aal'`; a missing claim (the SQL editor, a migration, the service role) is not `aal2`. The same token carries a list `amr` of how the person authenticated; the design does not need it.

**Which functions.** The check is added in one place and used by what is admin-only today. Today those are the five administrator functions and two read policies, and nothing else in the database calls `private.is_admin()`:

| What | Defined in | Does |
|---|---|---|
| `admin_change_member_role` | `20260812000000_admin_console.sql`, `20261126232000_member_deactivation.sql` | Sets a role |
| `admin_delete_member` | same two files | Deletes an account that has no history |
| `admin_deactivate_member` | `20261126232000`, `20261127041000`, `20261127041100` | Deactivates, with a reason |
| `admin_reactivate_member` | `20261126232000`, `20261127041000` | Reactivates |
| `admin_update_member_profile` | `20260827000000`, `20261126230100`, `20261127040100` | Edits another person's profile |
| policy "Admins view audit log" on `admin_audit_log` | `20260812000000_admin_console.sql` | Reads the administrators' audit trail |
| policy "Admins read deactivation records" on `member_deactivations` | `20261127041000_deactivation_record_admin_only.sql` | Reads why somebody was deactivated |

The latest definition of each function is the one in the newest file listed; the new migration restates it with the one condition changed. **Not touched:** `private.is_admin()` itself (leave it as it is, so every other use keeps working), `private.is_executive()` (executives, including approving sign-ups and all the finance work, never need the second factor: an executive is not asked for a code and loses nothing), and the guard on `profiles.role` and `profiles.status`.

**How the condition is written.** A new helper next to `private.is_admin()` (call it the "administrator at assurance level 2" check) is true when the person is an active administrator and `auth.jwt()->>'aal'` equals `aal2`. The seven places above call it instead. In the policies it must be written as a sub-select (`(select ...)`), the way the other policies are since `20261127011000_rls_initplan.sql`, so it is evaluated once per statement. A refused call answers with a sentence the screen can show ("Confirm with your authenticator app to use the Admin pages") and a distinct error code, so the portal can send the person to the code prompt instead of showing a red box.

**Soft first, strict second (recommended).** In the first migration the helper requires `aal2` only for an administrator who **has a verified factor** (a row for them in `auth.mfa_factors` with status `verified`; the function is a definer function, so it can read it). It locks nobody out who has not enrolled, and each administrator who enrols is protected from that moment. It does not protect against a thief who takes over a session of an administrator who never enrolled (the thief could enrol a factor of their own), which is why it is a stage, not an end. When every active administrator has enrolled, a second migration drops the "has a verified factor" clause. Strict from the first day is the same migration without the first stage; take it only when every administrator has already enrolled and been tested.

**What the portal needs first** (not built; it is a feature for the Admin area, not the platform): the enrolment screen with its QR code and the confirmation of the first code; the code prompt when the Admin page is opened at `aal1`; a refresh of the session after verification so that the new token is the one in use (the token the browser holds stays `aal1` until it is refreshed or replaced); and a sentence when a refused call says the second factor is missing.

**The tests that need to change with it.** The SQL suites call the administrator functions with a made-up token; they need `aal2` in the claims for the cases that expect success, plus new cases: `aal1` is refused, no claim is refused, an executive is unaffected, a non-administrator at `aal2` is still refused. The browser suite and the API suite sign in the administrator of the Test project with a password, which is always `aal1`: that account needs an authenticator factor on the Test project too, with its secret kept with the other test secrets (never in the repository), and the suites then compute the six-digit code themselves. This is the largest cost of strict mode and should be planned for, not discovered.

**Lock-out risks, and what stops each.**

| Risk | Stopped by |
|---|---|
| The migration goes out before the screen exists, so no administrator can reach `aal2` | Order: screen, enrolment, then migration. The soft stage is safe even if somebody forgot to enrol |
| An administrator loses the phone | Two factors per administrator (Supabase allows several; check the limit in the documentation), enrolled on two devices or one device and a password manager that stores the secret. Supabase does not issue recovery codes for authenticator factors |
| The only administrator loses the phone | Break-glass, below. Hence: **always two active administrators**, each with two factors (`docs/RUNBOOK.md`, section 5) |
| A refresh keeps the old token | A token's `aal` is a fixed claim until it is refreshed; after enrolling or removing a factor, sign out and in, or refresh the session |
| A mistake in the helper locks out the administrator functions for everybody | Rollback, below. Only the Admin pages and the five functions are affected: members, executives, finance, attendance and the rest of the portal keep working, because they do not call the administrator check |

**Rollback.** One migration, written ahead of time and kept next to the first one: it restates the seven places with their current definition (the files listed above are the exact text), calling `private.is_admin()` again. Apply it in the SQL editor if the new check refuses someone it should not. It loses no data and changes no row. The helper can stay in place unused or be dropped.

**Break-glass: nobody can reach `aal2`.** The project owner signs in to the Supabase dashboard, which is independent of the portal. The administrator functions refuse the SQL editor on purpose (it has no signed-in person), so the editor repairs the cause, not through the functions: remove the stuck person's factors (Authentication, Users, the person, "Remove MFA factors"; if the dashboard has no such entry, delete that person's rows from `auth.mfa_factors` in the SQL editor, which runs as the database owner), then the person signs in again, at `aal1`, and enrols afresh; in soft mode that works at once, in strict mode they cannot, so the break-glass in strict mode is to apply the rollback migration, enrol, and apply the strict one again. Write down who did it and why. Do not build a portal function that removes somebody else's factor: it would be the way around the control.

**Acceptance (the register's wording for P1-06).** The number of administrators is as small as the club can bear (two); every active administrator has enrolled; the five functions and two policies refuse `aal1`; and the SQL and browser suites prove each of those.

## 2. Google-only sign-in (P1-11)

**Why.** The portal's own screens only offer Google. But Supabase Auth also answers the email and password sign-up and sign-in calls, to anybody who has the public key (which is in every page of the site). Three accounts with an email identity already exist next to the Google ones. A person who signs up that way goes through the same approval queue (everybody starts `pending`), but a password is a second front door that nobody watches, and nothing checks that the email address belongs to the person.

**What to do.** In the Production project: Authentication, Sign In / Providers. Turn **Email** off (or, if you want the email address flow kept, leave it on and do item 3 and keep "Confirm email" on). Check Google is on, and that "Allow new users to sign up" is on (it is how Google sign-ups arrive). Then the three existing email identities: find them (below) and decide for each person: delete the identity, or ask them to sign in with Google and let the account be linked by the same verified address.

**How to check.** From any computer, with the project address and the public key from the project's settings:

- an email sign-up call to `<project>/auth/v1/signup` with a made-up address answers an error such as "Email signups are disabled" (and creates nothing);
- the sign-in screen of the site still sends a person to Google and, once approved, in.

To list the email identities, in the SQL editor (read only): `select u.email, i.provider, u.created_at from auth.identities i join auth.users u on u.id = i.user_id where i.provider = 'email' order by u.created_at;`

**Cost and trade-off.** Free. It also switches off password sign-in for anybody who has only a password, so list them first. **Do not do this on the Test project:** the browser and API suites sign in with passwords (D7).

## 3. Leaked-password protection

**Why.** Supabase can refuse a password that appears in a public breach list (checked against a service that holds password hashes, not the password itself). It is only relevant when email and password sign-in is on.

**What to do.** Authentication, Sign In / Providers, Email, the password-strength settings: turn on "Prevent use of leaked passwords", and set a minimum length of at least 12 and require a mix. If you did item 2 and turned Email off, there is nothing to protect: record "not applicable, email sign-in is off".

**Plan.** Pro and above, as far as Supabase's documentation says. The advisor in the dashboard (Advisors, Security) lists it as a warning while it is off; that warning is the check.

## 4. Bounded sessions, JWT expiry and inactivity (P2-14, decision D2)

**What is true today.** The portal stores the session in the browser (`persistSession`, `autoRefreshToken`: `lib/supabase.ts`). Supabase's default is that a session lasts until the person signs out; the access token (the JWT) is renewed every hour and the refresh token keeps working. A shared computer that is not signed out stays signed in.

**Decision D2 (already taken): deactivating a person blocks them by row-level security only.** Their sign-in and their token stay valid; every table and file policy refuses them, and the portal shows the deactivated notice. So **shortening sessions is not what makes deactivation work**; it only shortens how long a lost or shared device stays signed in.

**What to set** (Authentication, Sessions; Project Settings, JWT):

| Setting | Meaning | Suggested |
|---|---|---|
| Time-box user sessions | Everybody is signed out this long after they signed in | 30 days |
| Inactivity timeout | Signed out after this long without a refresh | 7 days |
| JWT expiry | How long one access token lives | Leave at one hour: shorter means more refresh calls; longer means a change of role takes longer to show in the token (the database does not use the role from the token, it reads the profile, so a role change is immediate) |
| Single session per user | A new sign-in ends the old one | Off: a member uses a phone and a laptop |

These settings are project-wide: they cannot be set for administrators only. Time-box and inactivity are a Pro-plan feature as far as Supabase's documentation says. If the club stays on Free, the only lever is the portal's own code (an inactivity sign-out for administrators), which is not built.

**How to check.** Sign in, leave the tab for longer than the inactivity limit (use a short limit once to see it, then set the real one), and reload: the sign-in screen appears.

## 5. Upload size limit of at least 500 MiB

**Why.** The migration `20261128030600_storage_bucket_limits.sql` limits recordings and archive files to 500 MiB per file, notation to 25 MiB and the library to 100 MiB. Supabase also has a project-wide limit (Project Settings, Storage, "Upload file size limit"); **the smaller of the two wins**. A new project's limit is small: **on the Free plan it cannot be raised above 50 MB**, so a rehearsal recording of 200 MB is refused whatever the bucket says.

**What to do.** On Pro, set the project-wide limit to 500 MiB or more. On Free, either accept 50 MB (and tell members to record shorter takes or export a smaller file) or go to Pro; the bucket limit then stays higher than the project's and does no harm.

**How to check.** Upload a recording a little under 500 MiB as a member (or an executive) and see it accepted; one a little over is refused with a message from Storage. A single request carrying a file this size needs a good connection: the portal sends it in one request.

## 6. SMTP (sending email)

**Why.** Supabase's built-in mailer is for trying things out: it sends a few emails an hour, only to addresses of the project's own team, and from an address nobody recognises. The portal as built sends **no email at all** with Google-only sign-in: Auth sends mail only for email sign-up, magic links, email changes and invitations. So this item is **not needed** until one of these is switched on: email sign-in (item 2), invitations, or notifications ("Nobody is told", `docs/KNOWN_GAPS.md`, section 2: an approval is learned by signing in again).

**What to do if you need it.** Authentication, Emails (SMTP settings): set up a custom SMTP provider with a sender address on a domain the club owns, with SPF, DKIM and DMARC records at the registrar (item 8), and send a test.

**Cost.** The provider's own plan; most have a free allowance.

## 7. Redirect allow-list and Site URL

**Why.** After Google sign-in, Supabase sends the browser back to the address the portal gave (`window.location.origin`, `features/public/components/login-screen.tsx`). Supabase only does so for addresses on its allow-list; anything else goes to the Site URL. A list that is too wide lets an attacker's site receive the sign-in; one that is too narrow breaks sign-in on the real site.

**What to do.** Production project, Authentication, URL Configuration:

- **Site URL**: the production address of the site, `https://<the club's domain>` with no path.
- **Redirect URLs**: exactly that address (and `https://<domain>/**` only if some page other than the root ever receives the return). **No** wildcard for `localhost`, no `*.vercel.app`: see "Previews" in item 12. The Test project is where `http://localhost:*` and preview addresses go.

In Google Cloud (the OAuth client the Supabase Google provider uses; the Supabase Google provider page shows the callback address): the authorised redirect URI is the Supabase callback `https://<project ref>.supabase.co/auth/v1/callback` and nothing else; the consent screen's publishing status is **In production** (a project left in "Testing" limits sign-in to listed test users and expires their access after seven days); the authorised domains are the club's.

**How to check.** Sign in on the production address, from a private window, with a Google account that is approved. Then try to start the sign-in from a Preview address: it must not return to a Production page.

## 8. Custom domain

**Why.** A domain the club owns survives a change of host and looks like the club. Optional.

**What to do.**

1. Vercel, the project, Settings, Domains: add the domain; at the registrar add the records Vercel shows; Vercel issues the certificate. Check `https://<domain>/` answers and `http://` redirects to it.
2. Then, in this order: Supabase Site URL and Redirect URLs (item 7) get the new address; Google's authorised domains get it. The old address can stay on the list for a week.
3. After the first deployment on the domain, check the headers (the last section here): Vercel adds `Strict-Transport-Security`; the portal's `next.config.ts` deliberately does not.
4. If you also buy Supabase's custom-domain add-on so that sign-in and files come from the club's own name: `NEXT_PUBLIC_SUPABASE_URL` becomes that address, **a new deployment is needed** (the address is copied into the page and into the Content-Security-Policy at build time, `next.config.ts`), and Google's authorised redirect URI gets the new callback.

**Cost.** The domain's yearly fee; Supabase's add-on is paid.

## 9. Backups and point-in-time recovery

**What each plan gives** (Supabase's documentation, to be confirmed on the Database, Backups page of the project):

| Plan | Database backups | Point-in-time recovery |
|---|---|---|
| Free | None offered by Supabase: a dump you take yourself is the only copy | No |
| Pro | A daily backup, kept for 7 days | An add-on, retention 7 to 28 days; needs a minimum compute size |
| Team and above | Daily, kept longer | Add-on |

**What none of them cover.** Database backups hold the rows, including the *list* of files in Storage, but **not the files**. Recordings, receipts, PDFs and notation are only in the buckets. A lost project or a deleted bucket loses them even with a perfect database restore. If the club cares, the files need their own copy (Storage speaks an S3-compatible interface; a sync tool run on a schedule can copy it). This is not in the templates; it is a decision (the table at the top).

**What to do.**

1. Decide the plan (above).
2. Add the nightly dump (`docs/ops-templates/nightly-backup.yml`): it needs a repository secret `SUPABASE_DB_URL` (the connection string from Project Settings, Database, with the database password: a secret, never committed) and a place to put the dump that is not the repository (a private bucket or drive; the template has the step marked, and it does **not** store the dump as a public artifact).
3. **Rehearse a restore once** (`docs/RUNBOOK.md`, section 4) into a scratch project or a local database, before you need it.

**How to check.** The newest backup is under a day old (Database, Backups); the dump of last night opens (`pg_restore --list`) and has the tables you expect.

## 10. Pausing and keep-alive

**What happens.** A project on the Free plan is paused after about a week of inactivity. A paused site shows an error on every page that needs data. The project can be restored from its dashboard, within a window Supabase states (about 90 days; after that the data can only come back from your own backup). A Pro project is not paused.

**What to do.** Either go to Pro (the recommendation), or schedule a request: `docs/ops-templates/keep-alive.yml` makes a harmless read of the public interface with the public key every few days. It must be copied to `.github/workflows/`, and GitHub switches off scheduled workflows of a public repository that nobody has pushed to for 60 days (it emails the owner; a private repository is not affected), so look at the Actions tab from time to time. A request is not guaranteed to count as activity in Supabase's own rule: after you start it, watch the project for two weeks.

**How to check.** The project's page shows "Active"; the Actions tab shows the workflow's runs.

## 11. Spend caps

**Why.** A service that bills by use can bill a lot if something goes wrong: an upload loop, a leaked key used by somebody else, a very popular recording.

**What to do.**

- Supabase, Organization, Billing: on Pro there is a **Spend Cap**, on by default; with it on, usage beyond the plan's allowance is restricted instead of billed. Leave it on unless you have a reason; set up the usage alert emails.
- Vercel: on Pro, Settings, Billing, **Spend Management** lets you set an amount, get notified and, if you choose, have deployments paused when it is reached. On the free Hobby plan nothing is billed, and the project stops at its limit. Do not run a Hobby project for a club with real members, as Vercel's terms restrict Hobby to non-commercial personal use; read the terms for a club.

**Cost.** None to set. Know the monthly amounts you accept before you pick them.

## 12. Vercel environment variables

**What the site needs.** Exactly two:

| Name | Value | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The project address, `https://<project ref>.supabase.co` | Yes. It is copied into the page and is also what the Content-Security-Policy is built from |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (starts `sb_publishable_`) | Yes, by design: it is in every page, and row-level security is what protects the data |

Anything with the prefix `NEXT_PUBLIC_` is visible to every visitor. **There is no variable the site needs that is secret.** The project's secret key (`service_role` / `sb_secret_`), the database password and the connection string are **never** put in Vercel: nothing in the site uses them, and a variable there is one build log away from public.

**What to set, and per environment.**

- **Production** environment: the Production project's two values.
- **Preview** environment: the **Test project's** two values (or a third project made for previews). A Preview with Production's values writes to the real data (`docs/RUNBOOK.md`, section 1).
- **Development**: not used (local work uses `.env.local`, which git ignores).
- After changing a value, **redeploy**: it is baked into the build, including the Content-Security-Policy.

**How to check.** On a deployment, open the page source and find the project address: it must be the one for that environment. `curl -sI https://<domain>/` shows the policy and its `connect-src` names that same project (next section).

## 13. Protect `main` and require the CI checks

**Why.** `main` deploys to Production. Anything that reaches it without a check is live.

**What to do.** GitHub, the repository, Settings, Rules (rulesets) or Branches: protect `main` so that

- changes arrive by pull request, with at least one approval (two people, or the owner, and nobody approves their own);
- the three checks of `.github/workflows/ci.yml` must pass: **`app`**, **`contract`** and **`database`** (they appear under those job names on a pull request), and the branch must be up to date with `main`;
- force-pushes and deletion of `main` are refused, and **administrators are not exempt**;
- the push of a secret is refused (GitHub's secret scanning and push protection, under Settings, Code security).

Note that rules on a private repository need a paid GitHub plan; on a public one they are free.

**Also, in the repository's secrets** (Settings, Secrets and variables, Actions): the CI workflow today uses placeholder values and needs none; the browser suite is run by hand against the Test project. The optional workflows in `docs/ops-templates/` need `SUPABASE_DB_URL` (backup) and the project address and publishable key (keep-alive); add them only when you turn those on.

**How to check.** Open a pull request with a failing test: the merge button is disabled. Try to push to `main` directly: it is refused.

## After any of the above: check what the site sends

Once the site has been deployed on its real address, once, and again after a change of domain or of `NEXT_PUBLIC_SUPABASE_URL`:

`curl -sI https://<domain>/` should show, among others: `content-security-policy` (its `connect-src` and `img-src` name your Supabase project, and nothing else outside the club except the one hero picture noted in `docs/ASSETS.md`), `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `x-frame-options: DENY`, `permissions-policy`, `cross-origin-opener-policy: same-origin-allow-popups`, and **`strict-transport-security`** (Vercel sends it; the site does not). **If `strict-transport-security` is missing**, add the header to `next.config.ts` (one line, `max-age=63072000`; add `includeSubDomains` only when every subdomain of the domain is served over HTTPS) and tell whoever maintains the code.

What the headers do not cover is in `docs/KNOWN_GAPS.md`, section "What the security headers do not cover".
