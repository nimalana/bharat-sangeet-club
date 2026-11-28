# Assets: where every picture, font and icon comes from

P3-03 asks that the pages load nothing from another origin that the club does not control, or that the exception is written down. This file is that list: what the public site and the portal show, where each file came from, the licence it is used under, and what is still open. It was written on 28 Nov 2026 from `public/`, `features/public/hero-photos.ts`, the built CSS and a search of the source for `https://` addresses and CSS `url(...)`.

## What is open

**One picture is still loaded from another website, and it needs a person to act.**

| | |
|---|---|
| Picture | The photograph beside the headline of the public landing page (`.hero-image`) and beside the sign-in screen (`.login-art`) |
| Address | `https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg` |
| Where it is written | `features/public/hero-photos.ts` (the only place); used by `features/public/components/public-site.tsx` and `login-screen.tsx` |
| Licence | None on record. The picture belongs to the website it is loaded from (an agency's 2021 upload); the repository holds no permission to show it, copy it or keep a copy. Treat it as all rights reserved until the owner of the club has written permission or replaces it with a club photograph |
| Why it is not self-hosted yet | The build environment could not fetch it (the network policy answered HTTP 403 for `asianartsagency.co.uk`), and with no licence on record a copy would not have been right to commit in any case |
| What a visitor tells that site today | Every view of the landing or sign-in page sends their IP address, browser and the origin of this site (`Referrer-Policy: strict-origin-when-cross-origin` keeps the path and query out) to the other site. If that site removes or replaces the file, the page shows a broken or different picture |
| What the Content-Security-Policy does about it | `img-src` lists this one address, exactly, and nothing else from outside the club's own origin and its Supabase project (`next.config.ts`, `HERO_PHOTO_URLS`). A different picture from the same site would be blocked, which is the point |

**needs: `Trio-WP.jpg`** (or a club photograph that replaces it).

### How to close it

1. Get permission in writing from the owner of the picture, or pick a photograph the club owns. Record the source and licence in the table below.
2. Put the file at `public/hero/trio.jpg` (any name; keep it under `public/`). It is shown with `object-fit: cover` in a box that is roughly 560 css pixels wide and 680 high on a 1280-pixel desktop and the full width of a phone (320 to 440 high), with a CSS filter on top (`features/public/public.css`). To keep the crop and size identical: use the original at 1600 pixels wide, a JPEG at quality 80 or WebP only if it looks the same, and aim for under 250 kB.
3. In `features/public/hero-photos.ts` change `src` to `"/hero/trio.jpg"`.
4. In `next.config.ts` empty `HERO_PHOTO_URLS`. `tests/security-headers.test.mjs` fails until you do, so a stale exception cannot stay.
5. `npm run build`, open `/` and the sign-in screen and compare with `tests/browser/__screenshots__/visitor__landing__*.jpg`; run the browser suite, whose guard fails on any request to another origin.

### Not chosen: a rewrite through the club's own server

A `rewrites()` entry in `next.config.ts` could make the browser ask this origin and let Vercel fetch the picture from the other site, which hides the visitor from it. It was not built: the other site could not be reached from the build environment, so it could not be tested, and it keeps the dependency and the licence question. Self-hosting removes both.

## What was removed

`features/public/hero-photos.ts` held a second photograph (`https://static.wixstatic.com/media/08d671_184493ea312d46e89a838c34d1097f42~mv2.jpg/...`). Nothing displayed it (both screens use the first entry only), so the entry was deleted: the site no longer names that host anywhere and the browser never contacted it. The address stays in the git history (`git log -S wixstatic`) if someone wants to use it, in which case the same licence question applies.

## Everything else the pages show

| Asset | Used for | Source and licence | Origin at run time |
|---|---|---|---|
| `public/unc-bharat-sangeet-logo.jpg` (170 x 170 px, 13 kB) | The brand mark in the headers and footers, empty states, the sign-in screen, the browser tab icon and the touch icon (`app/layout.tsx`), and `styles/shared.css` as a background | The club's logo, added with the first portal commit (10 Aug 2026). The artwork is the club's own mark; no other source is recorded | The club's own origin |
| Inter (variable) and Barlow Condensed 400, 500, 600, 700 | All text | npm packages `@fontsource-variable/inter` and `@fontsource/barlow-condensed`; SIL Open Font License 1.1 (the licence file is in each package). Next copies the font files into `/_next/static/media/` at build time | The club's own origin (no Google Fonts request is made) |
| `public/favicon.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` | Nothing: no source file, stylesheet or metadata refers to them | The default assets of the `create-next-app` starter (Vercel, MIT) | Never requested. Safe to delete; left alone because deleting is outside this change |
| Audio and video the club uploads (recordings, library, receipts, notation) | Players and previews | The members who upload them; stored in private Supabase Storage buckets and shown through signed links | The club's Supabase project, named in the CSP |

There is no other image in the repository: no `<img>` or CSS `url()` points at another origin, and `next.config.ts` has no `images` setting (the app uses plain `<img>` elements).

## Checked by

- `tests/security-headers.test.mjs`: `img-src` names exactly the pictures of `features/public/hero-photos.ts` that are `https://` addresses, and no other directive names any host but the Supabase project.
- `tests/browser/support/test.mjs` (the guard that runs inside every browser test): a request to any origin other than the app and the test project fails the test, with the one hero address allowed by name while it stays third-party.
