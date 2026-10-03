import { test } from 'uvu'
import { equal, is, ok, type } from 'uvu/assert'

import postcss, { Plugin, Root } from '../lib/postcss.js'
import Processor from '../lib/processor.js'

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 1))
}

test('reports pending before processing starts and does not start it', () => {
  let calls = 0
  let plugin: Plugin = {
    Once() {
      calls += 1
    },
    postcssPlugin: 'counter'
  }
  let lazy = postcss([plugin]).process('a {}', { from: undefined })

  let snapshot = lazy.snapshot()
  is(snapshot.state, 'pending')
  is(snapshot.pluginsRun, 0)
  is(snapshot.pluginsTotal, 1)
  equal(snapshot.warnings, [])
  is(snapshot.error, null)

  // Taking a snapshot must not trigger any plugin
  is(calls, 0)
})

test('reports running with warnings while async plugin waits', async () => {
  let release!: () => void
  let barrier = new Promise<void>(resolve => {
    release = resolve
  })
  let plugin: Plugin = {
    async Once(root, { result }) {
      result.warn('still working', { node: root.first })
      await barrier
    },
    postcssPlugin: 'slow-warner'
  }
  let lazy = postcss([plugin]).process('a { color: red }', {
    from: undefined
  })

  let finished = false
  let promise = lazy.async().then(result => {
    finished = true
    return result
  })
  await tick()

  is(finished, false)
  let running = lazy.snapshot()
  is(running.state, 'running')
  is(running.pluginsRun, 0)
  is(running.pluginsTotal, 1)
  is(running.warnings.length, 1)
  is(running.warnings[0].text, 'still working')
  is(running.warnings[0].plugin, 'slow-warner')
  is(running.warnings[0].line, 1)
  is(running.warnings[0].column, 1)

  release()
  await promise

  let done = lazy.snapshot()
  is(done.state, 'succeeded')
  is(done.pluginsRun, 1)
  is(done.warnings.length, 1)
  is(done.error, null)
})

test('keeps warnings and safe error fields on failure', async () => {
  let warner: Plugin = {
    Once(root, { result }) {
      result.warn('before the crash')
    },
    postcssPlugin: 'warner'
  }
  let crasher: Plugin = {
    Once() {
      throw new Error('boom')
    },
    postcssPlugin: 'crasher'
  }
  let lazy = postcss([warner, crasher]).process('a {}', { from: undefined })

  await lazy.async().catch(() => {})

  let snapshot = lazy.snapshot()
  is(snapshot.state, 'failed')
  is(snapshot.pluginsRun, 1)
  is(snapshot.pluginsTotal, 2)

  // Warnings produced before the failure are kept
  is(snapshot.warnings.length, 1)
  is(snapshot.warnings[0].text, 'before the crash')
  is(snapshot.warnings[0].plugin, 'warner')

  // Error carries only safe fields, no AST
  let { error } = snapshot
  ok(error)
  is(error.name, 'Error')
  is(error.message, 'boom')
  is(error.plugin, 'crasher')
  is(Object.keys(error).sort().join(','), 'message,name,plugin')
})

test('reports failed on sync errors too', () => {
  let lazy = postcss([
    () => {
      throw new Error('sync boom')
    }
  ]).process('a {}', { from: undefined })

  is(lazy.snapshot().state, 'pending')
  try {
    lazy.sync()
  } catch {
    // expected
  }
  let snapshot = lazy.snapshot()
  is(snapshot.state, 'failed')
  let { error } = snapshot
  ok(error)
  is(error.message, 'sync boom')
})

test('reports failed on parse errors', () => {
  let lazy = postcss([() => {}]).process('a {', { from: undefined })
  let snapshot = lazy.snapshot()
  is(snapshot.state, 'failed')
  let { error } = snapshot
  ok(error)
  is(error.name, 'CssSyntaxError')
})

test('snapshot objects do not share mutable containers with the run', async () => {
  let plugin: Plugin = {
    Once(root, { result }) {
      result.warn('one')
    },
    postcssPlugin: 'warner'
  }
  let lazy = postcss([plugin]).process('a {}', { from: undefined })
  let result = await lazy.async()

  let snapshot = lazy.snapshot()
  snapshot.warnings.push({
    column: null,
    endColumn: null,
    endLine: null,
    line: null,
    plugin: 'fake',
    text: 'fake'
  })
  snapshot.warnings[0].text = 'mutated'
  ;(snapshot as any).state = 'failed'

  let fresh = lazy.snapshot()
  is(fresh.state, 'succeeded')
  is(fresh.warnings.length, 1)
  is(fresh.warnings[0].text, 'one')

  // Result state is untouched and warnings() semantics are unchanged
  is(result.warnings().length, 1)
  is(result.warnings()[0].text, 'one')
  is(result.warnings()[0].type, 'warning')
})

test('isolates state between processes of one processor', async () => {
  let plugin: Plugin = {
    Once(root, { result }) {
      result.warn('shared plugin warning')
    },
    postcssPlugin: 'shared'
  }
  let processor = new Processor([plugin])

  let first = processor.process('a {}', { from: undefined })
  let second = processor.process('b {}', { from: undefined })

  is(first.snapshot().state, 'pending')
  is(second.snapshot().state, 'pending')

  await first.async()

  is(first.snapshot().state, 'succeeded')
  is(first.snapshot().warnings.length, 1)
  is(second.snapshot().state, 'pending')
  is(second.snapshot().pluginsRun, 0)
  equal(second.snapshot().warnings, [])

  await second.async()
  is(second.snapshot().state, 'succeeded')
  is(second.snapshot().warnings.length, 1)
  is(first.snapshot().warnings.length, 1)
})

test('Result#snapshot reports succeeded with ordered warnings', async () => {
  let plugin: Plugin = {
    Once(root: Root, { result }) {
      result.warn('with node', { node: root.first })
      result.warn('without node')
    },
    postcssPlugin: 'warner'
  }
  let result = await postcss([plugin]).process('a { color: red }', {
    from: undefined
  })

  let snapshot = result.snapshot()
  is(snapshot.state, 'succeeded')
  is(snapshot.error, null)
  is(snapshot.warnings.length, 2)

  is(snapshot.warnings[0].text, 'with node')
  is(snapshot.warnings[0].plugin, 'warner')
  is(snapshot.warnings[0].line, 1)
  is(snapshot.warnings[0].column, 1)

  // Missing position is explicit
  is(snapshot.warnings[1].text, 'without node')
  is(snapshot.warnings[1].line, null)
  is(snapshot.warnings[1].column, null)
  is(snapshot.warnings[1].endLine, null)
  is(snapshot.warnings[1].endColumn, null)

  // Snapshot is detached from the result
  snapshot.warnings[0].text = 'mutated'
  is(result.warnings()[0].text, 'with node')
  is(result.snapshot().warnings[0].text, 'with node')
})

test('NoWorkResult snapshot is succeeded without plugins', async () => {
  let lazy = postcss([]).process('a {}', { from: undefined })
  let snapshot = lazy.snapshot()
  is(snapshot.state, 'succeeded')
  is(snapshot.pluginsRun, 0)
  is(snapshot.pluginsTotal, 0)
  equal(snapshot.warnings, [])
  await lazy.async()
  type(lazy.snapshot().error, 'object')
})

test.run()
