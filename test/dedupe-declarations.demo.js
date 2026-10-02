'use strict'

/* eslint-disable no-console */
// Short entry point: prints CSS before and after the optional
// dedupe-declarations cleanup plugin.
//
// Run: node test/dedupe-declarations.demo.js

let postcss = require('../lib/postcss')

let css =
  '/* fixture */\r\n' +
  'a {\r\n' +
  '  display: -webkit-box;\r\n' +
  '  display: flex;\r\n' +
  '  display: flex;\r\n' +
  '  --Tone: 1;\r\n' +
  '  --tone: 1;\r\n' +
  '  color: red;\r\n' +
  '  color: red !important;\r\n' +
  '}\r\n' +
  '@supports (display: flex) {\r\n' +
  '  a { display: flex; display: flex }\r\n' +
  '}\r\n'

let result = postcss([postcss.dedupeDeclarations()]).process(css, {
  from: undefined
}).css

console.log('--- before ---')
console.log(css)
console.log('--- after ---')
console.log(result)
