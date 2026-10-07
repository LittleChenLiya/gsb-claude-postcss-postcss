import { test } from 'uvu'
import { equal, is, throws } from 'uvu/assert'

import { analyzeCustomProperties, parse } from '../lib/postcss.js'

test('resolves var() with fallback when variable is undefined', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b, red)',
    color: 'var(--a)'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'red')
  equal(result.variables['--a'].dependencies, [])
  equal(result.variables['--a'].references, ['--b'])
  equal(result.cycles, [])

  let color = result.declarations.find(decl => decl.prop === 'color')
  is(color?.valid, true)
  is(color?.value, 'red')
  equal(color?.dependencies, ['--a'])
})

test('resolves chain of defined variables', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b)',
    '--b': 'blue',
    color: 'var(--a)'
  })
  is(result.variables['--a'].value, 'blue')
  equal(result.variables['--a'].dependencies, ['--b'])
  is(result.declarations.find(decl => decl.prop === 'color')?.value, 'blue')
})

test('detects cycle and marks all members invalid', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b, red)',
    '--b': 'var(--a)',
    color: 'var(--a)'
  })
  equal(result.cycles, [['--a', '--b']])

  is(result.variables['--a'].cyclic, true)
  is(result.variables['--a'].valid, false)
  is(result.variables['--a'].value, null)
  equal(result.variables['--a'].cycle, ['--a', '--b'])

  is(result.variables['--b'].cyclic, true)
  is(result.variables['--b'].valid, false)
  equal(result.variables['--b'].cycle, ['--a', '--b'])

  let color = result.declarations.find(decl => decl.prop === 'color')
  is(color?.valid, false)
  is(color?.value, null)
})

test('fallback does not save variables inside a cycle', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b, red)',
    '--b': 'var(--a, blue)'
  })
  is(result.variables['--a'].valid, false)
  is(result.variables['--b'].valid, false)
  equal(result.cycles, [['--a', '--b']])
})

test('detects self-referencing variable as a cycle', () => {
  let result = analyzeCustomProperties({ '--a': 'var(--a)' })
  equal(result.cycles, [['--a']])
  is(result.variables['--a'].cyclic, true)
  is(result.variables['--a'].valid, false)
})

test('keeps variables outside of a cycle resolvable', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b)',
    '--b': 'var(--a)',
    '--c': 'var(--b, green)',
    '--d': '1px'
  })
  equal(result.cycles, [['--a', '--b']])
  is(result.variables['--c'].valid, true)
  is(result.variables['--c'].value, 'green')
  is(result.variables['--d'].valid, true)
  is(result.variables['--d'].value, '1px')
})

test('resolves nested var() inside fallback', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b, var(--c, var(--d, red)))',
    '--c': 'var(--d)',
    '--d': 'blue'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'blue')
  equal(result.variables['--a'].references, ['--b', '--c', '--d'])
  equal(result.variables['--a'].dependencies, ['--c', '--d'])
})

test('supports empty fallback', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b,)',
    color: 'x var(--a)y'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, '')
  is(result.declarations.find(decl => decl.prop === 'color')?.value, 'x y')
})

test('treats whitespace-only fallback as valid empty value', () => {
  let result = analyzeCustomProperties({ '--a': 'var(--b, )' })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, '')
})

test('undefined variable without fallback is invalid', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b)',
    color: 'var(--c)'
  })
  is(result.variables['--a'].valid, false)
  is(result.variables['--a'].value, null)
  let color = result.declarations.find(decl => decl.prop === 'color')
  is(color?.valid, false)
  is(color?.value, null)
})

test('invalid variable recovers with fallback in other declarations', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--missing)',
    color: 'var(--a, red)'
  })
  is(result.variables['--a'].valid, false)
  let color = result.declarations.find(decl => decl.prop === 'color')
  is(color?.valid, true)
  is(color?.value, 'red')
  equal(color?.dependencies, [])
})

test('ignores fake var() inside strings', () => {
  let result = analyzeCustomProperties({
    '--a': '"var(--b)"',
    content: 'var(--a)'
  })
  equal(result.variables['--a'].references, [])
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, '"var(--b)"')
  is(
    result.declarations.find(decl => decl.prop === 'content')?.value,
    '"var(--b)"'
  )
})

test('ignores fake var() inside strings with escaped quotes', () => {
  let result = analyzeCustomProperties({
    '--a': '"a\\" var(--b)"',
    '--b': 'red'
  })
  equal(result.variables['--a'].references, [])
  is(result.variables['--a'].value, '"a\\" var(--b)"')
})

test('ignores fake var() inside comments', () => {
  let result = analyzeCustomProperties({
    '--a': '/* var(--b) */ red /* var(--c',
    '--b': 'blue'
  })
  equal(result.variables['--a'].references, [])
  is(result.variables['--a'].valid, true)
})

test('ignores comments around var() arguments', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(/* comment */ --b /* x */, red)',
    '--b': 'blue'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'blue')
  equal(result.variables['--a'].dependencies, ['--b'])
})

test('keeps custom property names case-sensitive', () => {
  let result = analyzeCustomProperties({
    '--A': 'red',
    '--a': 'var(--A)',
    color: 'var(--a)'
  })
  is(result.variables['--A'].value, 'red')
  is(result.variables['--a'].value, 'red')
  equal(result.variables['--a'].dependencies, ['--A'])
})

test('does not confuse variables with different case', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--B, red)'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'red')
})

test('accepts var() function name in any case', () => {
  let result = analyzeCustomProperties({
    '--a': 'VAR(--b) vAr(--b)',
    '--b': 'red'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'red red')
})

test('does not treat functions ending with var as var()', () => {
  let result = analyzeCustomProperties({
    '--a': 'myvar(--b) 1px'
  })
  equal(result.variables['--a'].references, [])
  is(result.variables['--a'].value, 'myvar(--b) 1px')
})

test('keeps commas inside fallback functions', () => {
  let result = analyzeCustomProperties({
    '--a': 'var(--b, rgb(1, 2, 3))'
  })
  is(result.variables['--a'].valid, true)
  is(result.variables['--a'].value, 'rgb(1, 2, 3)')
})

test('accepts array of declarations', () => {
  let result = analyzeCustomProperties([
    { prop: '--a', value: 'var(--b, red)' },
    { prop: 'color', value: 'var(--a)' }
  ])
  is(result.variables['--a'].value, 'red')
  is(result.declarations[1].value, 'red')
})

test('accepts PostCSS container', () => {
  let root = parse('a{--a: var(--b, red); color: var(--a)}')
  let rule = root.first
  if (!rule || !('walkDecls' in rule)) throw new Error('Bad parse')
  let result = analyzeCustomProperties(rule)
  is(result.variables['--a'].value, 'red')
  is(result.declarations.find(decl => decl.prop === 'color')?.value, 'red')
})

test('uses the last custom property definition', () => {
  let result = analyzeCustomProperties([
    { prop: '--a', value: 'red' },
    { prop: '--a', value: 'blue' }
  ])
  is(result.variables['--a'].value, 'blue')
})

test('throws on unsupported input', () => {
  // @ts-expect-error testing runtime error
  throws(() => analyzeCustomProperties(1))
})

test.run()
