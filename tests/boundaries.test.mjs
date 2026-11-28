// scripts/check-boundaries.mjs: which folder may import which (docs/ARCHITECTURE.md, "Dependency rules"). The script's own --selftest
// builds a throwaway tree for each rule; this file pins the rule table itself and that the repository obeys it, so `npm test` fails
// when an import crosses a layer or closes a cycle, not only the CI step.
import assert from "node:assert/strict";
import test from "node:test";
import { checkBoundaries, findCycles, layerOf, violation } from "../scripts/check-boundaries.mjs";

test("the repository breaks no layer rule and has no import cycle", () => {
  const { problems, files } = checkBoundaries();
  assert.ok(files > 100, "it read the sources");
  assert.deepEqual(problems, []);
});

test("layers are read from the path", () => {
  assert.deepEqual(layerOf("app/page.tsx"), { layer: "app" });
  assert.deepEqual(layerOf("features/shell/components/portal.tsx"), { layer: "shell" });
  assert.deepEqual(layerOf("features/groups/hooks/use-group-spaces.ts"), { layer: "feature", area: "groups" });
  assert.deepEqual(layerOf("components/ui/button.tsx"), { layer: "ui" });
  assert.deepEqual(layerOf("lib/api/finance.ts"), { layer: "lib" });
  assert.deepEqual(layerOf("tests/format.test.mjs"), { layer: "other" });
});

test("what each layer may import", () => {
  const allowed = [
    ["app/page.tsx", "features/shell/components/home.tsx"], ["app/page.tsx", "lib/public-concerts.ts"], ["app/error.tsx", "components/ui/button.tsx"],
    ["features/shell/components/portal.tsx", "features/finance/components/finance-page.tsx"], ["features/shell/components/portal.tsx", "features/shell/hooks/use-portal-data.ts"],
    ["features/groups/components/group-detail.tsx", "features/announcements/components/announcement-actions.tsx"], ["features/groups/components/group-detail.tsx", "features/groups/model.ts"],
    ["features/groups/components/group-detail.tsx", "components/ui/dialog.tsx"], ["features/groups/components/group-detail.tsx", "lib/db.ts"],
    ["components/ui/toast.tsx", "lib/toast.ts"], ["components/ui/button.tsx", "components/ui/dialog.tsx"], ["lib/api/finance.ts", "lib/db.ts"],
  ];
  for (const [from, to] of allowed) assert.equal(violation(from, to), null, `${from} -> ${to}`);
  const refused = [
    ["lib/format.ts", "features/finance/model.ts", "lib-imports-up"], ["lib/hooks/use-query.ts", "components/ui/toast.tsx", "lib-imports-up"], ["lib/db.ts", "app/page.tsx", "lib-imports-up"],
    ["components/ui/dialog.tsx", "features/shell/components/portal.tsx", "ui-imports-up"], ["components/ui/dialog.tsx", "app/layout.tsx", "ui-imports-up"],
    ["features/members/components/members-page.tsx", "features/shell/components/portal.tsx", "feature-imports-shell"],
    ["features/members/components/members-page.tsx", "features/groups/model.ts", "feature-imports-feature"],
    ["features/announcements/components/announcement-feed.tsx", "features/groups/model.ts", "feature-imports-feature"],
    ["features/members/components/members-page.tsx", "app/page.tsx", "feature-imports-app"], ["features/shell/components/portal.tsx", "app/page.tsx", "shell-imports-app"],
    ["app/page.tsx", "features/finance/components/finance-page.tsx", "app-imports-feature"],
  ];
  for (const [from, to, rule] of refused) assert.match(violation(from, to) ?? "", new RegExp(`^${rule}`), `${from} -> ${to}`);
});

test("a cycle of run-time imports is found; one that closes only through a type import is not", () => {
  const edge = (file, target, typeOnly = false) => ({ file, line: 1, spec: target, target, typeOnly });
  assert.equal(findCycles([edge("lib/a.ts", "lib/b.ts"), edge("lib/b.ts", "lib/c.ts"), edge("lib/c.ts", "lib/a.ts")]).length, 1);
  assert.equal(findCycles([edge("lib/a.ts", "lib/b.ts"), edge("lib/b.ts", "lib/a.ts", true)]).length, 0);
  assert.equal(findCycles([edge("lib/a.ts", "lib/b.ts"), edge("lib/a.ts", "lib/c.ts"), edge("lib/b.ts", "lib/c.ts")]).length, 0);
});
