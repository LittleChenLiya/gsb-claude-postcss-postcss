'use strict'

/* eslint-disable no-console */
// Runnable demo: node docs/layer-analysis.example.js
let { parse } = require('../lib/postcss.js')

let files = {
  'loop-a.css': '@import "loop-b.css" layer(shared); .a { top: 0 }',
  'loop-b.css': '@import "loop-a.css"; .b { top: 1px }',
  'theme.css': [
    '@layer base { body { margin: 0 } }',
    '@layer components { .btn { padding: 4px } }'
  ].join('\n')
}

let css = [
  '@layer reset, theme;',
  '@import "theme.css" layer(theme);',
  '@layer theme { h1 { color: black } }',
  '@layer { .anon-a { top: 0 } }',
  '.unlayered { color: green }',
  '@layer { .anon-b { top: 1px } }',
  '@layer reset { .r { padding: 0 } }',
  '.important { color: red !important }',
  '@import "loop-a.css" layer(cycle);',
  '@import "missing.css" layer(missing);'
].join('\n')

let analysis = parse(css, { from: 'main.css' }).analyzeLayers({
  resolveImport(url) {
    if (!(url in files)) return null
    return { css: files[url], file: url }
  }
})

function printOrder(title, entries) {
  console.log(title)
  for (let entry of entries) {
    if (entry.type === 'unlayered') {
      let at = entry.unlayered.firstPosition
      console.log(
        '  <unlayered> (' + entry.unlayered.declarations + ' declarations,' +
        ' first at ' + at.file + ':' + at.line + ':' + at.column + ')'
      )
    } else {
      let layer = entry.layer
      let at = layer.firstPosition
      console.log(
        '  ' + layer.id + ' (first at ' +
        (at ? at.file + ':' + at.line + ':' + at.column : 'unknown') + ')'
      )
    }
  }
}

printOrder('Normal priority (lowest first):', analysis.normal)
console.log()
printOrder('Important priority (lowest first):', analysis.important)

if (analysis.diagnostics.length > 0) {
  console.log()
  console.log('Diagnostics:')
  for (let problem of analysis.diagnostics) {
    console.log(
      '  ' + problem.type + ': ' + problem.import +
      ' via ' + problem.chain.join(' -> ')
    )
    console.log('    ' + problem.reason.split('\n')[0])
  }
}
