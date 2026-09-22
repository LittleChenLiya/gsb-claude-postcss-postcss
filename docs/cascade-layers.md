# Cascade Layer Analysis

`lib/cascade-layers.js` is a reusable build-time module that reports the
cascade layer structure of an already parsed PostCSS `Root` (or `Document`).
It never mutates the input AST and does not compute selector specificity or
final styles — it only answers *"which layers exist, in which order, and where
did they first appear?"*.

```js
const { parse } = require('postcss')
const analyzeCascadeLayers = require('postcss/lib/cascade-layers')

let analysis = analyzeCascadeLayers(parse(css, { from: 'main.css' }), {
  resolveImport(url, { from, chain }) {
    // Return { css, id }, { root } or null when the file cannot be loaded
    return { css: readFileSync(url, 'utf8'), id: url }
  }
})

analysis.normalOrder    // layers, lowest -> highest normal priority
analysis.importantOrder // layers, lowest -> highest !important priority
analysis.diagnostics    // import cycles / failures with the source chain
```

See `examples/cascade-layers.js` for a runnable terminal demo that prints
both orders, first-appearance positions and failure diagnostics.

## Ordering rules

The module follows the CSS Cascading and Inheritance Level 5 rules:

- **First occurrence wins.** `@layer a, b;` statements, named blocks,
  dotted names (`a.b`) and `@import ... layer(name)` all register a layer
  the first time it appears. Re-declaring a layer later never moves it.
- **Unlayered styles.** Normal declarations outside any layer beat all
  layered normal declarations, so the synthetic `<unlayered>` entry is
  last in `normalOrder`.
- **Important reverses.** For `!important` declarations the whole order
  flips: earlier layers win, and layered important declarations beat
  unlayered important ones. `importantOrder` is exactly
  `normalOrder.slice().reverse()`.
- **Anonymous layers.** Every `@layer { ... }` block (and every bare
  `@import ... layer`) creates a brand-new identity
  (`#anonymous-1`, `#anonymous-2`, ...), even if the blocks look
  identical.
- **Nesting.** `@layer theme { @layer base { ... } }` and
  `@layer theme.base` refer to the same layer `theme.base`. Direct
  declarations of the parent belong to `theme`, nested ones to
  `theme.base` — two separate entries with `parent`/`path` links.
- **Multi-name blocks.** In `@layer a, b { ... }` both names are
  registered in order, and the block contents belong to the *last* name.
- **Escaped names.** `@layer a\.b` is a single layer literally named
  `a.b`, not the nested path `a` → `b`. Escapes (including hex
  escapes like `\61`) are unescaped before building identities.

Each layer records `firstPosition` (`source`, `line`, `column`,
`offset`) of its first appearance.

## Conditions

`@media`/`@supports` blocks and `supports()`/media parts of
`@import` cannot be evaluated at build time. The analyzer keeps them as
context on the affected layers:

```js
{
  type: 'media',          // or 'supports'
  params: '(width: var(--bp))',
  value: 'unknown',       // never evaluated
  dynamic: true,          // contains var()/env()/attr()
  position: { ... }
}
```

`value` is always `'unknown'`; `dynamic` marks conditions that depend
on runtime values and can never be resolved statically.

## Imports and diagnostics

`@import` is followed when `options.resolveImport(url, { from, chain })`
is provided. The imported tree is analyzed under the import's layer
(`layer`, `layer(name)` or none) and condition context. Problems are
collected in `analysis.diagnostics` instead of throwing:

- `import-cycle` — a url already appears in the current import chain.
- `import-failed` — the resolver threw, returned nothing, or the
  returned CSS could not be parsed.
- `import-unresolved` — no `resolveImport` callback was provided.

Every diagnostic carries the full `chain` of
`{ url, from, position }` frames from the entry file to the failing
import, plus the `position` of the failing `@import` itself.
