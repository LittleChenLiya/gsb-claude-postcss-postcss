# PostCSS Rule Move Precheck

`postcss.moveCheck(node, target, opts)` prechecks a rule move without
performing it. It compares the old and new parent at-rule chains and
reports whether the move changes the media, supports, or layer context.

## Usage

```js
const report = postcss.moveCheck(rule, mediaB)
if (!report.safe) {
  console.log(report.risks)
}
```

The report contains:

- `safe`: `true` if no context changes were detected.
- `risks`: a list of context changes (media, supports, layer, or cycle).
- `plan`: which node would move and from/to where.

## Context comparison

The precheck walks the real AST ancestor chain (not string matching) and
collects `@media`, `@supports`, and `@layer` at-rules. Two contexts are
equal only if:

- `@media` / `@supports`: same params.
- `@layer` named: same name.
- `@layer` anonymous: same node identity (two anonymous `@layer` blocks
  with identical params are **not** the same layer).

## Layer order

Layer order determines cascade priority: layers are ordered by first
declaration and unlayered styles have the lowest priority. Moving a rule
to a different layer changes its cascade priority, so every layer risk
includes a `layerOrder` explanation.

## CLI

```sh
node bin/move-check.js <css-file> <spec-file>
```

The spec file exports a function receiving the parsed `Root` and
returning `{ node, target, opts }`. The command prints the report as
JSON.

## Examples

- `media-change.css` / `.spec.js`: moving between `@media screen` and
  `@media print` reports a media condition change.
- `anonymous-layer.css` / `.spec.js`: two anonymous `@layer` blocks are
  not equal.
- `layer-order.css` / `.spec.js`: moving to a named layer changes cascade
  priority.
- `same-chain.css` / `.spec.js`: moving within the same parent chain is
  safe.
