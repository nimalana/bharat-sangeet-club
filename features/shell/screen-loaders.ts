// The one place that names the file of each screen the shell loads on demand. features/shell/components/lazy-screens.tsx wraps these in next/dynamic
// (a screen is fetched when it is first drawn), and features/shell/hooks/use-idle-prefetch.ts calls the same functions once the portal is quiet, so a
// person's first visit to Members or the Calendar finds the file already there. Both go through this table, so a module is named once, the bundler makes
// one chunk of it, and the two cannot drift apart.
//
// Every entry must stay a function with a literal path in `import(...)`: that is what makes the bundler cut a separate file. Nothing here may be imported
// by a first-load component for its value; only these functions are, and they run later.
export const screenLoaders = {
  attendance: () => import("../attendance/components/attendance-page"),
  members: () => import("../members/components/members-page"),
  calendar: () => import("../calendar/components/calendar-page"),
  finance: () => import("../finance/components/finance-page"),
  resources: () => import("../resources/components/resource-library"),
  recordings: () => import("../recordings/components/recording-workspace"),
  clubArchive: () => import("../recordings/components/club-archive-manager"),
  ownProfile: () => import("../members/components/own-profile-dialog"),
  completeProfile: () => import("../members/components/complete-profile-dialog"),
  calendarDialogs: () => import("../calendar/components/calendar-dialogs"),
} as const;

export type ScreenName = keyof typeof screenLoaders;
