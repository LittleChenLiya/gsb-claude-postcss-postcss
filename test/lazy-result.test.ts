import { SourceMapGenerator } from 'source-map-js'
import { test } from 'uvu'
import { equal, is, type } from 'uvu/assert'

import LazyResult from '../lib/lazy-result.js'
import Processor from '../lib/processor.js'
import Result from '../lib/result.js'
import Root from '../lib/root.js'

let processor = new Processor()

test('contains AST', () => {
  let result = new LazyResult(processor, 'a {}', {})
  is(result.root.type, 'root')
})

test('will stringify css', () => {
  let result = new LazyResult(processor, 'a {}', {})
  is(result.css, 'a {}')
})

test('stringifies css', () => {
  let result = new LazyResult(processor, 'a {}', {})
  is(`${result}`, result.css)
})

test('has content alias for css', () => {
  let result = new LazyResult(processor, 'a {}', {})
  is(result.content, 'a {}')
})

test('has map only if necessary', () => {
  let result1 = new LazyResult(processor, '', {})
  type(result1.map, 'undefined')

  let result2 = new LazyResult(processor, '', {})
  type(result2.map, 'undefined')

  let result3 = new LazyResult(processor, '', { map: { inline: false } })
  is(result3.map instanceof SourceMapGenerator, true)
})

test('contains options', () => {
  let result = new LazyResult(processor, 'a {}', { to: 'a.css' })
  equal(result.opts, { to: 'a.css' })
})

test('contains warnings', () => {
  let result = new LazyResult(processor, 'a {}', {})
  equal(result.warnings(), [])
})

test('contains messages', () => {
  let result = new LazyResult(processor, 'a {}', {})
  equal(result.messages, [])
})

test('executes on finally callback', () => {
  let callbackHaveBeenCalled = 0
  let mockCallback = (): void => {
    callbackHaveBeenCalled++
  }
  return new LazyResult(processor, 'a {}', {})
    .finally(mockCallback)
    .then(() => {
      is(callbackHaveBeenCalled, 1)
    })
})

test('prints its object type', () => {
  let result = new LazyResult(processor, 'a {}', {})
  is(Object.prototype.toString.call(result), '[object LazyResult]')
})

function deferred<T>(): {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  let promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

test('snapshot is pending with zero plugins for unstarted lazy result', () => {
  let result = new LazyResult(processor, 'a {}', {})
  let snapshot = result.snapshot()
  is(snapshot.state, 'pending')
  is(snapshot.plugins, 0)
  equal(snapshot.warnings, [])
  is(snapshot.error, null)
})

test('snapshot does not start processing', () => {
  let calls = 0
  let plugin = (): void => {
    calls += 1
  }
  let result = new LazyResult(new Processor([plugin]), 'a {}', {})
  result.snapshot()
  result.snapshot()
  is(calls, 0)
  is(result.snapshot().state, 'pending')
  is(result.snapshot().plugins, 0)
})

test('snapshot does not await or retrigger running plugins', async () => {
  let calls = 0
  let gate = deferred<void>()
  let plugin = (): Promise<void> => {
    calls += 1
    return gate.promise
  }
  let result = new LazyResult(new Processor([plugin]), 'a {}', {
    from: undefined
  })
  let processing = result.async()
  result.snapshot()
  result.snapshot()
  is(calls, 1)
  is(result.snapshot().state, 'running')
  gate.resolve()
  await processing
  is(calls, 1)
  is(result.snapshot().state, 'succeeded')
})

test('snapshot is running with produced warning at async barrier', async () => {
  let gate = deferred<void>()
  let plugin = (root: Root, result: Result): Promise<void> => {
    result.warn('wait for me', { node: root.first })
    return gate.promise
  }
  let result = new LazyResult(new Processor([plugin]), 'a {}', {
    from: undefined
  })
  let processing = result.async()
  let snapshot = result.snapshot()
  is(snapshot.state, 'running')
  is(snapshot.plugins, 1)
  is(snapshot.warnings.length, 1)
  is(snapshot.warnings[0].type, 'warning')
  is(snapshot.warnings[0].text, 'wait for me')
  is(snapshot.warnings[0].line, 1)
  is(snapshot.warnings[0].column, 1)
  is(snapshot.warnings[0].endLine, 1)
  is(snapshot.warnings[0].endColumn, 5)
  is('node' in snapshot.warnings[0], false)
  gate.resolve()
  await processing
  let done = result.snapshot()
  is(done.state, 'succeeded')
  is(done.plugins, 1)
  is(done.warnings.length, 1)
})

test('snapshot is failed and keeps warnings after plugin error', async () => {
  let error = new Error('boom')
  let warnPlugin = (root: Root, result: Result): void => {
    result.warn('before error')
  }
  let badPlugin = (): void => {
    throw error
  }
  let result = new LazyResult(
    new Processor([warnPlugin, badPlugin]),
    'a {}',
    { from: undefined }
  )
  await result.async().catch(() => {})
  let snapshot = result.snapshot()
  is(snapshot.state, 'failed')
  is(snapshot.plugins, 2)
  is(snapshot.warnings.length, 1)
  is(snapshot.warnings[0].text, 'before error')
  is(snapshot.warnings[0].line, null)
  is(snapshot.warnings[0].column, null)
  is(snapshot.error === null, false)
  let snapshotError = snapshot.error as NonNullable<typeof snapshot.error>
  is(snapshotError.name, 'Error')
  is(snapshotError.message, 'boom')
  is(snapshotError.plugin, null)
  is('node' in (snapshotError as object), false)
})

test('snapshots do not share mutable containers', () => {
  let result = new LazyResult(processor, 'a {}', {})
  let a = result.snapshot()
  let b = result.snapshot()
  is(a.warnings !== b.warnings, true)
  ;(a.warnings as unknown[]).push('intruder')
  a.state = 'failed'
  ;(a as { error: unknown }).error = { fake: true }
  let c = result.snapshot()
  is(c.state, 'pending')
  is(c.warnings.length, 0)
  is(c.error, null)
})

test('snapshots of different processings do not mix state', async () => {
  let gate = deferred<void>()
  let plugin = (root: Root, result: Result): Promise<void> => {
    result.warn('first run warning')
    return gate.promise
  }
  let proc = new Processor([plugin])
  let first = proc.process('a {}', { from: undefined })
  let second = proc.process('b {}', { from: undefined })
  first.async()
  await Promise.resolve()
  is(first.snapshot().state, 'running')
  is(first.snapshot().plugins, 1)
  is(first.snapshot().warnings.length, 1)
  is(second.snapshot().state, 'pending')
  is(second.snapshot().plugins, 0)
  is(second.snapshot().warnings.length, 0)
  gate.resolve()
  await first
  is(first.snapshot().state, 'succeeded')
  is(first.snapshot().warnings.length, 1)
  is(second.snapshot().state, 'pending')
  is(second.snapshot().plugins, 0)
})

test('snapshot warning order follows messages order', async () => {
  let plugin = (root: Root, result: Result): void => {
    result.warn('first', { node: root.first })
    result.warn('second', { node: root.first })
    result.warn('third')
  }
  let result = await new Processor([plugin]).process('a {}', {
    from: undefined
  })
  let texts = result.snapshot().warnings.map(i => i.text)
  equal(texts, ['first', 'second', 'third'])
})

test.run()
