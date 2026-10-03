'use strict'

/**
 * Prints the phase changes of an asynchronous PostCSS processing.
 *
 * Run it with:
 *
 * ```js
 * node demo/snapshot.js
 * ```
 *
 * The snapshot never starts or awaits processing, so the build tool can
 * observe `pending`, `running`, `succeeded` and `failed` without
 * interfering with the plugins.
 */

let postcss = require('../lib/postcss')

function barrier() {
  let resolve
  let promise = new Promise(r => {
    resolve = r
  })
  return { promise, resolve }
}

function print(label, snapshot) {
  let warnings = snapshot.warnings.map(i => i.text).join(', ') || 'none'
  console.log(
    label +
      ' state=' + snapshot.state +
      ' plugins=' + snapshot.plugins +
      ' warnings=' + warnings +
      ' error=' + (snapshot.error ? snapshot.error.message : 'none')
  )
}

async function main() {
  let gate = barrier()
  let warnPlugin = (root, result) => {
    result.warn('declaration uses !important', { node: root.first })
    return gate.promise
  }
  let failPlugin = () => {
    throw new Error('plugin boom')
  }

  // A successful processing: pending -> running -> succeeded.
  let lazy = postcss([warnPlugin]).process('a { color: red !important }', {
    from: undefined
  })
  print('before start ', lazy.snapshot())

  let processing = lazy.then(result => result)
  await Promise.resolve()
  print('at barrier  ', lazy.snapshot())

  gate.resolve()
  await processing
  print('after release', lazy.snapshot())

  // A failing processing: pending -> running -> failed, warnings kept.
  let gate2 = barrier()
  let fail = postcss([
    (root, result) => {
      result.warn('watch out')
      return gate2.promise
    },
    failPlugin
  ]).process('b {}', { from: undefined })
  let failing = fail.catch(() => {})
  await Promise.resolve()
  print('failing run ', fail.snapshot())

  gate2.resolve()
  await failing
  print('after fail  ', fail.snapshot())
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
