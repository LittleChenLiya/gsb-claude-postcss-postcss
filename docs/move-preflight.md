# Rule Move Preflight

`postcss.movePreflight(node, newParent)` is an **explicit preflight** for
moving a node (usually a `Rule`) into another parent. It compares the real
AST ancestor at-rule chains of the current and the target parent and tells
you whether the move would change the `@media`, `@supports`, or `@layer`
context of the node.

The preflight **only returns a plan with risks**. It never moves, clones, or
mutates any node, so every node referenced by the plan keeps its original
`source` position and stays queryable with `node.source.start`,
`node.positionBy()`, and friends.

```js
const postcss = require('postcss')

let root = postcss.parse('@media a { .x {} } @media b { .y {} }')
let [mediaA, mediaB] = root.nodes
let rule = mediaA.first

let plan = postcss.movePreflight(rule, mediaB)
plan.safe   //=> false
plan.risks  //=> ['@media context changes from "a" to "b": …']

// Nothing was moved; the caller decides what to do with the plan.
if (plan.safe) mediaB.append(rule)
```

## How contexts are compared

* **Real AST chains only.** The preflight walks `node.parent` links from the
  current parent and from the target parent up to the root and collects the
  at-rules, root-first. It never guesses from strings.
* **`@media` / `@supports`.** Compared by the ordered sequence of `params`
  in the chain. `@media a` and `@media b` are different conditions; two
  separate `@media a` blocks are the same context.
* **`@layer`.** Named layers compare by name (`base` === `base`). Anonymous
  layers (`@layer { … }`) compare by **AST node identity**: two anonymous
  layers are never equal, even though their params are both empty. Moving a
  rule from one anonymous layer to another is always reported as a layer
  context change.
* **Other at-rules** (`@container`, `@scope`, custom at-rules, …) are
  compared as `@name params` sequences and reported as `atrule` changes.

## Layer order

`plan.layerOrder` explains where the move lands in the cascade layer order:

```js
let root = postcss.parse('@layer base, theme; @layer base{.a{}} @layer theme{.b{}}')
let plan = postcss.movePreflight(root.nodes[1].first, root.nodes[2])

plan.layerOrder.order   //=> ['base', 'theme']
plan.layerOrder.from    //=> { label: 'base',  index: 0 }
plan.layerOrder.to      //=> { label: 'theme', index: 1 }
plan.layerOrder.message //=> 'cascade layer order changes: base (position 0)
                        //     -> theme (position 1); layer order is
                        //     [base, theme]; later layers beat earlier ones,
                        //     and unlayered styles beat all layers'
```

The order is built from `@layer a, b;` statements and the first appearance
of every layer in the root, exactly like the CSS cascade does. Nested layers
use dotted labels (`parent.child`), anonymous layers appear as
`(anonymous)`, and unlayered nodes are reported as `(unlayered)` with index
`-1` — remember that unlayered styles beat **all** layered ones in the
normal origin.

## Risk examples

| Move | `plan.safe` | Risk reported |
| --- | --- | --- |
| `@media a` → `@media b` | `false` | `@media context changes from "a" to "b": the moved node will match under different media conditions` |
| `@media a` → sibling `@media a` | `true` | — |
| `@supports (a: b)` → root | `false` | `@supports context changes from "(a: b)" to (none): …` |
| `@layer base` → `@layer theme` | `false` | `cascade layer context changes from base to theme: …` plus layer order note |
| anonymous `@layer` → another anonymous `@layer` | `false` | `cascade layer context changes from (anonymous layer at 1:1) to (anonymous layer at 1:14): …` |
| `@layer base` → unlayered root | `false` | layer context change + `unlayered styles beat all layers` note |
| rule → parent in another `Root`/`Document` | `true`/`false` | extra risk: `node and new parent belong to different roots/documents: …` |

## Commands

Run only the preflight tests (Node, via `uvu` + `ts-node`):

```sh
npx uvu -r ts-node/register/transpile-only test "move-preflight"
```

Run the whole unit suite:

```sh
pnpm unit
```

Try the preflight interactively:

```sh
node -e "const p=require('./lib/postcss.js'); \
  let r=p.parse('@media a{.x{}} @media b{.y{}}'); \
  console.log(p.movePreflight(r.nodes[0].first, r.nodes[1]).risks)"
```

## Files

* `lib/move-preflight.js` — implementation (`postcss.movePreflight`).
* `lib/move-preflight.d.ts` — types (`MovePlan`, `ChainEntry`,
  `ContextChange`, `LayerOrderInfo`).
* `test/move-preflight.test.ts` — Node-directed tests for the acceptance
  scenarios above.
