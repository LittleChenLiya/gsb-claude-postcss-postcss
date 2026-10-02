import { test } from 'uvu'
import { equal, is } from 'uvu/assert'

import postcss, { dedupeDeclarations, parse } from '../lib/postcss.js'

function run(css: string): string {
  return postcss([dedupeDeclarations()]).process(css, { from: undefined }).css
}

test('is exported from postcss and marked as a plugin', () => {
  is(typeof postcss.dedupeDeclarations, 'function')
  is(typeof dedupeDeclarations, 'function')
  is(dedupeDeclarations.postcss, true)
  is(dedupeDeclarations().postcssPlugin, 'postcss-dedupe-declarations')
})

test('is not enabled by default', () => {
  let css = 'a{color:red;color:red}'
  is(postcss([]).process(css, { from: undefined }).css, css)
  is(postcss().process(css, { from: undefined }).css, css)
})

test('keeps intentional fallback pairs', () => {
  let css = 'a{display:-webkit-box;display:flex}'
  is(run(css), css)
})

test('removes only one copy of a duplicated declaration', () => {
  is(
    run('a{display:-webkit-box;display:flex;display:flex}'),
    'a{display:-webkit-box;display:flex}'
  )
  is(run('a{color:red;color:red;color:red}'), 'a{color:red}')
})

test('keeps the last occurrence to preserve cascade semantics', () => {
  is(run('a{color:red;color:blue;color:red}'), 'a{color:blue;color:red}')
})

test('compares standard property names case-insensitively', () => {
  is(run('a{COLOR:red;color:red}'), 'a{color:red}')
})

test('keeps custom properties with different casing', () => {
  let css = 'a{--Tone:1;--tone:1}'
  is(run(css), css)
  is(run('a{--tone:1;--tone:1}'), 'a{--tone:1}')
})

test('keeps declarations with different values or functions', () => {
  let css = 'a{background:RGB(1,2,3);background:rgb(1,2,3);background:rgb(1, 2, 3)}'
  is(run(css), css)
})

test('keeps important and normal declarations separate', () => {
  let css = 'a{color:red;color:red!important}'
  is(run(css), css)
  is(run('a{color:red!important;color:red!important}'), 'a{color:red!important}')
  is(run('a{color:red;color:red!important;color:red}'), 'a{color:red!important;color:red}')
})

test('regroups declarations inside nested rules and @supports', () => {
  let css =
    'a{color:red;color:red}' +
    '@supports (display:flex){' +
    'a{color:red;color:red;display:flex;display:flex}' +
    'b{color:red}' +
    '}'
  is(
    run(css),
    'a{color:red}' +
      '@supports (display:flex){' +
      'a{color:red;display:flex}' +
      'b{color:red}' +
      '}'
  )
})

test('dedupes declarations inside at-rules with declaration bodies', () => {
  is(
    run('@font-face{font-family:A;font-family:A;src:url(a)}'),
    '@font-face{font-family:A;src:url(a)}'
  )
})

test('keeps comments and raws of remaining nodes', () => {
  let css = 'a{/* keep */color:red;color:red;/* tail */color:blue}'
  is(run(css), 'a{/* keep */color:red;/* tail */color:blue}')
})

test('serializes CRLF fixture with comments and nested @supports identically on re-run', () => {
  let css =
    '/* header */\r\n' +
    'a {\r\n' +
    '  display: -webkit-box;\r\n' +
    '  display: flex; /* modern */\r\n' +
    '  display: flex;\r\n' +
    '  --Tone: 1;\r\n' +
    '  --tone: 1;\r\n' +
    '  color: red;\r\n' +
    '  color: red !important;\r\n' +
    '}\r\n' +
    '@supports (display: flex) {\r\n' +
    '  a {\r\n' +
    '    display: flex;\r\n' +
    '    display: flex;\r\n' +
    '  }\r\n' +
    '}\r\n'
  let expected =
    '/* header */\r\n' +
    'a {\r\n' +
    '  display: -webkit-box; /* modern */\r\n' +
    '  display: flex;\r\n' +
    '  --Tone: 1;\r\n' +
    '  --tone: 1;\r\n' +
    '  color: red;\r\n' +
    '  color: red !important;\r\n' +
    '}\r\n' +
    '@supports (display: flex) {\r\n' +
    '  a {\r\n' +
    '    display: flex;\r\n' +
    '  }\r\n' +
    '}\r\n'
  let once = run(css)
  is(once, expected)
  is(run(once), once)
  is(parse(once).toString(), once)
})

test('is idempotent on mixed duplicates', () => {
  let css = 'a{a:1;b:2;a:1;b:2;a:1;--x:1;--x:1;c:3!important;c:3!important}'
  let once = run(css)
  equal(once, 'a{b:2;a:1;--x:1;c:3!important}')
  is(run(once), once)
})

test.run()
