# Browser timings (R1, real browser against the test Supabase project)

First real-browser check of Phases 1 and 2. Everything here was measured by `npm run test:browser:timings` (`tests/browser/specs/timings.spec.mjs`) and
turned into tables by `tests/browser/tools/timings-report.mjs`. The raw numbers are in `tests/browser/.out/timings*.json` (git-ignored).

## How, and on what

| | |
|---|---|
| Date | 27 Nov 2026, 23:15 to 23:50 UTC |
| Code | branch `phase-2-5-r1-browser` (= `phase-2-latency` 4dc9c1a plus the browser suite; nothing under `app/`, `components/`, `lib/` changed), production build (`next build`, `next start`) |
| Machine | a cloud container: 4 vCPU, 16 GB, headless Chromium 1243 (Playwright 1.63.0, software rendering, no GPU), one worker, nothing else running |
| Network | the app is served from `localhost` (so the HTML and JavaScript cost almost nothing); only the Supabase traffic crosses the agent proxy to the hosted test project `bldytniesexkwbtyinsi`. The floor is about 80 ms round trip: the quickest request of the whole run took 78 ms and a typical simple read 90 to 120 ms |
| Data volume | **small, fixture only**, one fixture set on a project that had just been cleaned: 11 profiles, 2 groups (8 memberships), 3 events, 2 announcements, 1 recording, 5 resources, 2 attendance sessions (5 records), 7 club expenses, 4 reimbursements, 5 payments, 10 finance documents, 1 funding claim. Nothing here says how the screens behave with 5,000 recordings or 20,000 attendance records |
| Runs | 5 per role and screen, for each of two ways of arriving (below), plus 5 per screen for revisits and 5 per role for the first paint; 275 timed runs in all. **Every run uses a new browser context**: empty HTTP cache, no in-page cache, only the saved sign-in |
| Roles | member, group manager (a plain member who manages a group), executive, admin; the deactivated member for the notice screen |
| Unexpected problems | **0** in all 275 runs: no console error, page error, failed request or HTTP 4xx/5xx |

* **Opening the address** (`/?page=finances`, as a bookmark or a reload does): the clock starts when the navigation is committed.
* **Clicking the navigation entry**: the Overview is already up and idle; the clock starts at the click.
* **Time to content** is the time until every landmark of the screen is visible. The landmarks are the same ones the tests use and they are
  real content (a fixture's title, a member's card), not just the heading, because several screens print their heading first and load data
  later. The check polls, so it has a resolution of a few tens of ms.
* **Waves**: requests that leave within about 150 ms of each other count as one wave. A screen that needs the answer of one request before it
  can send the next shows 2 waves.
* The sign-in itself is not measured: the session is injected, so the first request is the portal's own `get_portal_bootstrap`.
* A fresh context pays DNS, TCP and TLS on its first Supabase request, which is why the bootstrap is the slowest request (median 392 ms, against 110 ms for a
  request on a connection that is already open).

## Against the Phase 2 targets (`IMPLEMENTATION_PLAN.md`, 2.2, 2.6, 2.7 and section 10)

| Target | Measured | Verdict |
|---|---|---|
| 2.2: sign-in to Overview in **1 request** (6 before) | `rpc get_portal_bootstrap` only, for every role, in every run | Met. Overview is on screen after about 0.86 to 0.99 s (median) on a full load |
| 2.7: Overview with at most 2 data requests | 1 | Met |
| Calendar needs no request of its own | 0 requests after the bootstrap, on a click and on a full load | Met (the events travel with the bootstrap) |
| 2.2: attendance in **1 request** (8 before), "including the 10 second poll" | `rpc get_attendance_overview` once on opening, then `rpc get_attendance_pulse` every 10 s (35 s idle: 3 pulses at 8.1, 18.1 and 28.1 s), one request each, for members as well as executives | Met. The function names differ from the plan's `get_attendance_workspace`; the numbers match |
| 2.6: finance in **one parallel wave** (three in sequence before) | 7 requests (member) or 11 (executive, admin), all leaving within about 25 ms of each other | Met as a wave. As a count of requests it is the largest screen |
| "Each screen needs one or two round trips" | One wave after the bootstrap on every screen; 2 waves on a full load (bootstrap, then data) | Met as round trips. **Not met as a count of requests**: Groups 5 (and `subgroup_memberships` twice), Members 3, Resources 3, Finance 7 or 11 |
| "Revisiting a screen is instant" | Second visit shows content after 73 to 106 ms for Members, Attendance, Recordings, Resources and Finances, still re-requesting in the background. **Groups is not instant**: 250 to 260 ms and 5 requests, as on the first visit | Met except for Groups |
| 2.3: "remove duplicate loads of subgroups, memberships and profiles across sections" | `GET subgroup_memberships` is sent twice by Groups in every run; Groups, Members and Admin each send their own read of `subgroup_memberships`, and Members and Admin their own read of `profiles` | Partly. The plan's own status (section 10) already says 2.3 is partial |
| 2.6: resource thumbnails signed in one request per bucket | Not observable: the fixtures have no image resources | Not verified |
| 2.6: `next/dynamic` for finance, attendance, resources, recordings | The code is loaded only when the screen is first opened (a script of its own, 60 to 90 ms to arrive); this has a cost, see below | Done, with a cost |
| 2.6: public concert page rendered on the server and cached | The landing page is prerendered, which is what a signed-in visitor sees first, see below | Done, with a side effect |

## Where real behaviour differs from what the plan says, plainly

1. **The first open of Attendance, Recordings, Resources and Finances waits about 0.3 s before it asks for any data.** The screen's script is
   on the page after 60 to 90 ms, but its first Supabase request leaves at 335 to 365 ms after the click (30 ms for Groups and Members, which are not lazy).
   Nothing keeps the main thread busy in that time (the longest task seen was 54 ms) and no network request is pending, so it is a wait. On a full load the same gap sits between the
   bootstrap answer and the data request, which is why those screens show content after 1.0 to 1.5 s (Resources at the low end) while Overview, Calendar, Groups and Members show it after 0.85 to 1.0 s.
   Once the script has been loaded the wait is gone (revisit: 75 ms). The likely cause is React holding back the reveal of a lazy screen for 300 ms
   after its "Loading..." fallback appeared (the Suspense throttle); this is not proven. A way to remove it: load the screens' scripts in the
   background after the Overview is up, or start the data request outside the lazy component, or open the screen in a transition. See finding F5.
2. **A signed-in visit to `/` shows the public landing page first.** What is on top, frame by frame: the prerendered public landing page
   from about 80 ms to about 240 ms (about 0.16 s), the "Opening the club archive..." loading screen until about 660 ms, then the portal.
   This is the price of prerendering `/` for the public concert archive. It happens in 5 of 5 runs for every role. See finding F3.
3. **Groups opens with 5 requests, one of them twice, and is the only screen the cache does not make instant.** See findings F4 and F6.
4. **Finance is 7 requests for a member and 11 for an executive or admin**, all in one wave, which is as designed, but it is 4 to 6 times the plan's
   "one or two" in count. The requests go out together and each takes 90 to 150 ms, so the wave costs about one round trip here; the count
   matters for the database load and for a slower or flaky link, not for this measurement.
5. Resources sends 2 `HEAD` requests (counts of archived and non-archived rows) next to the list. Counted, not judged.

## Navigation timing and weight (full loads, all roles, 145 runs)

Time to first byte 8 ms (4 to 20), DOMContentLoaded 112 ms (31 to 230), load event 157 ms (93 to 344), first contentful paint 140 ms (80 to 304).
Transferred per full load: 440 KB (426 to 510). These are small because the app is local; the numbers that depend on the network are the Supabase ones in the tables.

## Tables

All times are milliseconds. "Median / worst" is over 5 runs. "Problems" counts unexpected console errors, page errors, failed requests and 4xx/5xx.

### Opening the address (full page load, empty cache)

| Role | Screen | Content visible, median / worst (ms) | Supabase requests, median / worst | Waves | Requests (median) | Repeated requests | First contentful paint (median ms) | Problems |
|---|---|---|---|---|---|---|---|---|
| member | home | 855 / 933 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 108 | 0 |
| member | groups | 877 / 910 | 6 / 6 | 2 | rpc get_portal_bootstrap, GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | 108 | 0 |
| member | calendar | 890 / 902 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 116 | 0 |
| member | members | 844 / 857 | 4 / 4 | 2 | rpc get_portal_bootstrap, GET profiles, GET subgroups, GET subgroup_memberships | - | 88 | 0 |
| member | attendance | 1436 / 1479 | 2 / 2 | 2 | rpc get_portal_bootstrap, rpc get_attendance_overview | - | 144 | 0 |
| member | recordings | 1482 / 1497 | 2 / 2 | 2 | rpc get_portal_bootstrap, GET recordings | - | 156 | 0 |
| member | documents | 1180 / 1473 | 4 / 4 | 2 | rpc get_portal_bootstrap, HEAD resources x2, GET resources | HEAD resources x2 | 148 | 0 |
| member | finances | 1424 / 1463 | 8 / 8 | 2 | rpc get_portal_bootstrap, rpc get_finance_summary, GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents | - | 164 | 0 |
| manager | home | 985 / 1023 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 168 | 0 |
| manager | groups | 935 / 969 | 6 / 6 | 2 | rpc get_portal_bootstrap, GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | 164 | 0 |
| manager | attendance | 1413 / 1469 | 2 / 2 | 2 | rpc get_portal_bootstrap, rpc get_attendance_overview | - | 152 | 0 |
| manager | finances | 1413 / 1425 | 8 / 8 | 2 | rpc get_portal_bootstrap, GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary | - | 156 | 0 |
| executive | home | 919 / 940 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 144 | 0 |
| executive | groups | 910 / 942 | 6 / 6 | 2 | rpc get_portal_bootstrap, GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | 144 | 0 |
| executive | calendar | 943 / 978 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 172 | 0 |
| executive | members | 926 / 1009 | 4 / 4 | 2 | rpc get_portal_bootstrap, GET profiles, GET subgroups, GET subgroup_memberships | - | 144 | 0 |
| executive | attendance | 1401 / 1493 | 2 / 2 | 2 | rpc get_portal_bootstrap, rpc get_attendance_overview | - | 116 | 0 |
| executive | recordings | 1394 / 1425 | 2 / 2 | 2 | rpc get_portal_bootstrap, GET recordings | - | 104 | 0 |
| executive | documents | 975 / 1353 | 4 / 4 | 2 | rpc get_portal_bootstrap, GET resources, HEAD resources x2 | HEAD resources x2 | 88 | 0 |
| executive | finances | 1392 / 1442 | 12 / 12 | 2 | rpc get_portal_bootstrap, GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, rpc get_finance_summary, GET finance_reimbursement_documents, GET funding_claims, GET funding_claim_expenses, GET finance_claim_documents, GET profiles | - | 128 | 0 |
| admin | home | 860 / 892 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 100 | 0 |
| admin | groups | 918 / 980 | 6 / 6 | 2 | rpc get_portal_bootstrap, GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | 136 | 0 |
| admin | calendar | 947 / 1022 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 172 | 0 |
| admin | members | 904 / 998 | 4 / 4 | 2 | rpc get_portal_bootstrap, GET profiles, GET subgroups, GET subgroup_memberships | - | 140 | 0 |
| admin | attendance | 1397 / 1445 | 2 / 2 | 2 | rpc get_portal_bootstrap, rpc get_attendance_overview | - | 144 | 0 |
| admin | recordings | 1494 / 1498 | 2 / 2 | 2 | rpc get_portal_bootstrap, GET recordings | - | 148 | 0 |
| admin | documents | 1159 / 1404 | 4 / 4 | 2 | rpc get_portal_bootstrap, GET resources, HEAD resources x2 | HEAD resources x2 | 120 | 0 |
| admin | finances | 1374 / 1402 | 12 / 12 | 2 | rpc get_portal_bootstrap, GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary, GET funding_claims, GET funding_claim_expenses, GET finance_claim_documents, GET profiles | - | 112 | 0 |
| admin | admin | 943 / 1023 | 5 / 5 | 2 | rpc get_portal_bootstrap, GET profiles, GET announcements, GET admin_audit_log, GET subgroup_memberships | - | 148 | 0 |
| deactivated | notice | 937 / 997 | 1 / 1 | 1 | rpc get_portal_bootstrap | - | 0 | 0 |

### Clicking the navigation entry (shell already open)

| Role | Screen | Content visible, median / worst (ms) | Supabase requests, median / worst | Waves | Requests (median) | Repeated requests | First contentful paint (median ms) | Problems |
|---|---|---|---|---|---|---|---|---|
| member | groups | 217 / 228 | 5 / 5 | 1 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | n/a | 0 |
| member | calendar | 37 / 69 | 0 / 0 | 0 | none | - | n/a | 0 |
| member | members | 231 / 335 | 3 / 3 | 1 | GET profiles, GET subgroups, GET subgroup_memberships | - | n/a | 0 |
| member | attendance | 849 / 856 | 1 / 1 | 1 | rpc get_attendance_overview | - | n/a | 0 |
| member | recordings | 545 / 846 | 1 / 1 | 1 | GET recordings | - | n/a | 0 |
| member | documents | 559 / 894 | 3 / 3 | 1 | GET resources, HEAD resources x2 | HEAD resources x2 | n/a | 0 |
| member | finances | 835 / 852 | 7 / 7 | 1 | GET finance_expenses, rpc get_finance_summary, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents | - | n/a | 0 |
| manager | groups | 239 / 262 | 5 / 5 | 1 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | n/a | 0 |
| manager | attendance | 851 / 862 | 1 / 1 | 1 | rpc get_attendance_overview | - | n/a | 0 |
| manager | finances | 358 / 849 | 7 / 7 | 1 | GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary | - | n/a | 0 |
| executive | groups | 235 / 260 | 5 / 5 | 1 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | n/a | 0 |
| executive | calendar | 62 / 84 | 0 / 0 | 0 | none | - | n/a | 0 |
| executive | members | 236 / 245 | 3 / 3 | 1 | GET profiles, GET subgroups, GET subgroup_memberships | - | n/a | 0 |
| executive | attendance | 821 / 833 | 1 / 1 | 1 | rpc get_attendance_overview | - | n/a | 0 |
| executive | recordings | 823 / 838 | 1 / 1 | 1 | GET recordings | - | n/a | 0 |
| executive | documents | 820 / 835 | 3 / 3 | 1 | GET resources, HEAD resources x2 | HEAD resources x2 | n/a | 0 |
| executive | finances | 839 / 846 | 11 / 11 | 1 | GET finance_expenses, GET personal_reimbursements, GET finance_payments, rpc get_finance_summary, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, GET funding_claims, GET funding_claim_expenses, GET finance_claim_documents, GET profiles | - | n/a | 0 |
| admin | groups | 243 / 341 | 5 / 5 | 1 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements | GET subgroup_memberships x2 | n/a | 0 |
| admin | calendar | 64 / 76 | 0 / 0 | 0 | none | - | n/a | 0 |
| admin | members | 239 / 246 | 3 / 3 | 1 | GET profiles, GET subgroups, GET subgroup_memberships | - | n/a | 0 |
| admin | attendance | 851 / 864 | 1 / 1 | 1 | rpc get_attendance_overview | - | n/a | 0 |
| admin | recordings | 545 / 820 | 1 / 1 | 1 | GET recordings | - | n/a | 0 |
| admin | documents | 557 / 831 | 3 / 3 | 1 | GET resources, HEAD resources x2 | HEAD resources x2 | n/a | 0 |
| admin | finances | 830 / 846 | 11 / 11 | 1 | GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary, GET funding_claims, GET funding_claim_expenses, GET finance_claim_documents, GET profiles | - | n/a | 0 |
| admin | admin | 255 / 281 | 4 / 4 | 1 | GET profiles, GET announcements, GET admin_audit_log, GET subgroup_memberships | - | n/a | 0 |

### Opening a screen a second time from the navigation (the Overview in between)

| Role | Screen | First visit, median (ms) | Second visit, median / worst (ms) | Requests on the second visit (median) | Which |
|---|---|---|---|---|---|
| member | groups | 233 | 263 / 280 | 5 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements |
| member | members | 241 | 80 / 99 | 3 | GET profiles, GET subgroups, GET subgroup_memberships |
| member | attendance | 857 | 78 / 93 | 1 | rpc get_attendance_overview |
| member | recordings | 545 | 76 / 84 | 1 | GET recordings |
| member | documents | 570 | 74 / 123 | 3 | GET resources, HEAD resources x2 |
| member | finances | 819 | 76 / 101 | 7 | GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary |
| executive | groups | 241 | 252 / 346 | 5 | GET subgroups, GET subgroup_memberships x2, GET archive_items, GET announcements |
| executive | members | 256 | 78 / 90 | 3 | GET profiles, GET subgroups, GET subgroup_memberships |
| executive | attendance | 854 | 78 / 82 | 1 | rpc get_attendance_overview |
| executive | recordings | 538 | 73 / 82 | 1 | GET recordings |
| executive | documents | 546 | 86 / 103 | 3 | GET resources, HEAD resources x2 |
| executive | finances | 571 | 106 / 131 | 11 | GET finance_expenses, GET personal_reimbursements, GET finance_payments, GET finance_documents, GET finance_expense_documents, GET finance_reimbursement_documents, rpc get_finance_summary, GET funding_claims, GET funding_claim_expenses, GET finance_claim_documents, GET profiles |

### What the open attendance screen sends by itself (35 seconds, nobody touching it)

| Role | Supabase requests in that time | Which, and at what second |
|---|---|---|
| executive | 3 | rpc get_attendance_pulse @8.1s, rpc get_attendance_pulse @18.1s, rpc get_attendance_pulse @28.1s |
| member | 3 | rpc get_attendance_pulse @8.2s, rpc get_attendance_pulse @18.2s, rpc get_attendance_pulse @28.2s |

### First paint of a signed-in visit to / (what is on top, ms since the navigation started)

| Role | Public landing page on top from / until (median) | Loading screen from / until (median) | Portal from (median) | Runs with the public page painted first |
|---|---|---|---|---|
| member | 85 / 236 | 236 / 673 | 673 | 5 of 5 |
| manager | 82 / 237 | 237 / 659 | 659 | 5 of 5 |
| executive | 76 / 246 | 246 / 657 | 657 | 5 of 5 |
| admin | 70 / 208 | 208 / 627 | 627 | 5 of 5 |

## How to repeat

```
npm run test:browser:timings                       # the main tables (about 14 minutes)
E2E_TIMINGS_FILE=timings-extra.json E2E_SUITE=timings npx playwright test -c tests/browser/playwright.config.mjs --grep "revisiting|open attendance screen|first paint"
node tests/browser/tools/timings-report.mjs        # merges every timings*.json in the output folder
```

Use `E2E_REUSE=1 E2E_KEEP=1 E2E_SKIP_BUILD=1` to measure on fixtures that already exist without seeding or building again.
Compare only runs made from the same place: a slower link or a busier machine moves every number.
