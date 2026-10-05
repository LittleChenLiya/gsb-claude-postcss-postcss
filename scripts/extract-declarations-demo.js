#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

// Local acceptance command for declaration extraction with comment
// attribution. No test runner needed:
//
//   node scripts/extract-declarations-demo.js
//
// It parses a rule with empty lines, extracts `color`, verifies that the
// adjacent comment moves while the rule description stays, checks that
// every output token maps back to its original source line, and finally
// asserts that a node from another rule makes the whole plan fail.
// Exits with code 1 on any failed assertion.

let assert = require('assert')
let { SourceMapConsumer } = require('source-map-js')

let { applyExtraction, planExtraction } = require('../lib/extract-declarations.js')
let postcss = require('../lib/postcss.js')

const CSS = [
  '.a {',
  '  /* rule description */',
  '',
  '  /* color hint */',
  '  color: red;',
  '  /* width hint */',
  '  width: 1px;',
  '',
  '  display: block;',
  '}',
  ''
].join('\n')

function extract(root) {
  let rule = root.first
  let color = rule.nodes.find(i => i.prop === 'color')
  applyExtraction(planExtraction(rule, [color], { selector: '.a-color' }))
}

async function main() {
  let result = await postcss([extract]).process(CSS, {
    from: 'source.css',
    map: { annotation: false },
    to: 'out.css'
  })

  console.log('--- output CSS ---')
  console.log(result.css)

  // 1. Comment attribution: adjacent comment moves, description stays.
  assert.ok(
    result.css.includes('/* color hint */\n  color: red;'),
    'adjacent comment should move with color'
  )
  let [sourceRule, extractedRule] = result.root.nodes
  assert.ok(
    sourceRule.nodes.some(i => i.text === 'rule description'),
    'rule description must stay in the original rule'
  )
  assert.ok(
    !extractedRule.nodes.some(i => i.text === 'rule description'),
    'rule description must not move'
  )

  // 2. Source map: both outputs trace to original source lines.
  let consumer = new SourceMapConsumer(result.map.toJSON())
  let lines = result.css.split('\n')
  let expected = [
    ['/* rule description */', 2],
    ['/* color hint */', 4],
    ['color: red', 5],
    ['width: 1px', 7],
    ['display: block', 9]
  ]
  for (let [needle, origLine] of expected) {
    let line = lines.findIndex(i => i.includes(needle)) + 1
    assert.ok(line > 0, 'generated line missing: ' + needle)
    let column = lines[line - 1].search(/\S/)
    let mapped = consumer.originalPositionFor({ column, line })
    assert.strictEqual(
      mapped.line,
      origLine,
      `${needle} should map to source line ${origLine}, got ${mapped.line}`
    )
    console.log(`sourcemap ok: ${needle} -> source.css:${origLine}`)
  }

  // 3. A node belonging to another rule fails the whole plan.
  let root = postcss.parse(CSS)
  let foreign = postcss.parse('b { color: blue }').first.first
  assert.throws(
    () => planExtraction(root.first, [foreign]),
    /do not belong to the target rule/
  )
  assert.strictEqual(
    root.toString(),
    CSS,
    'AST must stay untouched after a rejected plan'
  )

  console.log('\nAll local acceptance checks passed.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
