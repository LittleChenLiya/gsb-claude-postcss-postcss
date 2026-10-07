import { SourceMapConsumer } from 'source-map-js'
import { test } from 'uvu'
import { equal, is, match, ok, throws, type } from 'uvu/assert'

import postcss, {
  AtRule,
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

test('records operations without touching the tree', () => {
  let root = parse('a { color: red; margin: 0 }')
  let rule = root.first as Rule
  let decl = firstDecl(root)
  let margin = rule.last as Declaration
  let tx = root.transaction()
  ok(tx instanceof Transaction)
  is(tx.active, true)
  is(tx.state, 'open')

  tx.replace(decl, decl.clone({ value: 'blue' }))
  tx.insertAfter(margin, { prop: 'padding', value: '0' })

  is(root.toString(), 'a { color: red; margin: 0 }')
  is(tx.ops.length, 2)

  let result = tx.commit()
  is(result, root)
  is(root.toString(), 'a { color: blue; margin: 0; padding: 0 }')
  is(tx.active, false)
  is(tx.state, 'committed')
  is(tx.ops.length, 0)
})

test('is created by postcss.transaction and only on a root', () => {
  let root = parse('a {}')
  let tx = postcss.transaction(root)
  ok(tx instanceof Transaction)
  is(tx.root, root)

  throws(() => {
    // @ts-expect-error Testing invalid API
    postcss.transaction(root.first)
  }, /only on a Root/)
  throws(() => {
    // @ts-expect-error Testing invalid API
    new Transaction()
  }, /only on a Root/)
})

test('replaces color and inserts fallback keeping source map', () => {
  let root = parse('a {\n  color: black;\n  background: white;\n}', {
    from: 'old.css'
  })
  let color = firstDecl(root)
  let parsed = parse('color: #000', { from: 'fallbacks.css' })
  let fallback = (parsed.first as Declaration).clone()
  delete fallback.raws.before

  let tx = root.transaction()
  tx.replace(color, [fallback, color.clone({ value: 'rgba(0, 0, 0, 0.5)' })])
  tx.commit()

  is(
    root.toString(),
    'a {\n  color: #000;\n  color: rgba(0, 0, 0, 0.5);\n  background: white;\n}'
  )

  let result = root.toResult({
    map: { annotation: false, inline: false },
    to: 'new.css'
  })
  is(
    result.css,
    'a {\n  color: #000;\n  color: rgba(0, 0, 0, 0.5);\n  background: white;\n}'
  )
  let map = new SourceMapConsumer(result.map.toJSON())

  // Preserved declarations still map to the old file
  equal(map.originalPositionFor({ column: 0, line: 1 }), {
    column: 0,
    line: 1,
    name: null,
    source: 'old.css'
  })
  equal(map.originalPositionFor({ column: 2, line: 3 }), {
    column: 2,
    line: 2,
    name: null,
    source: 'old.css'
  })
  equal(map.originalPositionFor({ column: 2, line: 4 }), {
    column: 2,
    line: 3,
    name: null,
    source: 'old.css'
  })
  // Inserted fallback maps to its own source
  equal(map.originalPositionFor({ column: 2, line: 2 }), {
    column: 0,
    line: 1,
    name: null,
    source: 'fallbacks.css'
  })
})

test('rollback keeps the original tree equal to its snapshot', () => {
  let root = parse('a { color: red; /* hi */ }', { from: 'snap.css' })
  let rule = root.first as Rule
  let decl = firstDecl(root)
  let cssSnapshot = root.toString()
  let jsonSnapshot = JSON.stringify(root.toJSON())

  let tx = root.transaction()
  tx.replace(decl, decl.clone({ value: 'blue' }))
  tx.insertAfter(decl, new Declaration({ prop: 'margin', value: '0' }))
  tx.remove(rule)

  is(root.toString(), cssSnapshot)
  let result = tx.rollback()
  is(result, root)
  is(tx.active, false)
  is(tx.state, 'rolled back')

  is(root.toString(), cssSnapshot)
  is(JSON.stringify(root.toJSON()), jsonSnapshot)
  is(decl.parent, rule)
  is(rule.parent, root)
  is(decl.value, 'red')
})

test('throws locatable error on conflicting edits of the same node', () => {
  let root = parse('a { color: red }', { from: 'conflict.css' })
  let decl = firstDecl(root)
  let tx = root.transaction()
  tx.replace(decl, decl.clone({ value: 'blue' }))
  tx.remove(decl)

  let error: CssSyntaxError | undefined
  try {
    tx.commit()
  } catch (e) {
    error = e as CssSyntaxError
  }
  ok(error instanceof CssSyntaxError)
  match(
    error.message,
    /Conflicting transaction operations #1 replace and #2 remove/
  )
  match(error.message, /conflict\.css:1:5/)
  is(error.line, 1)
  is(error.column, 5)
  is((error as any).postcssNode, decl)

  // Failed commit keeps the tree untouched and the transaction open
  is(root.toString(), 'a { color: red }')
  is(decl.parent, root.first)
  is(tx.active, true)
  tx.rollback()
  is(root.toString(), 'a { color: red }')
})

test('throws error without position for conflicts on nodes without source', () => {
  let root = new Root()
  let decl = new Declaration({ prop: 'color', value: 'red' })
  root.append(new Rule({ selector: 'a' }))
  ;(root.first as Rule).append(decl)

  let tx = root.transaction()
  tx.replace(decl, decl.clone())
  tx.remove(decl)

  let error: CssSyntaxError | undefined
  try {
    tx.commit()
  } catch (e) {
    error = e as CssSyntaxError
  }
  ok(error instanceof CssSyntaxError)
  match(error.message, /Conflicting transaction operations/)
  type(error.line, 'undefined')
  is((error as any).postcssNode, decl)
  is(decl.parent, root.first)
})

test('throws when commit target was detached from the root', () => {
  let root = parse('a { color: red; margin: 0 }', { from: 'detach.css' })
  let rule = root.first as Rule
  let decl = firstDecl(root)
  let rawsSnapshot = JSON.stringify(rule.raws)

  let tx = root.transaction()
  tx.replace(decl, decl.clone({ value: 'blue' }))
  decl.remove()

  let cssAfterDetach = root.toString()
  let error: CssSyntaxError | undefined
  try {
    tx.commit()
  } catch (e) {
    error = e as CssSyntaxError
  }
  ok(error instanceof CssSyntaxError)
  match(
    error.message,
    /#1 replace target is not attached to the transaction root/
  )
  match(error.message, /detach\.css:1:5/)
  is((error as any).postcssNode, decl)

  // Parent pointers, raws and traversal indexes are untouched
  is(root.toString(), cssAfterDetach)
  is(decl.parent, undefined)
  is(JSON.stringify(rule.raws), rawsSnapshot)
  type((rule as any).indexes, 'undefined')
  let visited: string[] = []
  rule.each(child => {
    visited.push((child as Declaration).prop)
  })
  equal(visited, ['margin'])
})

test('throws when editing a descendant of a removed ancestor', () => {
  let root = parse('@media x { a { color: red } }', { from: 'tree.css' })
  let media = root.first as AtRule
  let rule = media.first as Rule
  let decl = rule.first as Declaration

  let tx = root.transaction()
  tx.remove(media)
  tx.replace(decl, decl.clone({ value: 'blue' }))

  let error: CssSyntaxError | undefined
  try {
    tx.commit()
  } catch (e) {
    error = e as CssSyntaxError
  }
  ok(error instanceof CssSyntaxError)
  match(
    error.message,
    /#2 replace targets a node inside the subtree removed by #1 remove/
  )
  match(error.message, /tree\.css:1:16/)
  is((error as any).postcssNode, decl)

  is(root.toString(), '@media x { a { color: red } }')
  is(media.parent, root)
  is(rule.parent, media)
  is(decl.parent, rule)
})

test('removes one subtree while editing another', () => {
  let root = parse('a { color: red } b { margin: 0 }')
  let ruleA = root.first as Rule
  let ruleB = root.last as Rule
  let margin = ruleB.first as Declaration

  let tx = root.transaction()
  tx.remove(ruleA)
  tx.replace(margin, margin.clone({ value: '1px' }))
  tx.commit()

  is(root.toString(), 'b { margin: 1px }')
  is(ruleA.parent, undefined)
  is(ruleB.parent, root)
})

test('throws locatable error on moving a node across roots', () => {
  let root1 = parse('a { color: red }', { from: 'one.css' })
  let root2 = parse('b { margin: 0 }', { from: 'two.css' })
  let moved = firstDecl(root2)

  let tx = root1.transaction()
  tx.insertBefore(firstDecl(root1), moved)

  let error: CssSyntaxError | undefined
  try {
    tx.commit()
  } catch (e) {
    error = e as CssSyntaxError
  }
  ok(error instanceof CssSyntaxError)
  match(error.message, /#1 insertBefore can not move a node from another root/)
  match(error.message, /two\.css:1:5/)
  is(error.file && error.file.endsWith('two.css'), true)
  is((error as any).postcssNode, moved)

  // Both trees keep their original state
  is(root1.toString(), 'a { color: red }')
  is(root2.toString(), 'b { margin: 0 }')
  is(moved.parent, root2.first)
})

test('moves nodes inside the same root', () => {
  let root = parse('a { color: red; margin: 0 }')
  let rule = root.first as Rule
  let color = firstDecl(root)
  let margin = rule.last as Declaration

  let tx = root.transaction()
  tx.insertAfter(margin, color)
  tx.commit()

  is(root.toString(), 'a { margin: 0; color: red }')
  is(color.parent, rule)
})

test('commits inside plugin traversal without breaking iteration', () => {
  let visited: string[] = []
  let plugin = (): postcss.Plugin => ({
    Declaration(decl) {
      visited.push(decl.prop)
      if (decl.prop === 'color') {
        let tx = postcss.transaction(decl.root())
        tx.insertAfter(decl, {
          prop: 'background',
          value: decl.value
        })
        tx.commit()
      }
    },
    postcssPlugin: 'tx-plugin'
  })

  let result = postcss([plugin()]).process('a { color: red; margin: 0 }', {
    from: undefined
  })
  is(result.css, 'a { color: red; background: red; margin: 0 }')
  equal(visited, ['color', 'background', 'margin'])
})

test('failed commit during traversal keeps indexes and tree', () => {
  let root = parse('a { color: red; margin: 0 }')
  let rule = root.first as Rule
  let visited: string[] = []

  rule.walkDecls(decl => {
    visited.push(decl.prop)
    if (decl.prop === 'color') {
      let tx = root.transaction()
      tx.replace(decl, decl.clone({ value: 'blue' }))
      tx.remove(decl)
      throws(() => {
        tx.commit()
      }, /Conflicting transaction operations/)
    }
  })

  equal(visited, ['color', 'margin'])
  is(root.toString(), 'a { color: red; margin: 0 }')
  equal((rule as any).indexes, {})
})

test('keeps comment raws on commit and after failed commit', () => {
  let root = parse('a { color: red }')
  let rule = root.first as Rule
  let comment = new Comment({ text: 'TODO' })
  comment.raws.before = '\n  '
  comment.raws.left = ' '
  comment.raws.right = ' '

  let tx = root.transaction()
  tx.insertAfter(firstDecl(root), comment)
  tx.commit()

  is(root.toString(), 'a { color: red\n  /* TODO */ }')
  equal(comment.raws, { before: '\n  ', left: ' ', right: ' ' })
  is(comment.parent, rule)

  let failing = root.transaction()
  failing.insertBefore(comment, new Comment({ text: 'X' }))
  failing.remove(comment)
  throws(() => {
    failing.commit()
  }, /Conflicting transaction operations/)

  equal(comment.raws, { before: '\n  ', left: ' ', right: ' ' })
  is(comment.parent, rule)
  is(root.toString(), 'a { color: red\n  /* TODO */ }')
})

test('supports shorthands, strings and arrays as inserted nodes', () => {
  let root = parse('a { color: red; margin: 0; padding: 0 }')
  let rule = root.first as Rule
  let color = firstDecl(root)
  let margin = rule.nodes[1] as Declaration
  let padding = rule.last as Declaration

  let tx = root.transaction()
  tx.insertBefore(color, { prop: 'border', value: '0' })
  tx.insertAfter(margin, 'gap: 1px')
  tx.insertAfter(padding, [new Comment({ text: 'note' })], undefined)
  tx.commit()

  is(
    root.toString(),
    'a { border: 0; color: red; margin: 0;gap: 1px; padding: 0 /* note */ }'
  )
})

test('validates inserted node descriptors before applying', () => {
  let root = parse('a { color: red }')
  let decl = firstDecl(root)

  let missed = root.transaction()
  missed.insertAfter(decl, { prop: 'margin' } as any)
  throws(() => {
    missed.commit()
  }, /Value field is missed/)
  is(root.toString(), 'a { color: red }')

  let unknown = root.transaction()
  unknown.insertAfter(decl, { foo: 'bar' } as any)
  throws(() => {
    unknown.commit()
  }, /Unknown node type in node creation/)
  is(root.toString(), 'a { color: red }')
})

test('throws on non-node targets', () => {
  let root = parse('a { color: red }')
  let tx = root.transaction()
  throws(() => {
    // @ts-expect-error Testing invalid API
    tx.remove('a')
  }, /target must be a PostCSS node/)
})

test('throws on using a closed transaction', () => {
  let root = parse('a { color: red }')
  let decl = firstDecl(root)

  let committed = root.transaction()
  committed.remove(decl)
  committed.commit()
  is(root.toString(), 'a { }')
  throws(() => {
    committed.commit()
  }, /already committed/)
  throws(() => {
    committed.rollback()
  }, /already committed/)
  throws(() => {
    committed.remove(decl)
  }, /already committed/)

  let rolledBack = root.transaction()
  rolledBack.rollback()
  throws(() => {
    rolledBack.commit()
  }, /already rolled back/)
})

test.run()
