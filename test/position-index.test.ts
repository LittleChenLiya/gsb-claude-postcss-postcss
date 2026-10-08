import { test } from 'uvu'
import { equal, is, type as isType, ok, throws } from 'uvu/assert'

import {
  AtRule,
  Comment,
  Container,
  Declaration,
  parse,
  PositionIndex,
  Root,
  Rule
} from '../lib/postcss.js'

// UTF-16 code-unit offset (used by node.source) -> UTF-8 byte offset
// (used by the position index).
function b(css: string, codeUnitOffset: number): number {
  return Buffer.byteLength(css.slice(0, codeUnitOffset), 'utf8')
}

function byteLength(css: string): number {
  return Buffer.byteLength(css, 'utf8')
}

function sliceBytes(css: string, start: number, end: number): string {
  return Buffer.from(css, 'utf8').subarray(start, end).toString('utf8')
}

// Every byte position resolves to a node whose [start, end] contains it.
function assertFullyCovered(
  index: PositionIndex,
  css: string,
  input?: unknown
): void {
  let total = byteLength(css)
  for (let position = 0; position <= total; position++) {
    let match = index.find(position, input)
    ok(match, `no match at byte ${position}`)
    ok(
      position >= match!.range[0] && position <= match!.range[1],
      `position ${position} not in ${JSON.stringify(match!.range)}`
    )
  }
}

// Every indexed leaf's byte range sliced from source equals its text.
function assertLeafRanges(root: Root, index: PositionIndex): void {
  root.walk(node => {
    if (node.type !== 'decl' && node.type !== 'comment') return
    let css = node.source!.input.css
    let start = b(css, node.source!.start!.offset)
    let end = b(css, node.source!.end!.offset)
    let match = index.find(start, node.source!.input)!
    is(match.node, node, `${node.type} resolves at its own start`)
    equal(match.range, [start, end])
    equal(
      sliceBytes(css, start, end),
      css.slice(node.source!.start!.offset, node.source!.end!.offset)
    )
    is(index.find(end - 1, node.source!.input)!.node, node)
  })
}

// Construction ------------------------------------------------------------

test('exposes PositionIndex and root factories', () => {
  isType(PositionIndex, 'function')
  let root = parse('a {}')
  let index = root.createPositionIndex()
  ok(index instanceof PositionIndex)
  is(index.stale, false)

  // cached getter
  is(root.positionIndex, root.positionIndex)
  ok(root.positionIndex instanceof PositionIndex)
})

// Boundary checks with Chinese, CRLF, nesting and comments ---------------

test('maps UTF-8 bytes of Chinese + CRLF + nested rules + comments', () => {
  let css =
    '/* 顶部注释 */\r\n.菜单 {\r\n  颜色: 红; /* 内联 */\r\n}\r\n@media 屏幕 {\r\n  .嵌套 .选择器 {\r\n    宽度: 100%;\r\n  }\r\n}\r\n'
  let root = parse(css)
  let index = root.createPositionIndex()

  let topComment = root.first as Comment
  let rule = root.nodes[1] as Rule
  let decl = rule.first as Declaration
  let inline = rule.last as Comment
  let media = root.nodes[2] as AtRule
  let nested = media.first as Rule
  let nestedDecl = nested.first as Declaration

  assertFullyCovered(index, css)
  assertLeafRanges(root, index)

  // Top-level comment boundaries
  let cStart = b(css, topComment.source!.start!.offset)
  let cEnd = b(css, topComment.source!.end!.offset)
  equal(sliceBytes(css, cStart, cEnd), '/* 顶部注释 */')
  is(index.find(cStart)!.node, topComment)
  is(index.find(cEnd - 1)!.node, topComment)
  // The position right after the comment (its exclusive end) still
  // touches the comment; the following CRLF bytes are a gap -> root
  is(index.find(cEnd)!.node, topComment)
  is(index.find(cEnd + 1)!.node, root)
  // right after CRLF starts the rule
  is(index.find(cEnd + 2)!.node, rule)

  // First byte of the rule selector (.) resolves to the rule
  let rStart = b(css, rule.source!.start!.offset)
  is(index.find(rStart)!.node, rule)
  equal(index.find(rStart)!.parents, [])

  // All 3 bytes of "菜" stay inside the rule
  let menuChar = b(css, 13)
  for (let p = menuChar; p < menuChar + 3; p++) {
    is(index.find(p)!.node, rule)
  }

  // The rule opening brace and the CRLF right after it resolve to the
  // rule (the rule source spans the closing brace too)
  is(index.find(b(css, 16))!.node, rule)

  // Declaration and its exact boundaries
  let dStart = b(css, decl.source!.start!.offset)
  let dEnd = b(css, decl.source!.end!.offset)
  equal(sliceBytes(css, dStart, dEnd), '颜色: 红;')
  let dMatch = index.find(dStart)!
  is(dMatch.node, decl)
  equal(
    dMatch.parents.map((i: Container) => i.type),
    ['rule']
  )
  is(dMatch.range[0], dStart)
  is(dMatch.range[1], dEnd)
  for (let p = dStart; p < dStart + 3; p++) is(index.find(p)!.node, decl)

  // Inline comment between decl and closing brace is a real node
  let iStart = b(css, inline.source!.start!.offset)
  let iEnd = b(css, inline.source!.end!.offset)
  equal(sliceBytes(css, iStart, iEnd), '/* 内联 */')
  is(index.find(iStart)!.node, inline)
  equal(
    index.find(iStart)!.parents.map((i: Container) => i.type),
    ['rule']
  )
  // The space between the decl ";" and the inline comment is inside the
  // declaration's source range (it is part of the value's raws gap), so
  // it resolves to the declaration.
  is(index.find(iStart - 1)!.node, decl)

  // Nested at-rule chain
  let mStart = b(css, media.source!.start!.offset)
  is(index.find(mStart)!.node, media)
  let nStart = b(css, nested.source!.start!.offset)
  is(index.find(nStart)!.node, nested)
  equal(
    index.find(nStart)!.parents.map((i: Container) => i.type),
    ['atrule']
  )
  let ndStart = b(css, nestedDecl.source!.start!.offset)
  let nd = index.find(ndStart)!
  is(nd.node, nestedDecl)
  equal(
    nd.parents.map((i: Container) => i.type),
    ['atrule', 'rule']
  )

  // Nested rule closing brace resolves to the nested rule itself, both
  // on the brace byte and at its exclusive end (the CRLF after it)
  let nestedBrace = b(css, nested.source!.end!.offset - 1)
  is(index.find(nestedBrace)!.node, nested)
  let nestedEnd = b(css, nested.source!.end!.offset)
  is(index.find(nestedEnd)!.node, nested)

  // Trailing CRLF after everything resolves to root
  let total = byteLength(css)
  is(index.find(total)!.node, root)
  equal(index.find(total)!.range, [0, total])

  // start/end/range fields consistency
  let anyMatch = index.find(dStart)!
  is(anyMatch.start, anyMatch.range[0])
  is(anyMatch.end, anyMatch.range[1])
})

test('CRLF offsets are real bytes, not line/column numbers', () => {
  let css = 'a {\r\n  color: red;\r\n}\r\n'
  let root = parse(css)
  let index = root.createPositionIndex()
  let decl = (root.first as Rule).first as Declaration

  // The decl starts on line 2 column 3; its code-unit offset is 7 and
  // its UTF-8 byte offset is the actual byte count, never derived from
  // line/column numbers.
  is(decl.source!.start!.line, 2)
  is(decl.source!.start!.column, 3)
  is(decl.source!.start!.offset, 7)
  equal(index.find(b(css, 7))!.range, [b(css, 7), b(css, 18)])
  assertFullyCovered(index, css)
})

test('astral characters count as 4 UTF-8 bytes over 2 code units', () => {
  // Build with an escape to keep this file ASCII-safe: "." + U+1F600
  let css = '.😀 { content: "x" }'
  let root = parse(css)
  let index = root.createPositionIndex()
  let rule = root.first as Rule
  is(rule.source!.start!.offset, 0)
  // All four bytes of the emoji belong to the rule selector region
  for (let byte = 1; byte <= 4; byte++) {
    is(index.find(byte)!.node, rule)
  }
  // Code-unit offset 3 (after the 2-unit emoji) lands on the space,
  // which is still inside the rule
  is(index.find(b(css, 3))!.node, rule)
  assertFullyCovered(index, css)
})

test('comments folded into declaration raws use the decl source', () => {
  // A comment attached to !important is folded into the declaration's
  // raws; bytes in it resolve to the declaration via its real source
  // range rather than to a synthetic node or row/column guess.
  let css = 'a { color: red /*c*/!important }'
  let root = parse(css)
  let index = root.createPositionIndex()
  let decl = (root.first as Rule).first as Declaration
  let commentUnit = css.indexOf('/*c*/')
  let m = index.find(b(css, commentUnit + 2))!
  is(m.node, decl)
  equal(m.range, [
    b(css, decl.source!.start!.offset),
    b(css, decl.source!.end!.offset)
  ])
})

// Staleness ---------------------------------------------------------------

test('marks the index stale after Container mutations', () => {
  let root = parse('a { color: red }')
  let index = root.createPositionIndex()
  let other = parse('b { margin: 0 }')

  is(index.find(0)!.node.type, 'rule')

  root.append(other.nodes)
  is(index.stale, true)
  throws(() => index.find(0), /stale/)
})

test('rebuild indexes new nodes and keeps queries working', () => {
  let root = parse('a { color: red }', { from: 'a.css' })
  let index = root.createPositionIndex()
  let second = parse('b { margin: 0 }', { from: 'b.css' })
  root.append(second.nodes)
  throws(() => index.find(0), /stale/)

  index.rebuild()
  is(index.stale, false)

  // New node is found using its own input coordinates
  let match = index.find(0, second.source!.input)!
  is(match.node.type, 'rule')
  equal(match.range, [0, b(second.source!.input.css, 15)])
  equal(match.parents, [])

  // Old node still resolves
  is(index.find(0, root.source!.input)!.node.type, 'rule')
})

test('tracks prepend, insertBefore/After, remove and removeAll', () => {
  // Extra nodes sharing one input so coordinates stay comparable.
  let extra = parse('b{y:2} c{z:3} d{w:4}')
  let bNode = extra.nodes[0]
  let cNode = extra.nodes[1]
  let dNode = extra.nodes[2]

  let root = parse('a{x:1}')
  let index = root.createPositionIndex()

  root.prepend(bNode)
  is(index.stale, true)
  index.rebuild()
  is(index.find(0, extra.source!.input)!.node.type, 'rule')

  root.first!.after(cNode)
  is(index.stale, true)
  index.rebuild()

  root.last!.remove() // removes a{x:1}
  is(index.stale, true)
  index.rebuild()

  let coords = extra.source!.input
  let match = index.find(
    b(coords.css, bNode.source!.start!.offset),
    coords
  )!
  is(match.node, bNode)

  // Insert one more, then remove it
  root.append(dNode)
  is(index.stale, true)
  index.rebuild()
  dNode.remove()
  is(index.stale, true)
  index.rebuild()
  is(index.inputs.has(coords), true)

  root.removeAll()
  is(index.stale, true)
  index.rebuild()
  // Only the original root input remains
  is(index.find(0, root.source!.input)!.node, root)
})

test('cached positionIndex rebuilds itself after mutation', () => {
  let root = parse('a{x:1}')
  let first = root.positionIndex
  is(root.positionIndex, first)

  let added = parse('b{y:2}')
  let newRule = added.first as Rule
  root.append(added.nodes)
  is(first.stale, true)

  // The same cached instance is rebuilt in place, keeping its registration
  is(root.positionIndex, first)
  is(first.stale, false)

  // After the rebuild the appended node is found in its own input
  is(first.find(0, added.source!.input)!.node, newRule)
})

test('string-appended nodes without sources stay absent', () => {
  let root = parse('x { a: b }')
  let index = root.createPositionIndex()
  root.append('y{c:d}') // strings are parsed and sources are stripped
  is(index.stale, true)
  index.rebuild()

  // Existing source ranges still work
  is(index.find(0)!.node.type, 'rule')
})

// Edge positions ----------------------------------------------------------

test('handles the position at the end of file', () => {
  let root = parse('x{}')
  let index = root.createPositionIndex()
  let match = index.find(3)!
  is(match.node.type, 'rule')
  equal(match.range, [0, 3])

  // Trailing whitespace after the last node resolves up to EOF -> root
  let withGap = parse('x{}  \n')
  let gapIndex = withGap.createPositionIndex()
  let eof = byteLength('x{}  \n')
  is(gapIndex.find(eof)!.node, withGap)
  // whitespace just after the rule "}" is a gap -> root
  is(gapIndex.find(3)!.node.type, 'rule')
  is(gapIndex.find(4)!.node, withGap)
})

test('handles empty input', () => {
  let root = parse('')
  let index = root.createPositionIndex()
  let match = index.find(0)!
  is(match.node, root)
  equal(match.range, [0, 0])
  throws(() => index.find(1), /after the end/)
})

test('rejects negative, fractional and beyond-EOF positions', () => {
  let root = parse('x{}')
  let index = root.createPositionIndex()
  throws(() => index.find(-1), /not be negative/)
  throws(() => index.find(4), /after the end/)
  throws(() => index.find(1.5), /integer/)
  throws(() => index.find(Number.NaN), /integer/)
})

test('releases the index from mutation tracking', () => {
  let root = parse('a{}')
  let index = root.createPositionIndex()
  index.release()
  root.append(parse('b{}').nodes)
  is(index.stale, false)
})

// Multiple inputs ---------------------------------------------------------

test('requires an input selector for multi-input trees', () => {
  let a = parse('a { color: red }', { from: 'a.css' })
  let bRoot = parse('b { margin: 0 }', { from: 'b.css' })
  let bInput = bRoot.source!.input
  a.append(bRoot.nodes)
  let index = a.createPositionIndex()

  throws(() => index.find(0), /multiple inputs/)
  throws(() => index.find(0, 'c.css'), /multiple inputs/)

  let fromA = index.find(0, a.source!.input)!
  is(fromA.node.type, 'rule')
  is(fromA.input, a.source!.input)

  // Select the second input by its resolved absolute file path
  let fromB = index.find(0, bInput.file)!
  is(fromB.node.type, 'rule')
  is(fromB.input, bInput)

  // ...and by the Input instance itself
  let byInstance = index.find(3, bInput)!
  is(byInstance.node.type, 'rule')
  is(byInstance.input, bInput)
})

test('parent chain in multi-input trees stops at the shared root', () => {
  let a = parse('@media screen { a { color: red } }', { from: 'a.css' })
  let bRoot = parse('b { margin: 0 }', { from: 'b.css' })
  a.append(bRoot.nodes)
  let index = a.createPositionIndex()

  // Nested decl from the first input reports full chain
  let inner = a.first as AtRule
  let decl = (inner.first as Rule).first as Declaration
  let start = b(a.source!.input.css, decl.source!.start!.offset)
  let match = index.find(start, a.source!.input)!
  is(match.node, decl)
  equal(
    match.parents.map((i: Container) => i.type),
    ['atrule', 'rule']
  )
})

// Encoding edge cases -----------------------------------------------------

test('unpaired surrogates are encoded as the 3-byte replacement char', () => {
  let low = 'a { b: "\uDC00" }'
  let lowRoot = parse(low)
  let lowIndex = lowRoot.createPositionIndex()
  assertFullyCovered(lowIndex, low)
  is(byteLength(low), low.length + 2) // one 3-byte replacement

  let high = 'a { b: "\uD800" }'
  let highRoot = parse(high)
  let highIndex = highRoot.createPositionIndex()
  assertFullyCovered(highIndex, high)
  is(byteLength(high), high.length + 2)

  // A valid astral pair counts as 4 bytes over 2 code units, while an
  // unpaired surrogate counts as 3 bytes over 1 code unit
  let mixed = '.😀 { x: "\uD800" }'
  let mixedRoot = parse(mixed)
  let mixedIndex = mixedRoot.createPositionIndex()
  assertFullyCovered(mixedIndex, mixed)
  is(byteLength(mixed), mixed.length + 2 + 2) // 4 vs 2, 3 vs 1
})

// Manually built trees ----------------------------------------------------

test('nodes without a source are skipped', () => {
  let root = parse('a { color: red }')
  let manual = new Declaration({ prop: 'top', value: '0' })
  is(manual.source, undefined)
  root.append(manual)
  let index = root.createPositionIndex()
  index.rebuild()

  // Original source ranges still work
  is(index.find(0)!.node.type, 'rule')
})

test('index survives a clone and keeps the source text queryable', () => {
  let root = parse('a { color: red }')
  root.createPositionIndex()
  let clone = root.clone()
  let cloneIndex = clone.createPositionIndex()
  let match = cloneIndex.find(0)!
  is(match.node.type, 'rule')
  equal(
    sliceBytes(clone.source!.input.css, match.range[0], match.range[1]),
    'a { color: red }'
  )
})

test('covers 2-byte UTF-8 characters', () => {
  // é and ñ are encoded with 2 UTF-8 bytes but a single code unit
  let css = '.café { résumé: naïve }'
  let root = parse(css)
  let index = root.createPositionIndex()
  assertFullyCovered(index, css)
  is(byteLength(css), css.length + 4) // four 2-byte characters
  let decl = (root.first as Rule).first as Declaration
  let match = index.find(b(css, decl.source!.start!.offset))!
  is(match.node, decl)
})

test('covers every position of an all-Chinese rule end to end', () => {
  let css = '颜色: 红'
  let root = parse(css)
  let index = root.createPositionIndex()
  assertFullyCovered(index, css)
})

test('unknown input selector with a single input throws', () => {
  let root = parse('a{}')
  let index = root.createPositionIndex()
  throws(() => index.find(0, 'missing.css'), /no indexed input/)
})

test('leading whitespace resolves to the covering root', () => {
  let css = '   a{}'
  let root = parse(css)
  let index = root.createPositionIndex()
  // Positions in leading whitespace belong to the root, which covers
  // the whole input.
  is(index.find(0)!.node, root)
  is(index.find(2)!.node, root)
})

test('gaps between same-input nodes resolve to the covering root', () => {
  // Free semicolons / spaces between top-level nodes are gaps: positions
  // at a node's exclusive end still match the node, positions deeper in
  // the gap walk up to the root which covers the whole input.
  let css = 'a{}   ;   b{}'
  let root = parse(css)
  let index = root.createPositionIndex()
  let firstRule = root.first as Rule
  let endExclusive = b(css, firstRule.source!.end!.offset)
  is(index.find(endExclusive)!.node, firstRule)
  is(index.find(endExclusive + 2)!.node, root)
})

test('node with a source but missing end is skipped', () => {
  let root = parse('a { color: red }')
  let index = root.createPositionIndex()
  // Simulate a malformed/custom node that has a start but no end
  let partial = parse('b { x: 1 }').first as Rule
  partial.source!.end = undefined
  root.append(partial)
  index.rebuild()
  // The rest of the tree still works
  is(index.find(0, root.source!.input)!.node.type, 'rule')
})

test('index without a root source resolves gaps to null', () => {
  // A root without a source that only contains a rule ending before the
  // end of the input: positions inside/at the end of the rule resolve to
  // it, while positions in the trailing whitespace gap cover nothing.
  let parsed = parse('  a{}   ')
  let parsedRule = parsed.first as Rule

  let sourcelessRoot = new Root()
  sourcelessRoot.append(parsedRule)
  sourcelessRoot.source = undefined

  let index = sourcelessRoot.createPositionIndex()
  // Positions before the rule start cover nothing
  is(index.find(0), null)
  is(index.find(1), null)
  // Positions inside the rule (incl. its exclusive end byte) resolve
  is(index.find(2)!.node, parsedRule)
  is(index.find(3)!.node, parsedRule)
  is(index.find(5)!.node, parsedRule)
  // Positions in the trailing whitespace gap cover nothing -> null
  is(index.find(6), null)
  is(index.find(7), null)
  is(index.find(8), null)
})
