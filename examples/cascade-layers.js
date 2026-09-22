/* eslint-disable no-console */
// Terminal demo for lib/cascade-layers.js.
// Run with: node examples/cascade-layers.js
let analyzeCascadeLayers = require('../lib/cascade-layers.js')
let { parse } = require('../lib/postcss.js')

function formatPosition(position) {
  if (!position) return '<no source>'
  let source = position.source || '<input>'
  return source + ':' + position.line + ':' + position.column
}

function printOrder(title, order) {
  console.log(title)
  order.forEach((layer, index) => {
    let name = layer.unlayered ? '<unlayered>' : layer.id
    console.log(
      '  ' + (index + 1) + '. ' + name + '  (first seen at ' +
        formatPosition(layer.firstPosition) + ')'
    )
  })
  console.log('')
}

// 1. Local layers: statement order, nested blocks, anonymous
//    blocks and unlayered declarations mixed together.
let css = [
  '@layer reset, theme;',
  '@layer theme {',
  '  @layer base { .btn { padding: 8px } }',
  '  @layer components { .card { margin: 4px } }',
  '}',
  '@layer { .promo { color: green } }',
  '.utilities { color: black }',
  '@layer { .legacy { color: gray } }',
  '.utilities-important { color: white !important }'
].join('\n')

let analysis = analyzeCascadeLayers(parse(css, { from: 'main.css' }))
printOrder('Normal priority (low -> high):', analysis.normalOrder)
printOrder('!important priority (low -> high):', analysis.importantOrder)

// 2. Imports: a resolver maps urls to sources. one.css and two.css
//    both extend the same layer, loop.css imports itself and
//    missing.css cannot be loaded.
let files = {
  'loop.css': '@import "loop.css";',
  'one.css': '@layer shared { .one { color: red } }',
  'two.css': '@layer shared { .two { color: blue } }'
}
let withImports = analyzeCascadeLayers(
  parse(
    [
      '@import "one.css" layer(shared);',
      '@import "two.css" layer(shared);',
      '@import "loop.css";',
      '@import "missing.css" layer(late);'
    ].join('\n'),
    { from: 'main.css' }
  ),
  {
    resolveImport(url) {
      return files[url] ? { css: files[url], id: url } : null
    }
  }
)
printOrder('Normal priority with imports (low -> high):', withImports.normalOrder)

if (withImports.diagnostics.length > 0) {
  console.log('Diagnostics:')
  for (let diagnostic of withImports.diagnostics) {
    console.log(
      '  [' + diagnostic.type + '] ' + diagnostic.message +
        ' (at ' + formatPosition(diagnostic.position) + ')'
    )
    console.log(
      '    chain: ' +
        diagnostic.chain
          .map(entry => entry.url + ' @ ' + formatPosition(entry.position))
          .join(' -> ')
    )
  }
}
