"use client";

import { useEffect } from "react";
import type { ClubRole } from "../../../lib/db";
import { canManageClub } from "../../../lib/permissions";
import { canViewSection, type Section } from "../../../lib/sections";
import { screenLoaders, type ScreenName } from "../screen-loaders";

// F5 (the browser check of Phase 2): the first visit to Members, the Calendar or a dialog waited for its file ("Loading…") because every heavy screen is its
// own bundle, fetched when it is first drawn. This fetches them after the portal is drawn and the browser has nothing better to do, so the first open is as
// quick as the second, and the first-load bundle stays as small as it was: only the names of the files are in it (../screen-loaders.ts), never their code.
//
// What is fetched is what this person can open, most likely first: the screens of the sections they may view (lib/sections.ts), the account menu's "My
// profile", and for an executive or admin the calendar's forms and the club archive's manager. One file per idle moment, so the browser is never asked for
// several at once. It stops on its own when the person signs out, changes role or leaves the page, and does nothing when the connection is slow or the person
// asked their browser to save data. A file that cannot be fetched is forgotten: the screen asks for it again when it is opened and shows its own error then.
const SECTION_SCREENS: readonly (readonly [Section, ScreenName])[] = [
  ["calendar", "calendar"], ["members", "members"], ["attendance", "attendance"], ["documents", "resources"], ["recordings", "recordings"], ["finances", "finance"],
];

/** The screens to fetch for a role, in order. */
function planFor(role: ClubRole): ScreenName[] {
  const plan: ScreenName[] = SECTION_SCREENS.filter(([section]) => canViewSection(section, role)).map(([, screen]) => screen);
  plan.push("ownProfile");
  if (canManageClub(role)) plan.push("calendarDialogs", "clubArchive");
  return plan;
}

type Connection = { saveData?: boolean; effectiveType?: string };
/** The browser (Chromium) says the person wants less data, or the connection is 2g: a prefetch nobody asked for is not worth it. */
function connectionIsTight(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  return Boolean(connection?.saveData) || /^(slow-)?2g$/.test(connection?.effectiveType ?? "");
}

const IDLE_TIMEOUT_MS = 5000;
const FALLBACK_DELAY_MS = 2000;

/** Runs `run` when the browser is idle (Safari has no requestIdleCallback: a plain timer instead). Returns the way to cancel it. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(handle);
}

/** Fetches the lazy screens this role can open, one per idle moment, once `ready` (the portal is drawn). */
export function useIdlePrefetch(ready: boolean, role: ClubRole) {
  useEffect(() => {
    if (!ready || connectionIsTight()) return;
    const queue = planFor(role);
    let stopped = false;
    let cancel = () => {};
    const schedule = () => {
      if (stopped || queue.length === 0) return;
      cancel = whenIdle(() => {
        const screen = queue.shift();
        if (stopped || !screen) return;
        // Fetched for its side effect (the bundler keeps the file); a failure is not worth a message here, the screen reports its own when it is opened.
        screenLoaders[screen]().then(() => undefined, () => undefined).then(schedule);
      });
    };
    schedule();
    return () => { stopped = true; cancel(); };
  }, [ready, role]);
}
