# Processing Snapshots

Build tools and runners often need to observe a PostCSS run that has not
finished yet: which stage it is in, which warnings plugins have already
produced, and—on failure—what went wrong. `LazyResult#snapshot()` and
`Result#snapshot()` give a detached, point-in-time view for exactly that.

```js
const lazy = postcss(plugins).process(css, { from: cssPath })

lazy.snapshot().state //=> 'pending' (nothing has started yet)

const promise = lazy.then(result => {
  result.snapshot().state //=> 'succeeded'
})

lazy.snapshot().state //=> 'running' (while async plugins are in flight)
await promise
```

## `LazyResult#snapshot()`

Returns a plain object:

```ts
{
  state: 'pending' | 'running' | 'succeeded' | 'failed',
  pluginsRun: number,    // plugins that already finished
  pluginsTotal: number,  // plugins in the processor for this run
  warnings: WarningSnapshot[],
  error: ErrorSnapshot | null
}
```

* **`pending`**: processing has not started. No plugin has run
  (`pluginsRun` is `0`).
* **`running`**: processing started and is waiting for asynchronous plugins.
  Warnings produced so far are already visible.
* **`succeeded`**: all plugins finished without an error.
* **`failed`**: the parser or a plugin threw. Warnings produced before the
  failure are kept, and `error` carries only safe fields:
  `{ name, message, plugin }` (`plugin` is `null` when unknown).
  The snapshot never contains the AST node the error was raised on.

Taking a snapshot is side-effect free: it never starts processing, never
awaits in-flight plugins, and never calls plugin code.

## `Result#snapshot()`

A `Result` represents a completed transformation, so its snapshot always has
`state: 'succeeded'` and `error: null`, plus the same `warnings` format.

## Warning snapshots

Warnings keep their source, position, and original order:

```ts
{
  text: string,
  plugin: string | null,  // plugin that created the warning
  line: number | null,    // explicit null when there is no position
  column: number | null,
  endLine: number | null,
  endColumn: number | null
}
```

## Isolation guarantees

* Every snapshot contains fresh objects and arrays. Mutating a snapshot
  (or a warning inside it) does not affect the `Result`, the `LazyResult`,
  or later snapshots.
* Each `Processor#process()` call tracks its own state: snapshots of
  concurrent runs from the same processor never mix.
* `Result#warnings()` semantics are unchanged; snapshots are an additional,
  read-only view.

See `examples/snapshot.js` for a runnable demo that prints stage changes.
