import { SourceMapConsumer } from 'source-map-js'
import { test } from 'uvu'
import { equal, is, ok, throws } from 'uvu/assert'

import extract from '../lib/extract.js'
import postcss from '../lib/postcss.js'

let css = `.a {
  /* rule description */

  /* color comment */
  color: red;

  /* bg comment */
  background: blue;
}
`

function names(rule: any): string[] {
  return rule.nodes.map((n: any) =>
    n.type === 'decl' ? 'decl:' + n.prop : 'comment:' + n.text
  )
}

test('moves the adjacent comment with the declaration', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let plan = extract(rule, '.b', ['color'])
  let extracted = plan.apply()

  equal(names(rule), [
    'comment:rule description',
    'comment:bg comment',
    'decl:background'
  ])
  equal(names(extracted), ['comment:color comment', 'decl:color'])
  is(extracted.selector, '.b')
})

test('leaves a standalone description and blank-line-separated comments', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  is(rule.nodes[0].text, 'rule description')
  is(rule.nodes[1].text, 'bg comment')
  equal(
    root.toString().match(/color comment/g)!.length +
      root.toString().match(/bg comment/g)!.length +
      root.toString().match(/rule description/g)!.length,
    3
  )
  ok(extracted.toString().includes('color: red'))
  ok(!extracted.toString().includes('rule description'))
})

test('moves a chain of consecutive comments together', () => {
  let source = `.a {
  /* one */
  /* two */
  color: red;
}
`
  let root = postcss.parse(source)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  equal(names(extracted), [
    'comment:one',
    'comment:two',
    'decl:color'
  ])
})

test('leaves a trailing comment after the selected declaration', () => {
  let source = `.a {
  color: red;
  /* trailing */
}
`
  let root = postcss.parse(source)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  equal(names(extracted), ['decl:color'])
  equal(names(rule), ['comment:trailing'])
})

test('trims the leading blank line of the moved chain', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  is(extracted.raws.between, ' ')
  is(extracted.raws.after, '\n')
  ok(extracted.toString().includes('.b {'))
  ok(extracted.toString().includes('color: red;'))
  ok(!extracted.toString().includes('{\n\n'))
})

test('preserves raws of the moved nodes', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let colorComment = rule.nodes[1]
  let colorDecl = rule.nodes[2]
  let beforeComment = colorComment.raws.before
  let beforeDecl = colorDecl.raws.before
  let between = colorDecl.raws.between

  let extracted = extract(rule, '.b', ['color']).apply()
  let movedComment = extracted.nodes[0]
  let movedDecl = extracted.nodes[1]

  is(movedComment.raws.before, beforeComment.replace(/^\n\n/, '\n'))
  is(movedDecl.raws.before, beforeDecl)
  is(movedDecl.raws.between, between)
})

test('both rules trace back to the original source lines', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  is(extracted.source.input.css, css)
  is(extracted.source.start.line, rule.source.start.line)
  is(extracted.source.start.line, 1)
  is(extracted.nodes[1].source.start.line, 5)
  is(rule.nodes[2].source.start.line, 8)
})

test('generates a source map that maps back to the source', () => {
  let root = postcss.parse(css, { from: 'source.css' })
  let rule = root.first as any
  extract(rule, '.b', ['color']).apply()

  let result = root.toResult({
    map: { annotation: false, inline: false },
    to: 'output.css'
  })
  let map = result.map.toJSON()
  ok(map.mappings.length > 0)
  equal(map.sources, ['source.css'])

  // Decode the map: the moved color declaration must point back to its
  // original source line.
  let consumer = new SourceMapConsumer(map)
  let genLines = result.css.split('\n')
  let colorGenLine = genLines.findIndex((l: string) =>
    l.includes('color: red')
  )
  ok(colorGenLine >= 0)
  let pos = consumer.originalPositionFor({
    column: 2,
    line: colorGenLine + 1
  })
  is(pos.source, 'source.css')
  is(pos.line, 5)
})

test('rejects a declaration that does not belong to the rule', () => {
  let source = `.a {
  color: red;
}
.b {
  color: blue;
}
`
  let root = postcss.parse(source)
  let ruleA = root.nodes[0] as any
  let ruleB = root.nodes[1] as any
  let foreign = ruleB.nodes[0]

  throws(() => extract(ruleA, '.c', [foreign]), /does not belong/)
  equal(names(ruleA), ['decl:color'])
  equal(names(ruleB), ['decl:color'])
})

test('rejects an unknown prop without mutating the tree', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let before = root.toString()

  throws(() => extract(rule, '.b', ['nope']), /not found/)
  is(root.toString(), before)
  equal(names(rule), [
    'comment:rule description',
    'comment:color comment',
    'decl:color',
    'comment:bg comment',
    'decl:background'
  ])
})

test('rejects invalid targets and selectors', () => {
  let root = postcss.parse(css)
  let rule = root.first as any

  throws(() => extract(root, '.b', ['color']), /rule node/)
  throws(() => extract(rule, '  ', ['color']), /selector/)
  throws(() => extract(rule, '.b', []), /at least one/)
  throws(() => extract(rule, '.b', [42 as any]), /prop names or declaration nodes/)
})

test('does not move anything when the plan fails', () => {
  let source = `.a {
  color: red;
}
.b {
  color: blue;
}
`
  let root = postcss.parse(source)
  let ruleA = root.nodes[0] as any
  let ruleB = root.nodes[1] as any
  let foreign = ruleB.nodes[0]
  let before = root.toString()

  try {
    extract(ruleA, '.c', ['color', foreign])
  } catch (e) {
    ok(e instanceof Error)
  }
  is(root.toString(), before)
})

test('dedupes repeated props', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color', 'color']).apply()

  equal(names(extracted), ['comment:color comment', 'decl:color'])
})

test('can extract multiple declarations', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color', 'background']).apply()

  equal(names(extracted), [
    'comment:color comment',
    'decl:color',
    'comment:bg comment',
    'decl:background'
  ])
  equal(names(rule), ['comment:rule description'])
})

test('the new rule is inserted next to the source rule', () => {
  let root = postcss.parse(css)
  let rule = root.first as any
  let extracted = extract(rule, '.b', ['color']).apply()

  is(extracted.parent, root)
  is(root.index(extracted), root.index(rule) + 1)
})

test('is exposed as a standalone module', () => {
  is(typeof extract, 'function')
  is(extract.name, 'extract')
})

test.run()
