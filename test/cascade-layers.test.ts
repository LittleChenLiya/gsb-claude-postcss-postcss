import { test } from 'uvu'
import { equal, is, ok } from 'uvu/assert'

import analyzeCascadeLayers = require('../lib/cascade-layers.js')
import { decl, document, parse, root, rule } from '../lib/postcss.js'

function orderIds(order: analyzeCascadeLayers.CascadeLayer[]): string[] {
  return order.map(layer => (layer.unlayered ? '<unlayered>' : String(layer.id)))
}

function layerIds(result: analyzeCascadeLayers.CascadeLayerAnalysis): string[] {
  return result.layers.map(layer => String(layer.id))
}

let scenario = [
  '@layer reset, theme;',
  '@layer theme {',
  '  @layer base { .b { color: red } }',
  '  @layer components { .c { color: blue } }',
  '}',
  '@layer { .a1 { color: green } }',
  '.u { color: black }',
  '@layer { .a2 { color: gray } }'
].join('\n')

test('orders layers by first occurrence, unlayered last in normal order', () => {
  let result = analyzeCascadeLayers(parse(scenario, { from: 'main.css' }))
  equal(orderIds(result.normalOrder), [
    'reset',
    'theme',
    'theme.base',
    'theme.components',
    '#anonymous-1',
    '#anonymous-2',
    '<unlayered>'
  ])
})

test('reverses layer order for important, unlayered first', () => {
  let result = analyzeCascadeLayers(parse(scenario, { from: 'main.css' }))
  equal(orderIds(result.importantOrder), [
    '<unlayered>',
    '#anonymous-2',
    '#anonymous-1',
    'theme.components',
    'theme.base',
    'theme',
    'reset'
  ])
})

test('tracks first occurrence positions of layers and unlayered styles', () => {
  let result = analyzeCascadeLayers(parse(scenario, { from: 'main.css' }))
  let byId = new Map(result.layers.map(layer => [layer.id, layer]))
  is(byId.get('reset')!.firstPosition!.line, 1)
  is(byId.get('reset')!.firstPosition!.column, 1)
  is(byId.get('theme')!.firstPosition!.line, 1)
  is(byId.get('theme.base')!.firstPosition!.line, 3)
  is(byId.get('theme.base')!.firstPosition!.column, 3)
  is(byId.get('theme.components')!.firstPosition!.line, 4)
  is(byId.get('#anonymous-1')!.firstPosition!.line, 6)
  is(byId.get('#anonymous-2')!.firstPosition!.line, 8)
  is(result.unlayered.firstPosition!.line, 7)
  is(byId.get('theme.base')!.parent, 'theme')
  is(byId.get('theme')!.parent, null)
})

test('keeps first declaration order when a layer is re-declared', () => {
  let result = analyzeCascadeLayers(
    parse([
      '@layer b, a;',
      '@layer a { .x { color: red } }',
      '@layer b { .y { color: blue } }'
    ].join('\n'))
  )
  equal(layerIds(result), ['b', 'a'])
  is(result.layers[0].firstPosition!.line, 1)
  is(result.layers[1].firstPosition!.line, 1)
})

test('treats every anonymous block as a new identity', () => {
  let result = analyzeCascadeLayers(
    parse(['@layer wrap {', '  @layer { .x { color: red } }', '}', '@layer { .y { color: blue } }'].join('\n'))
  )
  equal(layerIds(result), ['wrap', '#anonymous-1', '#anonymous-2'])
  ok(result.layers[1].anonymous)
  ok(result.layers[2].anonymous)
  is(result.layers[1].parent, 'wrap')
  is(result.layers[2].parent, null)
  is(result.layers[1].name, null)
})

test('flattens dotted names and nested blocks to the same identity', () => {
  let result = analyzeCascadeLayers(
    parse(['@layer a.b { .x { color: red } }', '@layer a { @layer b { .y { color: blue } } }'].join('\n'))
  )
  equal(layerIds(result), ['a', 'a.b'])
  is(result.layers[1].firstPosition!.line, 1)
})

test('distinguishes escaped names from nested paths', () => {
  let result = analyzeCascadeLayers(
    parse(['@layer a\\.b { .x { color: red } }', '@layer a.b { .y { color: blue } }'].join('\n'))
  )
  equal(layerIds(result), ['a.b', 'a', 'a.b'])
  equal(result.layers[0].path, ['a.b'])
  is(result.layers[0].name, 'a.b')
  equal(result.layers[2].path, ['a', 'b'])
})

test('unescapes hex escapes in layer names', () => {
  let result = analyzeCascadeLayers(parse('@layer \\61 b { .x { color: red } }'))
  equal(layerIds(result), ['ab'])
})

test('ignores comments and respects strings in params', () => {
  let result = analyzeCascadeLayers(
    parse([
      '@layer /* one, two */ alpha, beta;',
      '@media screen and (min-width: 10px), (color: "a,b") {',
      '  @layer gamma { }',
      '}'
    ].join('\n'))
  )
  equal(layerIds(result), ['alpha', 'beta', 'gamma'])
  let gamma = result.layers[2]
  is(gamma.conditions.length, 1)
  is(gamma.conditions[0].params, 'screen and (min-width: 10px), (color: "a,b")')
  is(gamma.conditions[0].type, 'media')
  is(gamma.conditions[0].value, 'unknown')
  is(gamma.conditions[0].dynamic, false)
})

test('keeps nested condition context and flags dynamic conditions as unknown', () => {
  let result = analyzeCascadeLayers(
    parse([
      '@media (min-width: 100px) {',
      '  @supports (display: grid) {',
      '    @layer cond { }',
      '  }',
      '}',
      '@media (width: var(--bp)) {',
      '  @layer dyn { }',
      '}'
    ].join('\n'))
  )
  let cond = result.layers.find(layer => layer.id === 'cond')!
  equal(cond.conditions.map(condition => condition.type), ['media', 'supports'])
  equal(cond.conditions.map(condition => condition.value), ['unknown', 'unknown'])
  ok(cond.conditions.every(condition => !condition.dynamic))
  let dyn = result.layers.find(layer => layer.id === 'dyn')!
  is(dyn.conditions.length, 1)
  is(dyn.conditions[0].dynamic, true)
  is(dyn.conditions[0].value, 'unknown')
  is(result.conditions.length, 3)
})

test('resolves imports into their target layer', () => {
  let result = analyzeCascadeLayers(
    parse(['@layer reset;', '@import "theme.css" layer(theme);', '@layer local { }'].join('\n'), {
      from: 'main.css'
    }),
    {
      resolveImport(url: string) {
        if (url === 'theme.css') {
          return { css: '@layer base { } .t { color: red }', id: 'theme.css' }
        }
        return null
      }
    }
  )
  equal(layerIds(result), ['reset', 'theme', 'theme.base', 'local'])
  is(result.unlayered.present, false)
  ok(result.layers[2].firstPosition!.source!.endsWith('theme.css'))
  is(result.diagnostics.length, 0)
})

test('supports layer(name), bare layer and conditions on @import', () => {
  let result = analyzeCascadeLayers(
    parse([
      '@import url(a.css) layer(utils.base) supports(display: grid) screen;',
      '@import "b.css" layer;'
    ].join('\n'), { from: 'main.css' }),
    {
      resolveImport(url: string) {
        return { css: '@layer x { }', id: url }
      }
    }
  )
  equal(layerIds(result), ['utils', 'utils.base', 'utils.base.x', '#anonymous-1', '#anonymous-1.x'])
  let utils = result.layers[0]
  equal(utils.conditions.map(condition => condition.type), ['supports', 'media'])
  equal(utils.conditions.map(condition => condition.value), ['unknown', 'unknown'])
  ok(result.layers[3].anonymous)
})

test('keeps layer order stable across repeated imports of one layer', () => {
  let result = analyzeCascadeLayers(
    parse(['@import "one.css" layer(shared);', '@import "two.css" layer(shared);'].join('\n'), {
      from: 'main.css'
    }),
    {
      resolveImport(url: string) {
        return { css: '@layer extra-' + url.replace('.css', '') + ' { }', id: url }
      }
    }
  )
  equal(layerIds(result), ['shared', 'shared.extra-one', 'shared.extra-two'])
  is(result.layers[0].firstPosition!.line, 1)
})

test('reports circular imports with the source chain', () => {
  let files: Record<string, string> = {
    'a.css': '@import "b.css";',
    'b.css': '@import "a.css";'
  }
  let result = analyzeCascadeLayers(parse('@import "a.css";', { from: 'main.css' }), {
    resolveImport(url: string) {
      return files[url] ? { css: files[url], id: url } : null
    }
  })
  is(result.diagnostics.length, 1)
  let diagnostic = result.diagnostics[0]
  is(diagnostic.type, 'import-cycle')
  equal(diagnostic.chain.map(entry => entry.url), ['a.css', 'b.css', 'a.css'])
  ok(diagnostic.message.includes('Circular'))
})

test('reports missing resolver, failed and nested imports with chains', () => {
  let noResolver = analyzeCascadeLayers(parse('@import "x.css";', { from: 'main.css' }))
  is(noResolver.diagnostics[0].type, 'import-unresolved')
  equal(noResolver.diagnostics[0].chain.map(entry => entry.url), ['x.css'])

  let failed = analyzeCascadeLayers(parse('@import "ok.css";', { from: 'main.css' }), {
    resolveImport(url: string) {
      if (url === 'ok.css') return { css: '@import "missing.css";', id: 'ok.css' }
      return null
    }
  })
  is(failed.diagnostics.length, 1)
  is(failed.diagnostics[0].type, 'import-failed')
  equal(failed.diagnostics[0].chain.map(entry => entry.url), ['ok.css', 'missing.css'])
  ok(failed.diagnostics[0].position!.source!.endsWith('ok.css'))

  let thrown = analyzeCascadeLayers(parse('@import "boom.css";', { from: 'main.css' }), {
    resolveImport() {
      throw new Error('disk gone')
    }
  })
  is(thrown.diagnostics[0].type, 'import-failed')
  ok(thrown.diagnostics[0].message.includes('disk gone'))

  let broken = analyzeCascadeLayers(parse('@import "bad.css";', { from: 'main.css' }), {
    resolveImport(url: string) {
      return { css: 'a {', id: url }
    }
  })
  is(broken.diagnostics[0].type, 'import-failed')
  ok(broken.diagnostics[0].message.includes('Failed to parse'))
})

test('accepts a resolved Root from the import resolver', () => {
  let result = analyzeCascadeLayers(parse('@import "r.css";', { from: 'main.css' }), {
    resolveImport() {
      return { root: parse('@layer r { }') }
    }
  })
  equal(layerIds(result), ['r'])
})

test('does not mutate the analyzed root across runs', () => {
  let parsed = parse(scenario, { from: 'main.css' })
  let before = parsed.toString()
  let first = analyzeCascadeLayers(parsed)
  let second = analyzeCascadeLayers(parsed)
  is(parsed.toString(), before)
  equal(orderIds(first.normalOrder), orderIds(second.normalOrder))
  equal(orderIds(first.importantOrder), orderIds(second.importantOrder))
})

test('assigns multi-name block contents to the last name', () => {
  let result = analyzeCascadeLayers(parse('@layer first, second { .x { color: red } }'))
  equal(layerIds(result), ['first', 'second'])
})

test('marks unlayered declarations from rules and unknown at-rules', () => {
  let result = analyzeCascadeLayers(
    parse(['@font-face { font-family: "x" }', '.a { color: red }'].join('\n'))
  )
  ok(result.unlayered.present)
  is(result.unlayered.firstPosition!.line, 1)
  is(result.layers.length, 0)
})

test('handles nodes without source positions', () => {
  let node = root()
  node.append(rule({ selector: '.a' }).append(decl({ prop: 'color', value: 'red' })))
  let result = analyzeCascadeLayers(node)
  ok(result.unlayered.present)
  is(result.unlayered.firstPosition, undefined)
})

test('walks document nodes', () => {
  let doc = document()
  doc.append(parse('@layer z { }'))
  let result = analyzeCascadeLayers(doc)
  equal(layerIds(result), ['z'])
})

test('ignores imports without a url', () => {
  let result = analyzeCascadeLayers(parse('@import url();'))
  is(result.diagnostics.length, 0)
  is(result.layers.length, 0)
})


test('does not split layer names inside strings or parens', () => {
  let result = analyzeCascadeLayers(parse('@layer "a,b", foo(bar), baz, "d\\e";'))
  equal(layerIds(result), ['"a,b"', 'foo(bar)', 'baz', '"de"'])
})

test('unescapes characters inside quoted import urls', () => {
  let seen: string[] = []
  let result = analyzeCascadeLayers(
    parse('@import "a\\b.css" layer(imp);', { from: 'main.css' }),
    {
      resolveImport(url: string) {
        seen.push(url)
        return { css: '@layer inner { }', id: url }
      }
    }
  )
  equal(seen, ['ab.css'])
  equal(layerIds(result), ['imp', 'imp.inner'])
})

test('walks nested document nodes', () => {
  let inner = document()
  inner.append(parse('@layer deep { }'))
  let outer = document()
  outer.append(inner)
  let result = analyzeCascadeLayers(outer)
  equal(layerIds(result), ['deep'])
})

test.run()
