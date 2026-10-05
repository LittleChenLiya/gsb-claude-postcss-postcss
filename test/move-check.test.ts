import { test } from 'uvu'
import { equal, is, ok, type } from 'uvu/assert'

import postcss, { AtRule, parse, Rule } from '../lib/postcss.js'

function setup(css: string) {
  let root = parse(css, { from: 'test.css' })
  let byParams = new Map<string, AtRule>()
  root.walkAtRules(atRule => {
    if (!byParams.has(atRule.params)) byParams.set(atRule.params, atRule)
  })
  return { byParams, root }
}

test('reports media condition change when moving between @media blocks', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media b { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaB = byParams.get('b') as AtRule

  let report = postcss.moveCheck(rule, mediaB)

  is(report.safe, false)
  is(report.risks.length, 1)
  is(report.risks[0].type, 'media')
  is(report.risks[0].old?.condition, 'a')
  is(report.risks[0].new?.condition, 'b')
  ok(report.risks[0].message.includes('@media a'))
  ok(report.risks[0].message.includes('@media b'))
})

test('passes when moving within the same media chain', () => {
  let { root } = setup(
    '@media a { .rule { color: red } .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let other = (root.first as AtRule)?.nodes?.[1] as Rule

  let report = postcss.moveCheck(rule, other, { before: true })

  is(report.safe, true)
  is(report.risks.length, 0)
})

test('passes when moving to a parent with the same context chain', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media a { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaA2 = byParams.get('a') as AtRule

  let report = postcss.moveCheck(rule, mediaA2)

  is(report.safe, true)
  is(report.risks.length, 0)
})

test('two anonymous @layer blocks are not equal', () => {
  let { root } = setup(
    '@layer { .rule { color: red } } @layer { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let layerB = root.nodes?.[1] as AtRule

  let report = postcss.moveCheck(rule, layerB)

  is(report.safe, false)
  is(report.risks.length, 1)
  is(report.risks[0].type, 'layer')
  is(report.risks[0].old?.name, null)
  is(report.risks[0].new?.name, null)
  is(report.risks[0].old?.node, root.first)
  is(report.risks[0].new?.node, layerB)
})

test('named layers compare by name', () => {
  let { root } = setup(
    '@layer base { .rule { color: red } } ' +
      '@layer theme { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let theme = root.nodes?.[1] as AtRule

  let report = postcss.moveCheck(rule, theme)

  is(report.safe, false)
  is(report.risks.length, 1)
  is(report.risks[0].type, 'layer')
  is(report.risks[0].old?.name, 'base')
  is(report.risks[0].new?.name, 'theme')
})

test('same named layer passes', () => {
  let { root } = setup(
    '@layer base { .rule { color: red } } ' +
      '@layer base { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let base2 = root.nodes?.[1] as AtRule

  let report = postcss.moveCheck(rule, base2)

  is(report.safe, true)
  is(report.risks.length, 0)
})

test('layer risk includes layer order explanation', () => {
  let { root } = setup(
    '@layer base { .rule { color: red } } ' +
      '@layer theme { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let theme = root.nodes?.[1] as AtRule

  let report = postcss.moveCheck(rule, theme)

  ok(report.risks[0].layerOrder)
  ok(report.risks[0].layerOrder?.includes('cascade priority'))
  ok(report.risks[0].layerOrder?.includes('first declaration'))
})

test('reports supports condition change', () => {
  let { byParams, root } = setup(
    '@supports (display: grid) { .rule { color: red } } ' +
      '@supports (display: flex) { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let supportsFlex = byParams.get('(display: flex)') as AtRule

  let report = postcss.moveCheck(rule, supportsFlex)

  is(report.safe, false)
  is(report.risks.length, 1)
  is(report.risks[0].type, 'supports')
  is(report.risks[0].old?.condition, '(display: grid)')
  is(report.risks[0].new?.condition, '(display: flex)')
})

test('reports context added when moving to a nested chain', () => {
  let { root } = setup(
    '.rule { color: red } @media a { @supports x { .other { color: blue } } }'
  )
  let rule = root.first as Rule
  let mediaA = root.nodes?.[1] as AtRule
  let supportsX = mediaA.first as AtRule

  let report = postcss.moveCheck(rule, supportsX)

  is(report.safe, false)
  is(report.risks.length, 2)
  is(report.risks[0].type, 'supports')
  is(report.risks[1].type, 'media')
})

test('reports context removed when moving out of a nested chain', () => {
  let { root } = setup(
    '@media a { @supports x { .rule { color: red } } } .other { color: blue }'
  )
  let rule = ((root.first as AtRule)?.first as AtRule)?.first as Rule
  let other = root.nodes?.[1] as Rule

  let report = postcss.moveCheck(rule, other)

  is(report.safe, false)
  is(report.risks.length, 2)
  is(report.risks[0].type, 'supports')
  is(report.risks[1].type, 'media')
})

test('source positions remain traceable', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media b { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaB = byParams.get('b') as AtRule

  let report = postcss.moveCheck(rule, mediaB)

  ok(report.risks[0].source)
  is(report.risks[0].source?.start?.line, 1)
  is(report.risks[0].source?.start?.column, 12)
  ok(report.risks[0].source?.input?.endsWith('test.css'))
  ok(report.plan.from.source)
  ok(report.plan.to.source)
})

test('does not modify the tree', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media b { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaB = byParams.get('b') as AtRule
  let originalParent = rule.parent
  let originalString = root.toString()

  postcss.moveCheck(rule, mediaB)

  is(rule.parent, originalParent)
  is(root.toString(), originalString)
})

test('detects cycle when moving a node into itself', () => {
  let { root } = setup('.rule { color: red }')
  let rule = root.first as Rule

  let report = postcss.moveCheck(rule, rule)

  is(report.safe, false)
  is(report.risks[0].type, 'cycle')
})

test('plan records from and to locations', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media b {}'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaB = byParams.get('b') as AtRule

  let report = postcss.moveCheck(rule, mediaB)

  is(report.plan.node, rule)
  is(report.plan.from.parent, root.first)
  is(report.plan.to.parent, mediaB)
  is(report.plan.from.index, 0)
  is(report.plan.to.index, 0)
})

test('Node.moveCheck method works', () => {
  let { byParams, root } = setup(
    '@media a { .rule { color: red } } @media b { .other { color: blue } }'
  )
  let rule = (root.first as AtRule)?.first as Rule
  let mediaB = byParams.get('b') as AtRule

  let report = rule.moveCheck(mediaB)

  is(report.safe, false)
  is(report.risks[0].type, 'media')
})

test('throws on invalid arguments', () => {
  let { root } = setup('.rule { color: red }')
  let rule = root.first as Rule

  try {
    postcss.moveCheck(null as never, rule)
    ok(false, 'should have thrown')
  } catch (e) {
    ok(e instanceof Error)
  }

  try {
    postcss.moveCheck(rule, null as never)
    ok(false, 'should have thrown')
  } catch (e) {
    ok(e instanceof Error)
  }
})

test.run()
