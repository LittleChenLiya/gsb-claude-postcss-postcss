import { test } from 'uvu'
import { equal, is, type } from 'uvu/assert'

import postcss, { parse, Root } from '../lib/postcss.js'

let css =
  '/* 中文注释 */\r\n' +
  '.a {\r\n' +
  '  color: red; /* 尾注 */\r\n' +
  '  .b {\r\n' +
  '    width: 1px;\r\n' +
  '  }\r\n' +
  '}\r\n'

function bytes(string: string): number {
  return Buffer.byteLength(string, 'utf8')
}

function byteOf(substring: string): number {
  return byteOfIn(css, substring)
}

function byteOfIn(source: string, substring: string): number {
  let index = source.indexOf(substring)
  if (index === -1) throw new Error(`No ${substring} in fixture`)
  return bytes(source.slice(0, index))
}

test('is cached on root', () => {
  let root = parse(css)
  is(root.positionIndex, root.positionIndex)
})

test('finds innermost node by UTF-8 byte offset', () => {
  let root = parse(css)
  let index = root.positionIndex

  let comment = index.find(byteOf('中文'))!
  is(comment.node.type, 'comment')
  is((comment.node as postcss.Comment).text, '中文注释')
  equal(
    comment.parents.map(i => i.type),
    ['root']
  )

  let rule = index.find(byteOf('.a'))!
  is(rule.node.type, 'rule')
  is((rule.node as postcss.Rule).selector, '.a')

  let decl = index.find(byteOf('color'))!
  is(decl.node.type, 'decl')
  is((decl.node as postcss.Declaration).prop, 'color')
  equal(
    decl.parents.map(i => i.type),
    ['root', 'rule']
  )

  let tailComment = index.find(byteOf('尾注'))!
  is(tailComment.node.type, 'comment')
  is((tailComment.node as postcss.Comment).text, '尾注')

  let nestedRule = index.find(byteOf('.b'))!
  is(nestedRule.node.type, 'rule')
  is((nestedRule.node as postcss.Rule).selector, '.b')
  equal(
    nestedRule.parents.map(i => i.type),
    ['root', 'rule']
  )

  let nestedDecl = index.find(byteOf('width'))!
  is(nestedDecl.node.type, 'decl')
  equal(
    nestedDecl.parents.map(i => i.type),
    ['root', 'rule', 'rule']
  )
})

test('returns byte ranges matching the source text', () => {
  let root = parse(css)
  let index = root.positionIndex
  let buffer = Buffer.from(css, 'utf8')

  root.walk(node => {
    let range = index.rangeOf(node)!
    type(range, 'object')
    is(range.start, bytes(css.slice(0, node.source!.start!.offset)))
    is(range.end, bytes(css.slice(0, node.source!.end!.offset)))
    is(
      buffer.subarray(range.start, range.end).toString('utf8'),
      css.slice(node.source!.start!.offset, node.source!.end!.offset)
    )
  })

  let rootRange = index.rangeOf(root)!
  is(rootRange.start, 0)
  is(rootRange.end, bytes(css))
})

test('does not confuse char offsets with UTF-8 bytes', () => {
  let root = parse(css)
  let index = root.positionIndex

  let comment = root.first!
  is(comment.source!.start!.offset, 0)
  is(comment.source!.end!.offset, 10)
  let range = index.rangeOf(comment)!
  is(range.start, 0)
  is(range.end, 18) // 中文注释 are 3 bytes each in UTF-8

  is(index.find(range.start)!.node, comment)
  is(index.find(range.end - 1)!.node, comment)
  is(index.find(range.end)!.node.type, 'root')
})

test('treats ranges as left-closed right-open', () => {
  let root = parse(css)
  let index = root.positionIndex

  let rule = root.first!.next() as postcss.Rule
  let decl = rule.first!
  let range = index.rangeOf(decl)!

  is(index.find(range.start)!.node, decl)
  is(index.find(range.end - 1)!.node, decl)
  // The byte right after the declaration (`;`) belongs to the parent rule
  is(index.find(range.end)!.node, decl.parent)

  let ruleRange = index.rangeOf(rule)!
  is(index.find(ruleRange.start)!.node, rule)
  is(index.find(ruleRange.end)!.node, rule.parent)
})

test('resolves whitespace and comments by real source positions', () => {
  let root = parse(css)
  let index = root.positionIndex

  // CRLF between top-level nodes belongs to the root
  let crlf = byteOf('\r\n')
  is(index.find(crlf)!.node, root) // \r
  is(index.find(crlf + 1)!.node, root) // \n

  // Indentation before a declaration belongs to the parent rule
  let rule = root.first!.next() as postcss.Rule
  is(index.find(byteOf('  color'))!.node, rule)

  // Space between declaration and comment belongs to the parent rule
  is(index.find(byteOf(' /* 尾注 */'))!.node, rule)

  // Every byte inside a comment resolves to the comment node
  let comment = rule.nodes.find(i => i.type === 'comment')!
  let commentRange = index.rangeOf(comment)!
  for (let offset = commentRange.start; offset < commentRange.end; offset++) {
    is(index.find(offset)!.node, comment)
  }
})

test('handles end of file and negative offsets', () => {
  let root = parse(css)
  let index = root.positionIndex
  let total = bytes(css)

  type(index.find(total), 'undefined')
  type(index.find(total + 100), 'undefined')
  type(index.find(-1), 'undefined')
  type(index.find(Number.NaN), 'undefined')

  // Last byte (final \n) is still inside the root range
  is(index.find(total - 1)!.node, root)
})

test('returns undefined for roots without source', () => {
  let root = new Root()
  type(root.positionIndex.find(0), 'undefined')
})

test('marks index stale after tree mutation and rebuilds', () => {
  let root = parse(css)
  let index = root.positionIndex
  is(index.stale, false)

  let commentOffset = byteOf('中文')
  is(index.find(commentOffset)!.node.type, 'comment')

  root.first!.remove()
  is(index.stale, true)

  let rebuilt = root.positionIndex
  is(rebuilt === index, false)
  is(rebuilt.stale, false)

  // The comment is gone: its position now resolves to the root
  is(rebuilt.find(commentOffset)!.node, root)

  // Structural changes through Container API are tracked too
  let rule = root.first as postcss.Rule
  let declOffset = byteOf('color')
  is(rebuilt.find(declOffset)!.node.type, 'decl')
  rule.removeAll()
  let rebuilt2 = root.positionIndex
  is(rebuilt2.find(declOffset)!.node, rule)
})

test('finds nodes appended from another parse', () => {
  let root = parse(css)
  let other = parse('.c { top: 0 }')
  let otherInput = other.source!.input
  root.append(other.first)
  let index = root.positionIndex
  is(index.stale, false)
  let found = index.find(byteOfIn('.c { top: 0 }', '.c'), otherInput)!
  is(found.node.type, 'rule')
  is((found.node as postcss.Rule).selector, '.c')
})

test('supports multiple input sources', () => {
  let cssA = '.a { color: red }'
  let cssB = '/* 注释 */ .b { top: 0 }'
  let rootA = parse(cssA, { from: 'a.css' })
  let rootB = parse(cssB, { from: 'b.css' })
  let inputB = rootB.source!.input

  rootA.append(rootB.nodes)
  let index = rootA.positionIndex
  equal(index.inputs.length, 2)

  // Default input is the root’s own input
  let fromA = index.find(byteOfIn(cssA, 'color'))!
  is(fromA.node.type, 'decl')

  // Explicit input finds nodes from the second source
  let commentB = index.find(byteOfIn(cssB, '注释'), inputB)!
  is(commentB.node.type, 'comment')
  equal(
    commentB.parents.map(i => i.type),
    ['root']
  )

  let ruleB = index.find(byteOfIn(cssB, '.b'), inputB)!
  is((ruleB.node as postcss.Rule).selector, '.b')
  is(index.rangeOf(ruleB.node)!.start, byteOfIn(cssB, '.b'))

  // Byte offsets are per-input: same offset means different nodes
  let inA = index.find(0)!
  let inB = index.find(0, inputB)!
  is(inA.node.type, 'rule')
  is(inB.node.type, 'comment')
})

test.run()
