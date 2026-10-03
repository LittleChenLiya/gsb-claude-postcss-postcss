import { test } from 'uvu'
import { is, ok } from 'uvu/assert'

import dedupe from '../lib/dedupe.js'
import postcss from '../lib/postcss.js'

async function run(css: string): Promise<string> {
  let result = await postcss([dedupe()]).process(css, { from: undefined })
  return result.css
}

test('removes only truly duplicate declarations', async () => {
  let css = '.a {\n  display: flex;\n  display: flex;\n}\n'
  is(await run(css), '.a {\n  display: flex;\n}\n')
})

test('keeps different fallback values', async () => {
  let css =
    '.a {\n  display: -webkit-box;\n  display: flex;\n  display: flex;\n}\n'
  let out = await run(css)
  ok(out.includes('display: -webkit-box'))
  ok(out.includes('display: flex'))
  is(out.match(/display: flex/g)?.length, 1)
})

test('compares property names by CSS rules', async () => {
  let css = '.a {\n  Color: red;\n  color: red;\n}\n'
  is(await run(css), '.a {\n  Color: red;\n}\n')
})

test('keeps custom property case', async () => {
  let css = '.a {\n  --Tone: red;\n  --tone: blue;\n}\n'
  let out = await run(css)
  ok(out.includes('--Tone: red'))
  ok(out.includes('--tone: blue'))
})

test('separates important and normal declarations', async () => {
  let css =
    '.a {\n  color: red !important;\n  color: red;\n  color: red;\n}\n'
  let out = await run(css)
  ok(out.includes('color: red !important'))
  is(out.match(/color: red/g)?.length, 2)
})

test('does not merge different values', async () => {
  let css = '.a {\n  margin: 0;\n  margin: 10px;\n}\n'
  let out = await run(css)
  ok(out.includes('margin: 0'))
  ok(out.includes('margin: 10px'))
})

test('re-groups declarations for each rule', async () => {
  let css = '.a { color: red; }\n.b { color: red; }\n'
  let out = await run(css)
  ok(out.includes('.a { color: red; }'))
  ok(out.includes('.b { color: red; }'))
})

test('re-groups declarations inside @supports', async () => {
  let css =
    '@supports (display: grid) {\n  .a { color: red; color: red; }\n}\n'
  let out = await run(css)
  is(out, '@supports (display: grid) {\n  .a { color: red; }\n}\n')
})

test('re-groups declarations in nested @supports', async () => {
  let css =
    '@supports (display: grid) {\n' +
    '  @supports (color: red) {\n' +
    '    .a { color: red; color: red; }\n' +
    '  }\n' +
    '  .b { color: red; color: red; }\n' +
    '}\n'
  let out = await run(css)
  ok(out.includes('.a { color: red; }'))
  ok(out.includes('.b { color: red; }'))
  is(out.match(/color: red;/g)?.length, 2)
})

test('preserves associated comments', async () => {
  let css =
    '.a {\n  color: red;\n  /* keep me */\n  color: red;\n}\n'
  let out = await run(css)
  ok(out.includes('/* keep me */'))
  is(out.match(/color: red/g)?.length, 1)
})

test('preserves trailing comments of the removed declaration', async () => {
  let css =
    '.a {\n  color: red;\n  color: red; /* trailing */\n}\n'
  let out = await run(css)
  ok(out.includes('/* trailing */'))
})

test('preserves remaining nodes raws', async () => {
  let css = '.a { color: red; color: red; }\n'
  let out = await run(css)
  is(out, '.a { color: red; }\n')
})

test('preserves CRLF line endings', async () => {
  let css = '.a {\r\n  color: red;\r\n  color: red;\r\n}\r\n'
  let out = await run(css)
  is(out, '.a {\r\n  color: red;\r\n}\r\n')
})

test('is idempotent', async () => {
  let css =
    '@supports (display: grid) {\n' +
    '  @supports (color: red) {\n' +
    '    .a {\n' +
    '      display: -webkit-box;\n' +
    '      display: flex;\n' +
    '      display: flex;\n' +
    '      --Tone: red;\n' +
    '      --tone: blue;\n' +
    '      color: red !important;\n' +
    '      color: red;\n' +
    '      color: red;\n' +
    '    }\n' +
    '  }\n' +
    '}\n'
  let first = await run(css)
  let second = await run(first)
  is(first, second)
})

test('does not enable itself by default', async () => {
  let css = '.a {\n  color: red;\n  color: red;\n}\n'
  let result = await postcss([]).process(css, { from: undefined })
  is(result.css, css)
})

test('exposes the plugin export', () => {
  is(typeof dedupe, 'function')
  is(dedupe.postcss, true)
  let plugin = dedupe()
  is(plugin.postcssPlugin, 'postcss-dedupe')
  is(typeof plugin.Rule, 'function')
})

test('keeps the first occurrence', async () => {
  let css = '.a {\n  color: red;\n  color: blue;\n  color: red;\n}\n'
  let out = await run(css)
  is(out, '.a {\n  color: red;\n  color: blue;\n}\n')
})

test('works with var() and other functions', async () => {
  let css =
    ':root {\n  --x: 1;\n  color: var(--x);\n  color: var(--x);\n}\n'
  let out = await run(css)
  is(out, ':root {\n  --x: 1;\n  color: var(--x);\n}\n')
})

test('handles empty rules', async () => {
  let css = '.a {}\n.b {\n  color: red;\n  color: red;\n}\n'
  let out = await run(css)
  is(out, '.a {}\n.b {\n  color: red;\n}\n')
})

test('handles multiple rules with duplicates', async () => {
  let css =
    '.a { color: red; color: red; }\n' +
    '.b { color: blue; color: blue; }\n'
  let out = await run(css)
  is(out, '.a { color: red; }\n.b { color: blue; }\n')
})

test.run()
