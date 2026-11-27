// The synthetic accounts the suite signs in as. Every email is e2e-<key>@example.com,
// which is also how cleanup.sql recognises them. Nothing else on the project is touched.
//
// `profileRole` is what the setup SQL writes directly. The two executives start as
// plain members and are promoted by the suite itself through admin_change_member_role,
// so the app's own admin function is exercised.

export const ACCOUNTS = {
  admin:   { email: "e2e-admin@example.com",   name: "E2E Admin",          profileRole: "admin",  note: "club admin (set directly: the only other admin is the bootstrap account)" },
  execA:   { email: "e2e-exec-a@example.com",  name: "E2E Executive A",    profileRole: "member", promoteTo: "executive", note: "executive, creates the groups" },
  execB:   { email: "e2e-exec-b@example.com",  name: "E2E Executive B",    profileRole: "member", promoteTo: "executive", note: "second executive (finance reviews)" },
  manager: { email: "e2e-manager@example.com", name: "E2E Group Manager",  profileRole: "member", note: "plain member who manages groups A and C" },
  leader:  { email: "e2e-leader@example.com",  name: "E2E Group Leader",   profileRole: "member", note: "plain member who leads group A" },
  member1: { email: "e2e-member1@example.com", name: "E2E Member One",     profileRole: "member", note: "plain member of group A" },
  member2: { email: "e2e-member2@example.com", name: "E2E Member Two",     profileRole: "member", note: "plain member of group B" },
  victim:  { email: "e2e-victim@example.com",  name: "E2E Victim",         profileRole: "member", note: "deactivated and reactivated while signed in" },
  hist:    { email: "e2e-hist@example.com",    name: "E2E With History",   profileRole: "member", note: "has finance history, so admin_delete_member must refuse" },
  nohist:  { email: "e2e-nohist@example.com",  name: "E2E No History",     profileRole: "member", note: "join requests and removal in the groups tests" },
  // Signed in only by tests/90-admin-delete.mjs, which deletes it. Run the setup SQL again to get it back.
  doomed:  { email: "e2e-doomed@example.com",  name: "E2E To Delete",      profileRole: "member", optional: true, note: "no history: admin_delete_member removes it at the end of the run" },
};

export const ACCOUNT_KEYS = Object.keys(ACCOUNTS).filter((key) => !ACCOUNTS[key].optional);
export const EMAIL_PATTERN = "e2e-%@example.com";
