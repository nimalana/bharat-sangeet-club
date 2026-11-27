// The five heavy screens (attendance, finances, the resource library, the recording workspace and the club archive
// manager) are loaded when first opened. Until the file arrives the page shows a loading line, not a blank.
//
// Replaces shell-resilience "every code-split screen has a loading fallback" (it read the five `dynamic(...)` lines
// and checked each for `loading: SectionLoading`). Each test below opens one screen for the first time in this file,
// so the screen's file really is being fetched when the check runs: that is why they are kept in a file of their own.

import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fake, ok } from "../support/fake-supabase";
import { openPortal } from "../support/portal";

async function firstVisit(page: string, role: "member" | "executive", heading: string, extraLoading = 1) {
  openPortal({ role, page });
  // The line shown while the screen's file is fetched.
  const loading = await screen.findAllByText("Loading…");
  expect(loading.length).toBeGreaterThanOrEqual(extraLoading);
  for (const line of loading) expect(line).toHaveAttribute("role", "status");
  // Then the screen itself replaces it.
  expect(await screen.findByRole("heading", { level: 1, name: heading }, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
}

describe("a code-split screen shows a loading line until its file has arrived", () => {
  it("attendance", async () => {
    fake.rpc("get_attendance_overview").reply(ok({}));
    await firstVisit("attendance", "member", "Attendance");
  });
  it("finances", async () => { await firstVisit("finances", "executive", "Club finances"); });
  it("the resource library", async () => { await firstVisit("documents", "member", "Resources"); });
  it("the recording workspace and, for executives, the club archive manager", async () => {
    await firstVisit("recordings", "executive", "Recordings", 2);
    expect(await screen.findByText("Club and concert recordings")).toBeInTheDocument();
  });
});
