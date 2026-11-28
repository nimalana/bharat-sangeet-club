# css-split

The tools R4 used to split `app/globals.css` into stylesheets that sit next to the code that uses them, without changing a pixel.
They are kept so that the split can be audited and repeated; once the split is in, `app/globals.css` is no longer the input they expect
(run them with `--base <commit before the split>`).

## Why it is not just "cut by feature"

The old file was one cascade: many rules have the same specificity, so **the order of the rules decides the result**, and the rules of
different features were interleaved (a later rule of one feature overrides an earlier rule of another). A stylesheet per feature is only
safe where moving a rule past another one cannot change an element's style. The tools decide that, rule by rule.

Two rules `A` (written first) and `B` can only disagree about an element when ALL of these hold; otherwise their order does not matter:

1. one element can match a selector of each: the subjects do not contradict (two tags, two ids, two pseudo-elements) and one element in
   the source can carry every class both subjects name (`elements.mjs`: the `className` of every JSX element, resolved with the
   TypeScript checker; a class a screen hands to a `components/ui` primitive counts as carried together with the primitive's own;
   ancestors in the selector must be able to nest: a shell element contains every screen, a screen only its own and the ui and announcement
   elements); a class that no `className` can produce matches nothing;
2. the two selectors have the same specificity (the stronger one wins in any order);
3. the two rules set a common property (`properties.mjs` knows shorthands and longhands).

`plan.mjs` turns that into a graph (an EDGE `A -> B` means A must stay before B), searches the order in which to import the area files
that leaves the fewest rules with an edge pointing backwards, and sends those rules (and everything that depends on them) to one `late` file
that is imported last, in the original relative order, so no edge points backwards any more.

## Commands

```
node scripts/css-split/split.mjs plan  --base <rev>               # the area of every rule, the file table, the late and unused rules
node scripts/css-split/split.mjs apply --base <rev> --through <n> # write the files of the first n groups (see GROUPS in split.mjs)
node scripts/css-split/compare-built.mjs <before .next> <after .next> [--removed]
```

`<rev>` is the commit whose `app/globals.css` is the original; the class usage is read from the working tree.

`compare-built.mjs` is the proof: it flattens the built CSS of two builds (the asset in `.next/static/chunks`) to one item per declaration
(`@media ... || selector || property: value`, selector lists split, so the minifier's merging does not show) and reports the items only one
side has, whether the sequence is identical, and, for items that moved, every pair whose order changed that could disagree about one element
(same test as the planner, applied to the BUILT selectors). With `--removed` the items that left must all need a class no source file uses.
Exit code 1 on anything added, a conflicting reorder, or a removal that was not unused.

## What it assumes (and the browser suite covers the rest)

* Classes reach elements only through `className` in JSX (no `classList`, no `innerHTML`: checked by grep). A `status` column typed `string`
  takes one of the values of a `check (status in (...))` in the migrations.
* A class "unused" means its name is in no string of any file under `features/`, `components/`, `app/`, `lib/` (every word of every string counts,
  and a template such as `attendance-${x}` keeps every class with that prefix): only a class that appears nowhere is removed.
* Tailwind scans every file for class names: `app/globals.css` has `@source not "../scripts/css-split"` so that the words in these scripts do
  not generate utilities.
