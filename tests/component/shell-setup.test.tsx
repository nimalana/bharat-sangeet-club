// A project with no Supabase URL and key in its environment: the shell says what is missing and asks for nothing.
// (lib/supabase exports null then; every other component test runs with the fake client of tests/support.)
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fake } from "../support/fake-supabase";
import { renderPortal } from "../support/portal";

vi.mock("../../lib/supabase", () => ({ supabase: null }));

describe("the shell without a Supabase connection", () => {
  it("shows the setup screen after the session check, not the public site or a sign-in", async () => {
    renderPortal();
    expect(await screen.findByText("Supabase connection needed")).toBeInTheDocument();
    expect(screen.getByText("Add the project URL and publishable key to the hosting environment.")).toBeInTheDocument();
    expect(screen.queryByText("Member sign in →")).not.toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });

  it("never shows the public page, even when the server sent concerts: there is nothing to sign in to", async () => {
    renderPortal({ publicConcerts: [] });
    expect(await screen.findByText("Supabase connection needed")).toBeInTheDocument();
    expect(screen.queryByText("Member sign in →")).not.toBeInTheDocument();
    expect(fake.calls).toHaveLength(0);
  });
});
