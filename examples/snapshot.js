// Short demo: watch processing stages and warnings through snapshots.
// Run with: node examples/snapshot.js
'use strict'
/* eslint-disable no-console */

let postcss = require('../lib/postcss.js')

function show(label, snapshot) {
  let warnings = snapshot.warnings
    .map(i => `"${i.text}" (${i.plugin}@${i.line}:${i.column})`)
    .join(', ')
  console.log(
    `${label}: state=${snapshot.state} ` +
      `plugins=${snapshot.pluginsRun}/${snapshot.pluginsTotal} ` +
      `warnings=[${warnings}]` +
      (snapshot.error ? ` error=${snapshot.error.name}: ${snapshot.error.message}` : '')
  )
}

async function main() {
  let release
  let barrier = new Promise(resolve => {
    release = resolve
  })

  let slowWarner = {
    async Once(root, { result }) {
      result.warn('still working', { node: root.first })
      await barrier // pause here so we can snapshot a running pipeline
    },
    postcssPlugin: 'slow-warner'
  }

  let lazy = postcss([slowWarner]).process('a { color: red }', {
    from: undefined
  })

  show('before start   ', lazy.snapshot()) // pending, plugins not called

  let done = lazy.async()
  await new Promise(resolve => setTimeout(resolve, 10))
  show('plugin blocked ', lazy.snapshot()) // running, warning already visible

  release()
  await done
  show('after release  ', lazy.snapshot()) // succeeded

  // Failure keeps earlier warnings and exposes only safe error fields
  let warner = {
    Once(root, { result }) {
      result.warn('before the crash')
    },
    postcssPlugin: 'warner'
  }
  let crasher = {
    Once() {
      throw new Error('boom')
    },
    postcssPlugin: 'crasher'
  }
  let failing = postcss([warner, crasher]).process('a {}', {
    from: undefined
  })
  await failing.async().catch(() => {})
  show('after failure  ', failing.snapshot()) // failed, warning kept
}

main()
