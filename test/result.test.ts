import { test } from 'uvu'
import { equal, is } from 'uvu/assert'

import postcss, { Plugin, Result, Root, Warning } from '../lib/postcss.js'
import Processor from '../lib/processor.js'

let processor = new Processor()
let root = new Root()

test('stringifies', () => {
  let result = new Result(processor, root, {})
  result.css = 'a{}'
  is(`${result}`, result.css)
})

test('adds warning', () => {
  let warning
  let plugin: Plugin = {
    Once(css, { result }) {
      warning = result.warn('test', { node: css.first })
    },
    postcssPlugin: 'test-plugin'
  }
  let result = postcss([plugin]).process('a{}').sync()

  equal(
    warning,
    new Warning('test', {
      node: result.root.first,
      plugin: 'test-plugin'
    })
  )

  equal(result.messages, [warning])
})

test('allows to override plugin', () => {
  let plugin: Plugin = {
    Once(css, { result }) {
      result.warn('test', { plugin: 'test-plugin#one' })
    },
    postcssPlugin: 'test-plugin'
  }
  let result = postcss([plugin]).process('a{}').sync()

  is(result.messages[0].plugin, 'test-plugin#one')
})

test('allows Root', () => {
  let css = postcss.parse('a{}')
  let result = new Result(processor, css, {})
  result.warn('TT', { node: css.first })

  is(result.messages[0].toString(), '<css input>:1:1: TT')
})

test('returns only warnings', () => {
  let result = new Result(processor, root, {})
  result.messages = [
    { text: 'a', type: 'warning' },
    { type: 'custom' },
    { text: 'b', type: 'warning' }
  ]
  equal(result.warnings(), [
    { text: 'a', type: 'warning' },
    { text: 'b', type: 'warning' }
  ])
})

test('snapshot is succeeded with warnings and no AST', () => {
  let result = new Result(processor, root, {})
  result.warn('watch out', { node: postcss.parse('a{}').first })
  let snapshot = result.snapshot()
  is(snapshot.state, 'succeeded')
  is(snapshot.plugins, 0)
  is(snapshot.error, null)
  is(snapshot.warnings.length, 1)
  is(snapshot.warnings[0].text, 'watch out')
  is(snapshot.warnings[0].line, 1)
  is(snapshot.warnings[0].column, 1)
  is('node' in snapshot.warnings[0], false)
})

test('snapshot reports missing positions explicitly as null', () => {
  let result = new Result(processor, root, {})
  result.warn('without position')
  let snapshot = result.snapshot()
  is(snapshot.warnings[0].line, null)
  is(snapshot.warnings[0].column, null)
  is(snapshot.warnings[0].endLine, null)
  is(snapshot.warnings[0].endColumn, null)
  is(snapshot.warnings[0].plugin, null)
})

test('snapshot containers are detached from the result', () => {
  let result = new Result(processor, root, {})
  result.warn('first')
  let a = result.snapshot()
  let b = result.snapshot()
  is(a.warnings !== b.warnings, true)
  ;(a.warnings as unknown[]).push('intruder')
  is(result.snapshot().warnings.length, 1)
})

test.run()
