import { test } from 'uvu'
import { equal, is, throws } from 'uvu/assert'

import postcss, { valueList } from '../lib/postcss.js'
import * as valueListModule from '../lib/value-list.js'

test('splits the three-item example and keeps byte ranges', () => {
  let value = 'linear-gradient(a,b),url("x,y"),red'
  let items = valueList.parse(value)

  equal(items.map(i => i.text), [
    'linear-gradient(a,b)',
    'url("x,y")',
    'red'
  ])
  is(items.length, 3)

  is(value.slice(items[0].start, items[0].end), 'linear-gradient(a,b)')
  is(value.slice(items[1].start, items[1].end), 'url("x,y")')
  is(value.slice(items[2].start, items[2].end), 'red')

  is(items[0].start, 0)
  is(items[0].end, 20)
  is(items[1].start, 21)
  is(items[1].end, 31)
  is(items[2].start, 32)
  is(items[2].end, 35)
})

test('does not split commas inside functions', () => {
  equal(valueList.parse('f(a,b), g(1,2)').map(i => i.text), [
    'f(a,b)',
    'g(1,2)'
  ])
})

test('does not split commas inside nested parentheses', () => {
  equal(valueList.parse('a(b(c,d)), e').map(i => i.text), [
    'a(b(c,d))',
    'e'
  ])
})

test('does not split commas inside square brackets', () => {
  equal(valueList.parse('[a,b], c').map(i => i.text), ['[a,b]', 'c'])
})

test('does not split commas inside double quotes', () => {
  equal(valueList.parse('"a,b", c').map(i => i.text), ['"a,b"', 'c'])
})

test('does not split commas inside single quotes', () => {
  equal(valueList.parse("'a,b', c").map(i => i.text), ["'a,b'", 'c'])
})

test('does not split commas inside comments', () => {
  equal(valueList.parse('/* a,b */, c').map(i => i.text), ['/* a,b */', 'c'])
})

test('does not split commas inside unquoted url()', () => {
  equal(valueList.parse('url(a,b), c').map(i => i.text), ['url(a,b)', 'c'])
})

test('does not split a comment that contains a quote', () => {
  equal(valueList.parse('/* " */, c').map(i => i.text), ['/* " */', 'c'])
})

test('does not start a comment inside a string', () => {
  equal(valueList.parse('"/*", c').map(i => i.text), ['"/*"', 'c'])
})

test('keeps a trailing empty item', () => {
  equal(valueList.parse('a,b,').map(i => i.text), ['a', 'b', ''])
})

test('keeps escaped commas', () => {
  let items = valueList.parse('a\\, b, c')
  equal(items.map(i => i.text), ['a\\, b', 'c'])
  is(items[0].text, 'a\\, b')
})

test('keeps escaped commas inside strings', () => {
  equal(valueList.parse('"a\\",b", c').map(i => i.text), ['"a\\",b"', 'c'])
})

test('trims surrounding whitespace but keeps its range', () => {
  let value = ' a , b '
  let items = valueList.parse(value)
  equal(items.map(i => i.text), ['a', 'b'])
  is(value.slice(items[0].start, items[0].end), 'a')
  is(value.slice(items[1].start, items[1].end), 'b')
})

test('keeps empty items', () => {
  equal(valueList.parse('a,,b').map(i => i.text), ['a', '', 'b'])
  equal(valueList.parse('').map(i => i.text), [''])
  equal(valueList.parse(',').map(i => i.text), ['', ''])
})

test('replaces the third item keeping other bytes identical', () => {
  let value = 'linear-gradient(a,b),url("x,y"),red'
  let result = valueList.replace(value, 2, 'blue')
  is(result, 'linear-gradient(a,b),url("x,y"),blue')

  let before = valueList.parse(value)
  let after = valueList.parse(result)
  is(after[0].start, before[0].start)
  is(after[0].end, before[0].end)
  is(after[1].start, before[1].start)
  is(after[1].end, before[1].end)
  is(result.slice(0, before[0].end), value.slice(0, before[0].end))
  is(
    result.slice(before[1].start, before[1].end),
    value.slice(before[1].start, before[1].end)
  )
})

test('replaces the first item keeping other bytes identical', () => {
  let value = 'linear-gradient(a,b),url("x,y"),red'
  let result = valueList.replace(value, 0, 'blue')
  is(result, 'blue,url("x,y"),red')
})

test('replaces a middle item preserving whitespace', () => {
  let value = 'a , b , c'
  let result = valueList.replace(value, 1, 'x')
  is(result, 'a , x , c')
})

test('throws on out of range index', () => {
  throws(() => valueList.replace('a,b', 5, 'x'), /out of range/)
  throws(() => valueList.replace('a,b', -1, 'x'), /out of range/)
})

test('throws on non-string input', () => {
  // @ts-expect-error Testing invalid API
  throws(() => valueList.parse(undefined), /expects a string/)
  // @ts-expect-error Testing invalid API
  throws(() => valueList.replace(null, 0, 'x'), /expects a string/)
})

test('locates the start of an unclosed double quote', () => {
  let error: any
  try {
    valueList.parse('a,"bc')
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed string')
  is(error.offset, 2)
  is(error.line, 1)
  is(error.column, 3)
})

test('locates the start of an unclosed single quote', () => {
  let error: any
  try {
    valueList.parse("ab'c")
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed string')
  is(error.offset, 2)
})

test('locates the start of an unclosed comment', () => {
  let error: any
  try {
    valueList.parse('a/* bc')
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed comment')
  is(error.offset, 1)
})

test('locates the start of an unclosed function', () => {
  let error: any
  try {
    valueList.parse('a(b,c')
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed bracket')
  is(error.offset, 1)
})

test('locates the start of an unclosed nested bracket', () => {
  let error: any
  try {
    valueList.parse('a(b(c)')
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed bracket')
  is(error.offset, 1)
})

test('locates a mismatched closing bracket', () => {
  let error: any
  try {
    valueList.parse('a)b')
  } catch (e) {
    error = e
  }
  is(error.reason, 'Unclosed bracket')
  is(error.offset, 1)
})

test('does not deliver a partial list on unclosed structure', () => {
  let seen = false
  try {
    valueList.parse('a,"b')
  } catch {
    seen = true
  }
  is(seen, true)
})

test('reads items from a declaration without touching source', () => {
  let root = postcss.parse('a { background: linear-gradient(a,b), red }')
  let decl = (root.first as postcss.Rule).first as postcss.Declaration
  let sourceBefore = decl.source
  let items = valueList.read(decl)
  equal(items.map(i => i.text), ['linear-gradient(a,b)', 'red'])
  is(decl.source, sourceBefore)
  is(decl.value, 'linear-gradient(a,b), red')
})

test('replace on a declaration value keeps source untouched', () => {
  let root = postcss.parse('a { color: red, blue }')
  let decl = (root.first as postcss.Rule).first as postcss.Declaration
  let sourceBefore = decl.source
  decl.value = valueList.replace(decl.value, 0, 'green')
  is(decl.value, 'green, blue')
  is(decl.source, sourceBefore)
})

test('module is exposed on postcss main entry', () => {
  is((postcss as any).valueList, valueListModule)
  is(valueList, valueListModule)
})

test.run()
