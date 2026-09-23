# Cascade Layer Analysis

PostCSS ships a build-time analyzer for [CSS cascade layers](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer).
It reads an already parsed `Root` (without mutating it) and reports the layer
priority order for normal and `!important` declarations, the first position of
every layer, the conditional context it could not resolve, and diagnostics for
broken or circular `@import` chains. It does not compute selector specificity
or the final cascaded styles.

```js
const postcss = require('postcss')

let root = postcss.parse(css, { from: 'main.css' })
let analysis = root.analyzeLayers({
  resolveImport(url, info) {
    // return CSS text, a parsed Root, { css, file }, or null on failure
  },
  conditions: {
    'media (min-width: 100px)': true // or (type, query) => boolean | undefined
  }
})

for (let entry of analysis.normal) {
  // lowest priority first, unlayered declarations last
  console.log(entry.type === `'layer'` ? entry.layer.id : `'<unlayered>'`)
}
```

`Container#analyzeLayers(options)` analyzes the subtree of that container.
`Node#analyzeLayers(options)` analyzes the root containing the node. The same
result is also available as a standalone function:

```js
const { analyzeLayers } = require('postcss/lib/layer-analyzer')
let analysis = analyzeLayers(root, options)
```

## Order rules

The analyzer implements the layer ordering rules of CSS Cascade 5:

- **First appearance wins.** `@layer a, b;` statements, named blocks,
  anonymous blocks and layered `@import` rules all declare their layers at
  the position where they first appear. Re-declaring a layer later never
  moves it; `layer.occurrences` counts the repeats.
- **Anonymous layers.** Every `@layer { … }` block without a name and every
  `@import … layer;` creates a new unique identity (`anonymous-1`,
  `anonymous-2`, …) at its own position.
- **Nesting.** `@layer a { @layer b { … } }` and `@layer a.b { … }` declare
  the same `a.b` layer. In the flattened order a parent layer comes before
  its nested sublayers, so declarations directly in the parent have a lower
  priority than declarations in its sublayers (and a higher one for
  `!important`).
- **Unlayered declarations.** Normal declarations outside any layer beat all
  layered ones, so `<unlayered>` is the last entry of `analysis.normal`.
- **Important reversal.** For `!important` the layer order is reversed and
  unlayered important declarations lose to layered ones, so
  `analysis.important` starts with `<unlayered>` followed by the layers in
  reverse order.

## Conditions

`@media` and `@supports` (including the ones on `@import`) usually cannot be
resolved at build time. The analyzer keeps them as condition context on the
affected layers and lists every unique query in `analysis.conditions` with
`state: 'unknown'`. Pass `options.conditions` (a map or a function) to
resolve the ones you know statically.

## Imports

`@import "x.css" layer;`, `@import "x.css" layer(name);` and
`@import url(x.css) layer(name) supports(…) screen;` are all understood.
Without `options.resolveImport` the analyzer still registers the declared
layers but cannot look inside the imported file. With a resolver, imported
stylesheets are analyzed recursively inside the import’s layer and condition
context. Cycles and loading failures do not throw; they are reported in
`analysis.diagnostics` with the full source `chain`:

```js
for (let problem of analysis.diagnostics) {
  console.log(problem.type, problem.import, problem.chain.join(' -> '))
}
```

## Positions

Every layer records `firstPosition` (`{ file, line, column }`) of its first
appearance, and `analysis.unlayered` records the first unlayered
declaration. Escaped identifiers (like `@layer \31 23`) are unescaped,
comments in preludes are ignored, and the input AST is never modified, so
analyzing the same root twice returns equal results.

See `docs/layer-analysis.example.js` for a runnable terminal demo:

```sh
node docs/layer-analysis.example.js
```
