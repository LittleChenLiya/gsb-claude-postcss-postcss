# Declaration extraction and comment attribution

`lib/extract-declarations.js` moves selected declarations out of an existing
rule into a new rule. It works in two phases:

1. `planExtraction(rule, decls, opts?)` validates the request and computes
   which nodes will move **without mutating the AST**.
2. `applyExtraction(plan)` performs the move.

Because the plan is checked before any node is touched, a request that mixes
in a node from another rule (or any non-declaration) throws and leaves the
tree byte-identical to its input.

```js
let { planExtraction, applyExtraction } = require('postcss/lib/extract-declarations')

root.walkRules(rule => {
  let color = rule.nodes.find(i => i.prop === 'color')
  applyExtraction(planExtraction(rule, [color], { selector: '.a-color' }))
})
```

## Attribution rules

Comments are not moved as a whole. Each comment is assigned explicitly:

1. **Adjacent preceding comments follow the declaration.** Starting from a
   selected declaration, comments are collected backwards while the gap
   between the comment and the next collected node contains **no empty
   line**. A whole contiguous run of comments moves as one unit.

2. **Rule-introductory comments stay in the original rule.** A comment run
   stops at the beginning of the rule, at a non-comment node, or as soon as
   an empty line separates it from the declaration. Such a comment describes
   the rule (or is a standalone note) rather than the declaration.

3. **Empty lines are the separator.** “Sandwiched” comments — separated from
   the declaration by an empty line — stay put, even if they are visually
   close to it. The empty line that stood before a moved group is carried
   onto the first remaining sibling so the source rule keeps its paragraph
   breaks.

Trailing comments after a declaration are not part of a preceding run; they
stay attached to whatever node the parser placed them next to.

### Example

```css
.a {
  /* rule description */

  /* color hint */
  color: red;
  /* width hint */
  width: 1px;

  display: block;
}
```

Extracting `color` produces two rules:

```css
.a {
  /* rule description */

  /* width hint */
  width: 1px;

  display: block;
}
.a-color {
  /* color hint */
  color: red;
}
```

- `/* color hint */` is adjacent to `color` (no empty line between them), so
  it moves.
- `/* rule description */` is detached from `color` by an empty line and
  stays in the source rule.
- `/* width hint */` precedes `width`, which is not extracted, so it stays.
- The empty line before `display` is preserved.

## `raws` and source maps

Every moved node keeps its original `source` (start/end/input) and its
`raws` (`before`, `between`, `left`, `right`, …) intact. The new rule
inherits the source rule’s block formatting and takes the source rule’s
`source`, so both the remaining rule and the new rule render identically
styled and every generated token maps back to its original source line in
the generated source map. The extracted declarations keep their terminating
semicolons even when a declaration ends up last in the new rule.

## Failure modes

- A declaration that does not belong to the target rule, or any
  non-declaration argument, makes `planExtraction` throw; nothing is moved.
- Applying a stale plan (for example after a planned node was removed
  separately) throws before any mutation.
- Extracting from a detached rule (no parent container) throws.

## Local verification

```sh
node scripts/extract-declarations-demo.js
# or
pnpm demo:extract
```

The unit tests live in `test/extract-declarations.test.ts` and cover comment
attribution, rejection of foreign nodes, `raws` preservation, and source-map
positions for both output rules.
