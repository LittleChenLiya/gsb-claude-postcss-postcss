import { test } from 'uvu'
import { equal, is, match, ok, type } from 'uvu/assert'

import postcss, { AtRule, movePreflight, parse, Rule } from '../lib/postcss.js'

function mediaOf(root: postcss.Root, index: number): AtRule {
  return root.nodes[index] as AtRule
}

function firstRule(atRule: AtRule): Rule {
  return atRule.first as Rule
}

test('reports condition change when moving a rule from @media a to @media b', () => {
  let root = parse('@media a{.x{}} @media b{.y{}}')
  let plan = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 1))

  is(plan.safe, false)
  is(plan.changes.length, 1)
  is(plan.changes[0].type, 'media')
  equal(plan.changes[0].from, ['a'])
  equal(plan.changes[0].to, ['b'])
  match(plan.risks[0], '@media context changes from "a" to "b"')
})

test('passes when moving inside the same at-rule chain', () => {
  let root = parse('@media a{.x{} .y{}} @media a{.z{}}')

  let sameParent = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 0))
  is(sameParent.safe, true)
  equal(sameParent.changes, [])
  equal(sameParent.risks, [])

  let sameParams = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 1))
  is(sameParams.safe, true)
  equal(sameParams.changes, [])
})

test('treats two anonymous layers with identical params as different', () => {
  let root = parse('@layer{.a{}} @layer{.b{}}')
  let first = mediaOf(root, 0)
  let second = mediaOf(root, 1)

  is(first.params, second.params)
  ok(first !== second)

  let plan = movePreflight(firstRule(first), second)
  is(plan.safe, false)
  is(plan.changes[0].type, 'layer')
  match(plan.changes[0].from[0], /anonymous layer at 1:1/)
  match(plan.changes[0].to[0], /anonymous layer at 1:14/)
})

test('keeps anonymous layer identity for the same node', () => {
  let root = parse('@layer{.a{} .b{}}')
  let layer = mediaOf(root, 0)
  let plan = movePreflight(firstRule(layer), layer)
  is(plan.safe, true)
  equal(plan.changes, [])
})

test('compares named layers by name', () => {
  let root = parse('@layer base{.a{}} @layer base{.b{}} @layer theme{.c{}}')
  let sameName = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 1))
  is(sameName.safe, true)

  let otherName = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 2))
  is(otherName.safe, false)
  is(otherName.changes[0].type, 'layer')
  equal(otherName.changes[0].from, ['base'])
  equal(otherName.changes[0].to, ['theme'])
})

test('reports supports and other at-rule context changes', () => {
  let root = parse('@media a{ @supports (display: grid){ .x{} } }')
  let plan = movePreflight(
    firstRule(mediaOf(root, 0).first as AtRule),
    root
  )
  is(plan.safe, false)
  equal(
    plan.changes.map(change => change.type),
    ['media', 'supports']
  )
})

test('explains cascade layer order changes', () => {
  let root = parse('@layer base, theme; @layer base{.a{}} @layer theme{.b{}}')
  let plan = movePreflight(firstRule(mediaOf(root, 1)), mediaOf(root, 2))

  equal(plan.layerOrder.order, ['base', 'theme'])
  equal(plan.layerOrder.from, { index: 0, label: 'base' })
  equal(plan.layerOrder.to, { index: 1, label: 'theme' })
  is(plan.layerOrder.changed, true)
  match(plan.layerOrder.message as string, 'base (position 0) -> theme (position 1)')
  match(plan.layerOrder.message as string, 'later layers beat earlier ones')
})

test('keeps layer order stable for moves inside one layer', () => {
  let root = parse('@layer base{.a{}} @layer base{.b{}}')
  let plan = movePreflight(firstRule(mediaOf(root, 0)), mediaOf(root, 1))
  is(plan.layerOrder.changed, false)
  is(plan.layerOrder.message, null)
  is(plan.safe, true)
})

test('does not move the node and keeps source positions queryable', () => {
  let css = '@media a{.x{}}\n@media b{.y{}}'
  let root = parse(css, { from: 'input.css' })
  let rule = firstRule(mediaOf(root, 0))

  let plan = movePreflight(rule, mediaOf(root, 1))

  is(root.toString(), css)
  is(rule.parent, mediaOf(root, 0))
  is(plan.node, rule)
  is(plan.from.parent, mediaOf(root, 0))
  is(plan.to.parent, mediaOf(root, 1))

  equal(plan.from.chain[0].position, { column: 1, line: 1, offset: 0 })
  equal(plan.to.chain[0].position, { column: 1, line: 2, offset: 15 })
  is(plan.from.chain[0].node, mediaOf(root, 0))
  is(rule.source?.start?.line, 1)
  match(rule.source?.input.from as string, /input\.css$/)
})

test('walks the real AST chain, root-first', () => {
  let root = parse('@media a{ @layer one{ @supports (x: y){ .r{} } } }')
  let rule = firstRule((mediaOf(root, 0).first as AtRule).first as AtRule)
  let plan = movePreflight(rule, root)

  equal(
    plan.from.chain.map(entry => entry.kind),
    ['media', 'layer', 'supports']
  )
  equal(plan.from.chain.map(entry => entry.params), [
    'a',
    'one',
    '(x: y)'
  ])
  equal(plan.to.chain, [])
})

test('warns when moving across roots', () => {
  let from = parse('@media a{.x{}}', { from: 'a.css' })
  let to = parse('@media a{.y{}}', { from: 'b.css' })
  let plan = movePreflight(firstRule(mediaOf(from, 0)), mediaOf(to, 0))

  is(plan.safe, true)
  ok(plan.risks.some(risk => risk.includes('different roots')))
})

test('validates arguments', () => {
  let root = parse('@media a{.x{}}')
  // @ts-expect-error testing runtime validation
  expectThrows(() => movePreflight(null, root))
  // @ts-expect-error testing runtime validation
  expectThrows(() => movePreflight(firstRule(mediaOf(root, 0)), null))
})

function expectThrows(fn: () => void): void {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  is(threw, true)
}

test('is exposed on the postcss namespace', () => {
  type(postcss.movePreflight, 'function')
  is(postcss.movePreflight, movePreflight)
})

test.run()
