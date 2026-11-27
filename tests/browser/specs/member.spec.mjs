// A plain member (e2e-member1: member of group A, no management rights anywhere).
import { test } from "../support/test.mjs";
import { NAV, navTest, smokeScreen } from "../support/smoke.mjs";

test.use({ role: "member" });

for (const screen of ["home", "groups", "calendar", "members", "attendance", "recordings", "documents", "finances"]) smokeScreen("member", screen);
navTest("member", NAV.member, ["admin"]);
