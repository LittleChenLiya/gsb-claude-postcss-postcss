import { resolve } from 'path'
import { test } from 'uvu'
import { equal, is, match, ok } from 'uvu/assert'

import { AtRule, Declaration, parse, Root, Rule } from '../lib/postcss.js'

function normalIds(result: ReturnType<Root['analyzeLayers']>): string[] {
  return result.normal.map(entry =>
    entry.type === 'layer' ? entry.layer.id : '<unlayered>'
  )
}

function importantIds(result: ReturnType<Root['analyzeLayers']>): string[] {
  return result.important.map(entry =>
    entry.type === 'layer' ? entry.layer.id : '<unlayered>'
  )
}

test('orders layers by first appearance with unlayered last', () => {
  let root = parse(
    '@layer reset, theme;' +
      '@layer theme {' +
      '@layer base { .a { color: red } }' +
      'h1 { margin: 0 }' +
      '@layer components { .b { color: blue } }' +
      '}' +
      '@layer { .anon1 { top: 0 } }' +
      '.unlayered { color: green }' +
      '@layer { .anon2 { top: 1px } }' +
      '@layer reset { .r { padding: 0 } }',
    { from: 'main.css' }
  )
  let result = root.analyzeLayers()
  equal(normalIds(result), [
    'reset',
    'theme',
    'theme.base',
    'theme.components',
    'anonymous-1',
    'anonymous-2',
    '<unlayered>'
  ])
  equal(importantIds(result), [
    '<unlayered>',
    'anonymous-2',
    'anonymous-1',
    'theme.components',
    'theme.base',
    'theme',
    'reset'
  ])
  let theme = result.layers.find(i => i.id === 'theme')
  is(theme?.directDeclarations, 1)
  is(theme?.parent, null)
  is(result.layers.find(i => i.id === 'theme.base')?.parent, 'theme')
  is(result.unlayered?.declarations, 1)
  is(result.diagnostics.length, 0)
})

test('keeps first position and order on repeated declarations', () => {
  let root = parse('@layer b;\n@layer a;\n@layer b { .x {} }\n@layer a { }', {
    from: 'repeat.css'
  })
  let result = root.analyzeLayers()
  equal(normalIds(result), ['b', 'a'])
  let b = result.layers.find(i => i.id === 'b')
  is(b?.occurrences, 2)
  equal(b?.firstPosition, { column: 1, file: resolve('repeat.css'), line: 1 })
  equal(result.layers.find(i => i.id === 'a')?.firstPosition, {
    column: 1,
    file: resolve('repeat.css'),
    line: 2
  })
})

test('treats every anonymous layer as a new identity', () => {
  let root = parse('@layer { .a {} }@layer { .b {} }')
  let result = root.analyzeLayers()
  equal(normalIds(result), ['anonymous-1', 'anonymous-2'])
  ok(result.layers.every(i => i.anonymous))
  ok(result.layers.every(i => i.name === null && i.fullName === null))
  is(result.layers[0].occurrences, 1)
})

test('nests layers by blocks and dotted names', () => {
  let root = parse(
    '@layer a.b { .x {} }' +
      '@layer a { @layer b { .y {} } }' +
      '@layer c { @layer { .z {} } }'
  )
  let result = root.analyzeLayers()
  equal(normalIds(result), ['a', 'a.b', 'c', 'anonymous-1'])
  let ab = result.layers.find(i => i.id === 'a.b')
  is(ab?.occurrences, 2)
  is(ab?.parent, 'a')
  is(result.layers.find(i => i.id === 'anonymous-1')?.parent, 'c')
})

test('keeps parent direct declarations before nested sublayers', () => {
  let root = parse('@layer outer { p { margin: 0 } @layer inner { p { margin: 1px } } }')
  let result = root.analyzeLayers()
  equal(normalIds(result), ['outer', 'outer.inner'])
  is(result.layers[0].directDeclarations, 1)
  is(result.layers[1].directDeclarations, 1)
})

test('unescapes layer names and splits only unescaped dots', () => {
  let root = parse(
    '@layer \\31 23 { .a {} }' +
      '@layer dotted\\.name { .b {} }' +
      '@layer esc\\,aped { .c {} }' +
      '@layer bad\\0 { .d {} }' +
      '@layer huge\\ffffff { .e {} }'
  )
  let result = root.analyzeLayers()
  equal(
    result.layers.map(i => i.name),
    ['123', 'dotted.name', 'esc,aped', 'bad\ufffd', 'huge\ufffd']
  )
  ok(result.layers.every(i => i.fullName === i.name))
})

test('ignores comments in layer preludes', () => {
  let root = parse('@layer /* reset */ base, /* theme */ skin;@layer /**/ { .a {} }')
  let result = root.analyzeLayers()
  equal(normalIds(result), ['base', 'skin', 'anonymous-1'])
})

test('keeps condition context and marks unresolved as unknown', () => {
  let root = parse(
    '@media (min-width: 100px) {' +
      '@supports (display: grid) {' +
      '@layer conditional { .a { top: 0 } }' +
      '.plain { top: 1px }' +
      '}' +
      '}' +
      '@media (min-width: 100px) { @layer again { .b {} } }'
  )
  let result = root.analyzeLayers()
  equal(result.conditions, [
    { query: '(min-width: 100px)', state: 'unknown', type: 'media' },
    { query: '(display: grid)', state: 'unknown', type: 'supports' }
  ])
  let conditional = result.layers.find(i => i.id === 'conditional')
  equal(
    conditional?.conditions.map(i => i.query),
    ['(min-width: 100px)', '(display: grid)']
  )
  is(result.unlayered?.conditions.length, 2)

  let resolved = root.analyzeLayers({
    conditions: {
      '(display: grid)': false,
      'media (min-width: 100px)': true
    }
  })
  equal(resolved.conditions, [
    { query: '(min-width: 100px)', state: true, type: 'media' },
    { query: '(display: grid)', state: false, type: 'supports' }
  ])

  let byFunction = root.analyzeLayers({
    conditions: (type: string) => (type === 'media' ? true : undefined)
  })
  equal(byFunction.conditions, [
    { query: '(min-width: 100px)', state: true, type: 'media' },
    { query: '(display: grid)', state: 'unknown', type: 'supports' }
  ])
})

test('resolves imports with layers through the callback', () => {
  let files: Record<string, string> = {
    'a.css': '@layer shared { .a { top: 0 } }',
    'b.css': '@layer shared { .b { top: 1px } }@layer extra { .c { top: 2px } }'
  }
  let root = parse(
    '@import "a.css" layer(shared);' +
      '@import url("b.css") layer;' +
      '@import c.css layer(deep.nested);',
    { from: 'main.css' }
  )
  let seen: string[] = []
  let result = root.analyzeLayers({
    resolveImport(url: string, info: { from?: string }) {
      seen.push(url + ' from ' + info.from)
      if (url === 'c.css') return '@layer more { .d { top: 3px } }'
      return { css: files[url], file: url }
    }
  })
  equal(normalIds(result), [
    'shared',
    'shared.shared',
    'anonymous-1',
    'anonymous-1.shared',
    'anonymous-1.extra',
    'deep',
    'deep.nested',
    'deep.nested.more'
  ])
  is(result.layers.find(i => i.id === 'shared')?.occurrences, 1)
  is(result.layers.find(i => i.id === 'shared.shared')?.directDeclarations, 1)
  is(result.layers.find(i => i.id === 'anonymous-1.shared')?.parent, 'anonymous-1')
  match(seen[0], 'a.css from ')
  match(seen[0], 'main.css')
  is(result.diagnostics.length, 0)
})

test('accepts a Root from the import callback', () => {
  let root = parse('@import "virtual.css" layer(virtual);', { from: 'main.css' })
  let result = root.analyzeLayers({
    resolveImport: () => parse('@layer inner { .v { top: 0 } }')
  })
  equal(normalIds(result), ['virtual', 'virtual.inner'])
})

test('reports circular imports with the source chain', () => {
  let files: Record<string, string> = {
    'a.css': '@import "b.css" layer(shared); @layer a-local { .a {} }',
    'b.css': '@import "a.css"; @layer b-local { .b {} }'
  }
  let root = parse('@import "a.css" layer(imported);', { from: 'main.css' })
  let result = root.analyzeLayers({
    resolveImport: (url: string) => ({ css: files[url], file: url })
  })
  is(result.diagnostics.length, 1)
  let diagnostic = result.diagnostics[0]
  is(diagnostic.type, 'import-cycle')
  is(diagnostic.import, 'a.css')
  match(diagnostic.reason, /ircular/)
  equal(diagnostic.chain, [resolve('main.css'), 'a.css', 'b.css', 'a.css'])
  equal(normalIds(result), [
    'imported',
    'imported.shared',
    'imported.shared.b-local',
    'imported.a-local'
  ])
})

test('reports failed imports with the source chain', () => {
  let root = parse(
    '@import "missing.css" layer(gone);' +
      '@import "throws.css";' +
      '@import "broken.css";',
    { from: 'main.css' }
  )
  let result = root.analyzeLayers({
    resolveImport(url: string) {
      if (url === 'throws.css') throw new Error('disk error')
      if (url === 'broken.css') return { css: '.unclosed {', file: url }
      return null
    }
  })
  is(result.diagnostics.length, 3)
  equal(
    result.diagnostics.map(i => i.type),
    ['import-failed', 'import-failed', 'import-failed']
  )
  equal(result.diagnostics[0].chain, [resolve('main.css')])
  match(result.diagnostics[0].reason, /could not be resolved/)
  match(result.diagnostics[1].reason, /disk error/)
  match(result.diagnostics[2].reason, /Unclosed block/)
  equal(normalIds(result), ['gone'])
})

test('skips imports without resolver or url', () => {
  let root = parse('@import "x.css" layer(x);@import;@import bare.css; .a { top: 0 }')
  let without = root.analyzeLayers()
  equal(normalIds(without), ['x', '<unlayered>'])
  is(without.diagnostics.length, 0)
  let withResolver = root.analyzeLayers({ resolveImport: () => null })
  is(withResolver.diagnostics.length, 2)
})

test('records import conditions as context', () => {
  let root = parse(
    '@import "a.css" layer(a) supports(display: grid) screen and (min-width: 1px);',
    { from: 'main.css' }
  )
  let result = root.analyzeLayers({
    resolveImport: () => '.imported { top: 0 }'
  })
  equal(result.conditions, [
    { query: 'display: grid', state: 'unknown', type: 'supports' },
    { query: 'screen and (min-width: 1px)', state: 'unknown', type: 'media' }
  ])
  is(result.unlayered, undefined)
  equal(normalIds(result), ['a'])
})

test('parses import url and function edge cases', () => {
  let root = parse(
    '@import url(plain.css) layer(plain);' +
      "@import url('quoted.css') layer(quoted);" +
      '@import "x.css" supports((display: grid) and (color: red)) layer(deep);',
    { from: 'main.css' }
  )
  let urls: string[] = []
  let result = root.analyzeLayers({
    resolveImport(url: string) {
      urls.push(url)
      return '.x { top: 0 }'
    }
  })
  equal(urls, ['plain.css', 'quoted.css', 'x.css'])
  equal(normalIds(result), ['plain', 'quoted', 'deep'])
  equal(result.conditions, [
    {
      query: '(display: grid) and (color: red)',
      state: 'unknown',
      type: 'supports'
    }
  ])
})

test('tolerates unclosed import functions', () => {
  let root = parse('@import "x.css" layer(unclosed', { from: 'main.css' })
  let result = root.analyzeLayers({ resolveImport: () => '.x { top: 0 }' })
  equal(normalIds(result), ['unclosed'])
  is(result.diagnostics.length, 0)
})

test('does not mutate the AST and is repeatable', () => {
  let root = parse('@layer b, a;@layer a { .x { top: 0 } }.u { top: 1px }')
  let before = root.toString()
  let first = root.analyzeLayers()
  let second = root.analyzeLayers()
  equal(first, second)
  is(root.toString(), before)
})

test('analyzes the root from any node', () => {
  let root = parse('@layer a { .x { top: 0 } }')
  let decl = ((root.first as AtRule).first as Rule).first
  ok(decl instanceof Declaration)
  equal(normalIds(decl.analyzeLayers()), ['a'])
})

test('works on manually built trees without sources', () => {
  let root = new Root()
  let statement = new AtRule({ name: 'layer', params: '' })
  let multi = new AtRule({ name: 'layer', nodes: [], params: 'one, two' })
  multi.append(new Declaration({ prop: 'top', value: '0' }))
  let empty = new AtRule({ name: 'layer', params: '' })
  empty.nodes = []
  root.append(statement)
  root.append(multi)
  root.append(empty)
  root.append(new Declaration({ prop: 'left', value: '0' }))
  let result = root.analyzeLayers()
  equal(normalIds(result), ['one', 'two', 'anonymous-1', '<unlayered>'])
  is(result.layers[0].firstPosition, undefined)
  is(result.unlayered?.firstPosition, undefined)
  is(result.unlayered?.declarations, 2)
})

test('handles at-rules without layer semantics', () => {
  let root = parse(
    '@charset "utf-8";' +
      '/* note */' +
      '@font-face { font-family: x }' +
      '@layer a { @font-face { font-family: y } }' +
      '@layer a. { .x {} }'
  )
  let result = root.analyzeLayers()
  equal(normalIds(result), ['a', '<unlayered>'])
  is(result.layers[0].directDeclarations, 1)
  is(result.unlayered?.declarations, 1)
})

test.run()
