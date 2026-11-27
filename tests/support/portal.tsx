// Opens the whole portal (the signed-in shell) against the fake client. The one place the shell is imported:
// if the shell moves, change the import below.
import { render } from "@testing-library/react";
import Home from "../../app/portal";
import type { ClubRole } from "../../lib/sections";
import { fake, ok } from "./fake-supabase";

export type PortalOptions = {
  role?: ClubRole;
  userId?: string;
  name?: string;
  /** The address the person opens, e.g. "members" for /?page=members. */
  page?: string;
  /** Fields of the get_portal_bootstrap answer (groups, memberships, announcements, events, archive, resource_count). */
  boot?: Record<string, unknown>;
};

export const bootstrapAnswer = (role: ClubRole = "member", name = "Asha Rao", over: Record<string, unknown> = {}) => ({
  profile: { full_name: name, role, status: "active" },
  groups: [], memberships: [], announcements: [], events: [], archive: [], resource_count: 0,
  ...over,
});

/** Signs a user in on the fake client, scripts the bootstrap and renders the shell. */
export function openPortal(options: PortalOptions = {}) {
  const { role = "member", userId = "u-me", name = "Asha Rao", page, boot = {} } = options;
  if (page) window.history.replaceState({}, "", `/?page=${page}`);
  fake.signIn({ id: userId, email: `${userId}@x.test` });
  fake.rpc("get_portal_bootstrap").reply(ok(bootstrapAnswer(role, name, boot)));
  return render(<Home />);
}

export const renderPortal = (props: { publicConcerts?: Parameters<typeof Home>[0]["publicConcerts"] } = {}) => render(<Home {...props} />);
