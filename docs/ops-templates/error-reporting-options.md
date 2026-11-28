# Error reporting: the options, and what each costs in privacy

**DRAFT. Nothing here is built or switched on.** It exists so that the owner can decide (`docs/OWNER_CHECKLIST.md`, "Decisions that are yours to make"). Nothing in this repository sends an error anywhere today.

## The situation

The portal runs in the member's browser. When something breaks there (a screen that throws, a request that fails in a way nobody expected, a recorder that cannot get the microphone), nobody but that member knows, and they usually do not say. The only signal is a member telling an executive. The database and Supabase's services are a separate case: Supabase keeps its own logs (below), which already show every failed request to the database.

The site has no server of its own to receive anything. Any option that reports from the browser needs somewhere to send the report, and that somewhere is a new thing the club depends on and a new place member information could end up. The Content-Security-Policy (`next.config.ts`) only lets a page talk to its own origin and to the club's Supabase project: any other destination needs a line added there and in `tests/security-headers.test.mjs`, which is on purpose.

## What counts as personal information here

A report can carry: the **message** and the file and line (harmless); the **address** of the page (the portal uses `?page=finances`: harmless; but a person's name or an id in an address would not be); the **IP address** and **browser** of the sender (sent with any request, and personal data under most privacy laws); anything the SDK collects on its own: **breadcrumbs** (the last clicks, console lines and requests, which here can carry table names, record ids and the text of a finance screen), the **user's identity** if the SDK is told who they are, a **recording of the screen** if "session replay" is on (the screens show receipts, amounts and names: never turn it on without masking everything). The club's members are students; the finance screens show money and files.

## The options

| | A. Nothing, and a way to say "it broke" | B. Supabase's own logs (already there) | C. A minimal beacon the club hosts | D. A hosted service (Sentry or similar) |
|---|---|---|---|---|
| What it learns | Only what a member writes | Every failed call to the database, sign-in and storage: status, route, time, error text. Nothing from the browser itself (a screen that throws before it calls anything is invisible) | Message, source line, build, page name. Nothing else by design | Message, stack, page address, browser, IP, breadcrumbs, optionally who and a screen recording |
| Privacy cost | None | None beyond what Supabase already holds | Low: the sender's IP reaches the endpoint, as with any request. No cookie, no id, no text of the screen | Highest: a third party holds IP, browser and clicks of members. Needs the club's privacy notice to say so and the provider's data-processing terms accepted. Region of storage matters |
| What it needs in the repository | One line on the site naming an address to write to | Nothing | A small piece of code in the portal and a place to put the reports (below). A line in the CSP is not needed if the reports go to the club's Supabase project (already allowed) | The provider's script or package (bundle size: the browser budget rises by tens of kilobytes; `npm run report:bundle` fails above 5 kB growth per route), a CSP line for its address, an update of `docs/ASSETS.md`, a key at build time (a public one) and a secret to upload source maps |
| Who reads it, and how | Whoever gets the email | Anyone with the Supabase dashboard: Logs, then API, Auth or Postgres logs; filter on status 4xx and 5xx | Somebody opens a table or a log weekly | An inbox and a dashboard, with alerts |
| Cost | Free | Free (retention depends on the plan: shorter on Free) | Free; some of the Supabase database's space | A free tier of a few thousand events a month, then paid |
| Main weakness | Depends on members complaining | Misses what only the browser sees | Anyone who can see the page can also send false reports (see below) | The privacy cost, and one more account to look after |

### Option C in more detail

What a minimal beacon would be, if the owner chooses it:

- The browser listens for `error` and `unhandledrejection` on the window, and sends **one** small message per distinct error per page load: `message` (cut to 300 characters), `source:line:column`, the **build id** (so a report can be matched to a deployment), the **page name** from `?page=` (never the whole address), and a **version tag** for the browser (family and major version, not the full user-agent string). It sends **nothing else**: no user id, email or name, no text from the page, no storage, no stack arguments.
- It uses `navigator.sendBeacon` or a `fetch` with `keepalive`, so a crash during unloading is still reported, and it swallows its own failures.
- Where it lands: the simplest place is the club's Supabase project, through a function that **accepts an insert from anybody who has the public key and does nothing else**. That function and its table are a **database change**, which is not part of this work: **needs: a migration** adding the table (columns as above plus a timestamp), an insert-only function with a hard length limit on every field, and a limit on how fast one sender can write. Without the rate limit, a stranger can fill the database with junk (the same weakness as the sign-up queue in `docs/KNOWN_GAPS.md`, section 2). The alternative, a route on Vercel that writes to its own log, avoids the database but introduces the club's first server code, with its own cost and limits (the log is kept for a short time).
- It is **built as a feature with a test**, in the portal's own code, with the rule that it must never send what the page shows.

### Option D in more detail

If the owner prefers a hosted service, these are the settings that matter more than the choice of vendor:

- The key in the browser is public by design; the token used to upload readable stack traces ("source maps") at build time is a secret that lives in Vercel's or GitHub's secrets and never in the repository.
- Turn **off** by default: session replay, capturing of request and response bodies, IP storage if the vendor offers it, sending the user's identity, and automatic breadcrumbs for console and fetch (they can contain ids and names).
- Route the reports through the club's own domain if the vendor offers a tunnel, so the browser talks to one address only and the CSP needs no new host.
- Pick the region deliberately and accept the vendor's data-processing terms on the club's behalf: that is a signature the owner gives, not something the code can do.
- Add the vendor to `docs/ASSETS.md`'s list of things the pages load (its script and its address) and to the CSP, exactly (`connect-src`, one address, no wildcard).

## What is recommended

1. **Now, without building anything:** option A and B together. Put an address members can write to ("something broke? email ...") on the sign-in or profile page (a text change), and have somebody look at Supabase's API and Postgres logs for 4xx and 5xx once a week (Supabase dashboard, Logs). That already shows the failures that matter to data.
2. **When somebody is willing to read the reports every week:** option C, built as a small feature with its migration, its rate limit and its test, because it learns about browser-side failures at the lowest privacy cost and stays inside the club's own project.
3. **Option D only if the club wants alerts and graphs and accepts the privacy cost** in its privacy notice. Do not install it as a convenience.

## What is needed from the owner

| Question | Why |
|---|---|
| Does the club want browser-side error reports at all? | If not, option A and B are the whole answer |
| Who reads them, and how often? | A report nobody reads is the cost without the benefit |
| Is a third party allowed to hold members' IP addresses and browser details? | Decides C against D |
| Is there a privacy notice, and who updates it? | D (and C) change what the club collects |
