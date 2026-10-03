# Processing snapshots

PostCSS plugins can run asynchronously: `Processor#process` returns
a `LazyResult` promise proxy that does not start working until `.then()`
(or `async()`) is called. Build tools and runners that want to observe
a transformation while it is in flight can call `snapshot()` on a
`LazyResult` (or a finished `Result`).

A snapshot is a plain, detached object. It never starts processing that
has not begun, never awaits a plugin that is already running and never
calls a plugin again. It only reports the state observed so far.

## States

The `state` field is one of:

- `pending` — processing has not started yet. The plugin count is `0`
  and the warning list is empty.
- `running` — an asynchronous plugin is in flight. The snapshot contains
  the warnings produced before the current await point.
- `succeeded` — all plugins finished without errors.
- `failed` — a plugin threw an error. Warnings produced before the
  failure are kept and the `error` field holds safe error fields.

```js
const postcss = require('postcss')

let lazy = postcss([plugin]).process(css, { from: undefined })

lazy.snapshot().state //=> 'pending'

lazy.then(() => {
  lazy.snapshot().state //=> 'succeeded'
})
```

## Snapshot shape

```js
{
  state: 'running',      // 'pending' | 'running' | 'succeeded' | 'failed'
  plugins: 1,            // plugins started so far
  warnings: [
    {
      type: 'warning',
      text: '…',         // warning message
      plugin: '…',       // plugin name, or null
      line: 1,           // inclusive start line, or null
      column: 1,         // inclusive start column, or null
      endLine: 1,        // exclusive end line, or null
      endColumn: 5,      // exclusive end column, or null
      word: '…'          // extra fields passed to Result#warn are kept
    }
  ],
  error: null            // { name, message, plugin, line, column,
                         //   endLine, endColumn, file, stack } on failure
}
```

Warnings keep their source (the plugin name), their position and their
order. The link to the AST (`node`) is dropped, so a snapshot never
carries the whole tree. Positions and source that are missing are
reported explicitly as `null`.

The `error` field only contains safe, serializable fields. It never
carries the AST or the CSS input object.

## Detached containers

Every call to `snapshot()` builds fresh objects and arrays. Mutating the
returned warning list or error object does not affect PostCSS internals
or another snapshot:

```js
let a = lazy.snapshot()
let b = lazy.snapshot()

a.warnings !== b.warnings //=> true

a.warnings.push('intruder')
lazy.snapshot().warnings.length //=> unchanged
```

Different `LazyResult` instances of the same `Processor` do not share
state either: each processing keeps its own plugin count, warnings and
error.

## `Result#snapshot()`

A finished `Result` (returned by `.then()` or `Root#toResult()`) also
has `snapshot()`. Its state is always `succeeded` (a failed processing
never produces a `Result`) and it contains the final plugin count and
warnings.

```js
postcss([plugin])
  .process(css, { from: undefined })
  .then(result => {
    let snapshot = result.snapshot()
    snapshot.state //=> 'succeeded'
  })
```

`warnings()` is unchanged: it still returns live `Warning` instances and
still triggers synchronous processing (and throws on a failed result).
Use `snapshot()` when you need a non-triggering, detached view.
