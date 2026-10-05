import { SourceMapConsumer } from 'source-map-js'
import { test } from 'uvu'
import { equal, is, match, ok, throws } from 'uvu/assert'

import Comment from '../lib/comment.js'
import Declaration from '../lib/declaration.js'
import extract = require('../lib/extract-declarations.js')
import postcss, { Rule } from '../lib/postcss.js'

let { applyExtraction, planExtraction } = extract

// Rule with an empty line after the rule-level description and another one
// separating `display`:
//
// .a {
//   /* rule description */
//
//   /* color hint */
//   color: red;
//   /* width hint */
//   width: 1px;
//
//   display: block;
// }
const CSS_WITH_BLANK_LINES = [
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

function firstRule(root: ReturnType<typeof postcss.parse>): Rule {
  return root.first as Rule
}

function findDecl(rule: Rule, prop: string): Declaration {
  return rule.nodes.find(
    i => i.type === 'decl' && i.prop === prop
  ) as Declaration
}

function findComment(rule: Rule, text: string): Comment {
  return rule.nodes.find(
    i => i.type === 'comment' && i.text === text
  ) as Comment
}

function extractColorPlugin(selector?: string): (root: any) => void {
  return root => {
    let rule = firstRule(root)
    applyExtraction(
      planExtraction(rule, [findDecl(rule, 'color')], { selector })
    )
  }
}

test('moves adjacent preceding comment with the declaration', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)
  let color = findDecl(rule, 'color')

  let plan = planExtraction(rule, [color])
  equal(
    plan.groups.map(group =>
      group.map(i => (i.type === 'decl' ? i.prop : i.text))
    ),
    [['color hint', 'color']]
  )

  let { from, to } = applyExtraction(plan)
  is(from, rule)
  is(from.toString().includes('color'), false)
  is(from.toString().includes('color hint'), false)
  ok(to.toString().includes('/* color hint */'))
  ok(to.toString().includes('color: red'))
})

test('keeps the rule-introductory comment in the original rule', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)

  applyExtraction(planExtraction(rule, [findDecl(rule, 'color')]))

  let source = root.nodes[0] as Rule
  let extracted = root.nodes[1] as Rule
  ok(
    source.nodes.some(
      i => i.type === 'comment' && i.text === 'rule description'
    )
  )
  is(
    extracted.nodes.some(
      i => i.type === 'comment' && i.text === 'rule description'
    ),
    false
  )

  // The empty line that separated the description stays in the source rule.
  match(source.toString(), /rule description \*\/\n\n/)
  // Standalone `display` (separated by an empty line) is untouched.
  ok(source.toString().includes('display: block'))
})

test('does not attach comments separated from the decl by an empty line', () => {
  let css = [
    'a {',
    '  /* standalone note */',
    '',
    '  color: red;',
    '}',
    ''
  ].join('\n')
  let root = postcss.parse(css)
  let rule = firstRule(root)

  applyExtraction(planExtraction(rule, [findDecl(rule, 'color')]))

  let source = root.nodes[0] as Rule
  let extracted = root.nodes[1] as Rule
  ok(source.toString().includes('/* standalone note */'))
  is(
    extracted.nodes.some(
      i => i.type === 'comment' && i.text === 'standalone note'
    ),
    false
  )
})

test('collects a whole run of adjacent comments', () => {
  let css = [
    'a {',
    '  /* one */',
    '  /* two */',
    '  color: red;',
    '}',
    ''
  ].join('\n')
  let root = postcss.parse(css)
  let rule = firstRule(root)

  let plan = planExtraction(rule, [findDecl(rule, 'color')])
  equal(
    plan.groups[0].map(i => (i.type === 'decl' ? i.prop : i.text)),
    ['one', 'two', 'color']
  )
})

test('stops at a non-comment node', () => {
  let css = [
    'a {',
    '  /* not color */',
    '  width: 1px;',
    '  /* color hint */',
    '  color: red;',
    '}',
    ''
  ].join('\n')
  let root = postcss.parse(css)
  let rule = firstRule(root)

  let plan = planExtraction(rule, [findDecl(rule, 'color')])
  equal(
    plan.groups[0].map(i => (i.type === 'decl' ? i.prop : i.text)),
    ['color hint', 'color']
  )
})

test('fails the whole plan when a node belongs to another rule', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)
  let foreign = findDecl(
    firstRule(postcss.parse('b { color: blue }')),
    'color'
  )

  let snapshot = root.toString()
  throws(
    () => planExtraction(rule, [foreign]),
    /do not belong to the target rule/
  )
  // Nothing was moved: the tree is byte-identical to the input.
  is(root.toString(), snapshot)
  is(root.nodes.length, 1)
})

test('validates arguments without touching the tree', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)

  throws(() => planExtraction(null as any, []), /Rule node/)
  throws(() => planExtraction(rule, []), /non-empty array/)
  throws(() => planExtraction(rule, [rule.nodes[0] as any]), /Declaration nodes/)
  is(root.nodes.length, 1)
})

test('does not mutate the tree while only planning', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)

  planExtraction(rule, [findDecl(rule, 'color')])
  is(root.nodes.length, 1)
  is(rule.nodes.length, 6)
  is(root.toString(), CSS_WITH_BLANK_LINES)
})

test('keeps original raws on moved nodes', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)
  let color = findDecl(rule, 'color')
  let hint = findComment(rule, 'color hint')

  let colorBetween = color.raws.between
  let hintLeft = hint.raws.left
  let hintRight = hint.raws.right

  applyExtraction(planExtraction(rule, [color]))

  let extracted = root.nodes[1] as Rule
  let movedColor = findDecl(extracted, 'color')
  let movedHint = extracted.nodes.find(i => i.type === 'comment') as Comment
  is(movedColor.raws.between, colorBetween)
  is(movedHint.raws.left, hintLeft)
  is(movedHint.raws.right, hintRight)
  // The moved declaration keeps its terminating semicolon even when it is
  // the last node of the new rule, and the rule inherits block raws.
  is(extracted.raws.semicolon, true)
  match(extracted.toString(), /color: red;/)
})

test('preserves source positions on moved nodes and both rules', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES, { from: 'source.css' })
  let rule = firstRule(root)

  applyExtraction(planExtraction(rule, [findDecl(rule, 'color')]))

  let source = root.nodes[0] as Rule
  let extracted = root.nodes[1] as Rule

  let hint = findComment(extracted, 'color hint')
  let color = findDecl(extracted, 'color')
  let description = findComment(source, 'rule description')

  is(hint.source!.start!.line, 4)
  is(color.source!.start!.line, 5)
  is(description.source!.start!.line, 2)
  // The new rule itself carries the source rule’s position.
  is(extracted.source!.start!.line, source.source!.start!.line)
})

test('both outputs map back to their original source lines', async () => {
  let result = await postcss([extractColorPlugin('.a-extracted')]).process(
    CSS_WITH_BLANK_LINES,
    {
      from: 'source.css',
      map: { annotation: false },
      to: 'out.css'
    }
  )

  ok(result.map)
  let consumer = new SourceMapConsumer(result.map.toJSON())
  let lines = result.css.split('\n')

  function orig(needle: string): null | number {
    let index = lines.findIndex(line => line.includes(needle))
    ok(index !== -1, 'generated line missing: ' + needle)
    let line = index + 1
    let column = lines[index].search(/\S/)
    return consumer.originalPositionFor({ column, line }).line
  }

  // Nodes that stayed in the original rule:
  is(orig('/* rule description */'), 2)
  is(orig('width: 1px'), 7)
  is(orig('display: block'), 9)
  // Nodes that moved into the new rule:
  is(orig('/* color hint */'), 4)
  is(orig('color: red'), 5)
})

test('supports a custom selector for the new rule', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)

  let { to } = applyExtraction(
    planExtraction(rule, [findDecl(rule, 'color')], { selector: '.b' })
  )
  is(to.selector, '.b')
  is((root.nodes[0] as Rule).selector, '.a')
})

test('dedupes repeated declarations and keeps contiguous runs', () => {
  let root = postcss.parse('a { color: red; color: green }')
  let rule = firstRule(root)
  let colors = rule.nodes.filter(
    (i): i is Declaration => i.type === 'decl' && i.prop === 'color'
  )

  let { from, to } = applyExtraction(
    planExtraction(rule, [colors[0], colors[0], colors[1]])
  )
  is(from.nodes.length, 0)
  is(to.nodes.length, 2)
})

test('rejects a stale plan after the tree changed', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)
  let color = findDecl(rule, 'color')
  let plan = planExtraction(rule, [color])
  color.remove()
  throws(() => applyExtraction(plan), /nodes changed/)
})

test('exposes the typed plan and result shapes', () => {
  let root = postcss.parse(CSS_WITH_BLANK_LINES)
  let rule = firstRule(root)
  let plan = planExtraction(rule, [findDecl(rule, 'color')])
  is(plan.selector, '.a')
  ok(Array.isArray(plan.groups))
  let result = applyExtraction(plan)
  is(result.to.type, 'rule')
  is(result.from.type, 'rule')
})

test.run()
