import { SourceMapConsumer } from 'source-map-js'
import { test } from 'uvu'
import { equal, is, match, not, throws, type } from 'uvu/assert'

import postcss, {
  Comment,
  CssSyntaxError,
  Declaration,
  parse,
  Root,
  Rule,
  Transaction
} from '../lib/postcss.js'

function firstDecl(root: Root): Declaration {
  return (root.first as Rule).first as Declaration
}

test('is exported and bound to a root', () => {
  let root = parse('a {}')
  let tx = root.transaction()
  is(tx instanceof Transaction, true)
  is(tx instanceof postcss.Transaction, true)
  is(tx.root, root)
  is(tx.status, 'active')
  equal(tx.ops, [])
})

test('records edits without touching the tree and applies them on commit', () => {
  let root = parse('a { color: red; margin: 0 }')
  let color = firstDecl(root)
  let tx = root.transaction()

  tx.replace(color, color.clone({ value: 'blue' }))
  tx.insertBefore(color, postcss.decl({ prop: 'color', value: '#00f' }))

  is(root.toString(), 'a { color: red; margin: 0 }')
  is(tx.ops.length, 2)

  let committed = tx.commit()
  is(committed, root)
  is(tx.status, 'committed')
  is(root.toString(), 'a { color: #00f; color: blue; margin: 0 }')
})

test('replaces color and inserts fallback with source map support', () => {
  let root = parse('a {\n  color: red;\n  background: white;\n}', {
    from: 'old.css'
  })
  let color = firstDecl(root)
  let fallback = parse('color: #f00', { from: 'fallback.css' })
    .first as Declaration
  let fallbackClone = fallback.clone()
  delete fallbackClone.raws.before

  let tx = root.transaction()
  tx.insertBefore(color, fallbackClone)
  tx.replace(color, color.clone({ value: 'var(--red, red)' }))
  tx.commit()

  is(
    root.toString(),
    'a {\n  color: #f00;\n  color: var(--red, red);\n  background: white;\n}'
  )

  let result = root.toResult({ map: { inline: false }, to: 'out.css' })
  type(result.map, 'object')
  let map = new SourceMapConsumer(result.map.toJSON())

  // Inserted fallback maps to its own source
  equal(map.originalPositionFor({ column: 2, line: 2 }), {
    column: 0,
    line: 1,
    name: null,
    source: 'fallback.css'
  })
  // Replaced declaration still maps to the old file
  equal(map.originalPositionFor({ column: 2, line: 3 }), {
    column: 2,
    line: 2,
    name: null,
    source: 'old.css'
  })
  // Untouched declaration keeps mapping to the old file
  equal(map.originalPositionFor({ column: 2, line: 4 }), {
    column: 2,
    line: 3,
    name: null,
    source: 'old.css'
  })
})

test('resolves inserts anchored at a replaced node to its replacement', () => {
  let root = parse('a { color: red; margin: 0 }')
  let color = firstDecl(root)
  let tx = root.transaction()
  tx.replace(color, color.clone({ value: 'blue' }))
  tx.insertAfter(color, postcss.decl({ prop: 'outline', value: 'none' }))
  tx.insertBefore(color, postcss.decl({ prop: 'color', value: '#00f' }))
  tx.commit()
  is(
    root.toString(),
    'a { color: #00f; color: blue; outline: none; margin: 0 }'
  )
})

test('removes nodes on commit', () => {
  let root = parse('a { one: 1; two: 2 }')
  let one = firstDecl(root)
  let tx = root.transaction()
  tx.remove(one)
  is(root.toString(), 'a { one: 1; two: 2 }')
  tx.commit()
  is(root.toString(), 'a { two: 2 }')
  type(one.parent, 'undefined')
})

test('accepts strings and arrays as inserted nodes', () => {
  let root = parse('a { color: red }')
  let color = firstDecl(root)
  let tx = root.transaction()
  tx.insertAfter(color, [
    postcss.decl({ prop: 'one', value: '1' }),
    postcss.decl({ prop: 'two', value: '2' })
  ])
  tx.insertBefore(color, 'background: white')
  tx.commit()
  is(root.toString(), 'a {background: white; color: red; one: 1; two: 2 }')
})

test('moves nodes inside the same root', () => {
  let root = parse('a { one: 1 } b { two: 2 }')
  let a = root.first as Rule
  let b = a.next() as Rule
  let one = a.first as Declaration
  let tx = root.transaction()
  tx.insertAfter(b.first as Declaration, one)
  tx.commit()
  is(root.toString(), 'a { } b { two: 2; one: 1 }')
  is(one.parent, b)
})

test('rollback keeps the original tree untouched', () => {
  let root = parse('a { /* hi */ color: red }')
  let snapshot = root.toJSON()
  let rule = root.first as Rule
  let comment = rule.first as Comment
  let tx = root.transaction()
  tx.replace(comment, postcss.comment({ text: 'yo' }))
  tx.remove(rule.last as Declaration)
  tx.rollback()
  is(tx.status, 'rolled back')
  equal(tx.ops, [])
  equal(root.toJSON(), snapshot)
  is(root.toString(), 'a { /* hi */ color: red }')
  is(comment.parent, rule)
})

test('failed commit keeps parents, raws and traversal indexes untouched', () => {
  let root = parse('a { one: 1; two: 2; three: 3 }')
  let visited: string[] = []
  let snapshot: any

  root.walkDecls(decl => {
    visited.push(decl.prop)
    if (decl.prop === 'two') {
      // Snapshot inside the traversal captures live iterator indexes
      snapshot = root.toJSON()
      let tx = root.transaction()
      tx.remove(decl.parent as Rule)
      tx.insertBefore(decl, decl.clone({ prop: 'bad', value: '0' }))
      throws(() => tx.commit(), /inside a removed or replaced subtree/)
      equal(root.toJSON(), snapshot)
    }
  })

  equal(visited, ['one', 'two', 'three'])
  is(root.toString(), 'a { one: 1; two: 2; three: 3 }')
})

test('throws locatable error on duplicate edit of the same node', () => {
  let root = parse('a {\n  color: red\n}', { from: 'dup.css' })
  let color = firstDecl(root)
  let tx = root.transaction()
  tx.replace(color, color.clone({ value: 'blue' }))
  tx.remove(color)

  let error: any
  try {
    tx.commit()
  } catch (e) {
    error = e
  }
  is(error instanceof CssSyntaxError, true)
  match(error.message, /already has a pending replace edit/)
  is(error.line, 2)
  is(error.column, 3)
  is(root.toString(), 'a {\n  color: red\n}')
})

test('throws on editing a descendant of a removed ancestor', () => {
  let root = parse('a { color: red }')
  let rule = root.first as Rule
  let color = rule.first as Declaration
  let tx = root.transaction()
  tx.remove(rule)
  tx.replace(color, color.clone({ value: 'blue' }))
  throws(() => tx.commit(), /inside a removed or replaced subtree/)
  is(color.parent, rule)
  is(rule.parent, root)
})

test('throws on detached target', () => {
  let root = parse('a { color: red }')
  let color = firstDecl(root)
  color.remove()
  let tx = root.transaction()
  tx.replace(color, color.clone())
  throws(() => tx.commit(), /not attached to the transaction root/)
})

test('throws on target from another root', () => {
  let root1 = parse('a {}')
  let root2 = parse('b {}')
  let tx = root1.transaction()
  tx.remove(root2.first as Rule)
  throws(() => tx.commit(), /not attached to the transaction root/)
})

test('throws on non-node target', () => {
  let root = parse('a {}')
  let tx = root.transaction()
  tx.remove({} as any)
  throws(() => tx.commit(), /not a PostCSS node/)
})

test('throws on moving a node from another root', () => {
  let root1 = parse('a { color: red }')
  let root2 = parse('b { margin: 0 }')
  let foreign = firstDecl(root2)
  let tx = root1.transaction()
  tx.insertBefore(firstDecl(root1), foreign)
  throws(() => tx.commit(), /from another root/)
  is(foreign.parent, root2.first)
  is(root2.toString(), 'b { margin: 0 }')
  is(root1.toString(), 'a { color: red }')
})

test('throws on inserting a node from a removed subtree', () => {
  let root = parse('a { color: red } b { margin: 0 }')
  let a = root.first as Rule
  let b = a.next() as Rule
  let color = a.first as Declaration
  let tx = root.transaction()
  tx.remove(a)
  tx.insertBefore(b.first as Declaration, color)
  throws(() => tx.commit(), /from a removed or replaced subtree/)
  is(color.parent, a)
})

test('throws on inserting relative to a removed node', () => {
  let root = parse('a { one: 1; two: 2 }')
  let one = firstDecl(root)
  let tx = root.transaction()
  tx.remove(one)
  tx.insertAfter(one, postcss.decl({ prop: 'x', value: 'y' }))
  throws(() => tx.commit(), /relative to a removed node/)
})

test('treats replacement without new nodes as removal for anchors', () => {
  let root = parse('a { one: 1; two: 2 }')
  let one = firstDecl(root)
  let tx = root.transaction()
  tx.replace(one)
  tx.insertBefore(one, postcss.decl({ prop: 'x', value: 'y' }))
  throws(() => tx.commit(), /relative to a removed node/)
})

test('commits inside plugin traversal without breaking indexes', () => {
  let visited: string[] = []
  let result = postcss([
    (root: Root) => {
      root.walkDecls('color', decl => {
        visited.push(decl.prop)
        let tx = root.transaction()
        tx.insertAfter(decl, decl.clone({ prop: 'background' }))
        tx.commit()
      })
    }
  ]).process('a { color: red; margin: 0 }', { from: undefined })

  is(result.css, 'a { color: red; background: red; margin: 0 }')
  equal(visited, ['color'])
})

test('keeps comment raws on replace and on failed commit', () => {
  let root = parse('a {\n  /* hi */\n  color: red;\n}')
  let rule = root.first as Rule
  let comment = rule.first as Comment
  is(comment.raws.before, '\n  ')
  is(comment.raws.left, ' ')

  let tx = root.transaction()
  tx.replace(comment, postcss.comment({ text: 'yo' }))
  tx.commit()
  is(root.toString(), 'a {\n  /* yo */\n  color: red;\n}')
  let inserted = rule.first as Comment
  not.equal(inserted, comment)
  is(inserted.raws.before, '\n  ')
  type(comment.parent, 'undefined')
  // Detached original keeps its own raws
  is(comment.raws.before, '\n  ')
  is(comment.raws.left, ' ')

  let tx2 = root.transaction()
  tx2.replace(inserted, postcss.comment({ text: 'bad' }))
  tx2.remove(inserted)
  throws(() => tx2.commit())
  is(inserted.parent, rule)
  equal(inserted.raws, { before: '\n  ' })
  is(root.toString(), 'a {\n  /* yo */\n  color: red;\n}')
})

test('cannot reuse committed or rolled back transaction', () => {
  let root = parse('a {}')
  let tx = root.transaction()
  tx.commit()
  throws(
    () => tx.remove(root.first as Rule),
    /cannot record remove in a committed transaction/
  )
  throws(() => tx.commit(), /cannot commit in a committed transaction/)
  throws(() => tx.rollback(), /cannot rollback in a committed transaction/)

  let tx2 = root.transaction()
  tx2.rollback()
  throws(
    () => tx2.insertBefore(root.first as Rule, 'b {}'),
    /cannot record insertBefore in a rolled back transaction/
  )
  throws(() => tx2.commit(), /cannot commit in a rolled back transaction/)
})

test.run()
