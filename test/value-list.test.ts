import { test } from 'uvu'
import { equal, instance, is, ok, throws } from 'uvu/assert'

import postcss from '../lib/postcss.js'
import valueList from '../lib/value-list.js'

test('splits three items and keeps source ranges', () => {
  let value = 'linear-gradient(a,b),url("x,y"),red'
  let items = valueList.parse(value)
  is(items.length, 3)
  equal(
    items.map(i => i.value),
    ['linear-gradient(a,b)', 'url("x,y")', 'red']
  )
  equal(
    items.map(i => value.slice(i.start, i.end)),
    items.map(i => i.value)
  )
})

test('replacing third item keeps first two items byte-identical', () => {
  let value = 'linear-gradient(a,b),url("x,y"),red'
  let next = valueList.replace(value, 2, 'blue')
  is(next, 'linear-gradient(a,b),url("x,y"),blue')
  is(next.slice(0, 32), value.slice(0, 32))
  equal(valueList.parse(next).map(i => i.value), [
    'linear-gradient(a,b)',
    'url("x,y")',
    'blue'
  ])
})

test('does not split commas inside strings, comments and brackets', () => {
  let items = valueList.parse('a, /* x,y */ f(g(1,2), "u,v"), b')
  equal(
    items.map(i => i.value),
    ['a', ' /* x,y */ f(g(1,2), "u,v")', ' b']
  )
})

test('keeps escaped commas inside an item', () => {
  let items = valueList.parse('a\\,b,c')
  equal(
    items.map(i => i.value),
    ['a\\,b', 'c']
  )
})

test('keeps escaped quotes inside strings', () => {
  let items = valueList.parse('"a\\",b",c')
  equal(
    items.map(i => i.value),
    ['"a\\",b"', 'c']
  )
})

test('locates unclosed quote at its start', () => {
  let error: any
  try {
    valueList.parse('red,"unclosed')
  } catch (e) {
    error = e
  }
  instance(error, valueList.ValueListSyntaxError)
  is(error.reason, 'Unclosed quote')
  is(error.pos, 4)
})

test('locates unclosed comment at its start', () => {
  let error: any
  try {
    valueList.parse('a, /* x')
  } catch (e) {
    error = e
  }
  instance(error, valueList.ValueListSyntaxError)
  is(error.reason, 'Unclosed comment')
  is(error.pos, 3)
})

test('locates unclosed bracket at its start and delivers no partial list', () => {
  let error: any
  try {
    valueList.parse('a,f(b,c')
  } catch (e) {
    error = e
  }
  instance(error, valueList.ValueListSyntaxError)
  is(error.reason, 'Unclosed function bracket')
  is(error.pos, 3)
  throws(() => valueList.replace('a,f(b,c', 0, 'x'), /Unclosed/)
})

test('replace() checks index range', () => {
  throws(() => valueList.replace('a,b', 2, 'x'), RangeError)
  throws(() => valueList.replace('a,b', -1, 'x'), RangeError)
})

test('parse() tolerates non-string input', () => {
  // @ts-expect-error testing runtime guard
  equal(valueList.parse(undefined), [])
})

test('replaceInDecl() changes only decl.value, not source meta', () => {
  let root = postcss.parse(
    'a{background:linear-gradient(a,b),url("x,y"),red}'
  )
  let decl = root.first!.first as postcss.Declaration
  let sourceBefore = decl.source
  let rawsBefore = decl.raws
  let result = valueList.replaceInDecl(decl, 2, 'blue')
  ok(result === decl)
  is(decl.value, 'linear-gradient(a,b),url("x,y"),blue')
  ok(decl.source === sourceBefore)
  ok(decl.raws === rawsBefore)
  is(root.toString(), 'a{background:linear-gradient(a,b),url("x,y"),blue}')
})

test.run()
