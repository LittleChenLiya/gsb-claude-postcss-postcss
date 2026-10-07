import { test } from 'uvu'
import { equal, is, ok } from 'uvu/assert'

import CustomPropertyAnalyzer = require('../lib/custom-property-analyzer.js')
import { parse } from '../lib/postcss.js'

const BS = String.fromCharCode(92)

function analyze(
  declarations: { prop: string; value: string }[]
): CustomPropertyAnalyzer.AnalysisResult {
  return new CustomPropertyAnalyzer(declarations).analyze()
}

test('resolves undefined variable through fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, red)' },
    { prop: 'color', value: 'var(--a)' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, true)
  is(a.value, 'red')
  equal(a.dependencies, ['--b'])
  is(a.cycle, null)

  let b = result.variables.get('--b')
  ok(b)
  is(b.defined, false)
  is(b.valid, false)
  is(b.reason, 'undefined')

  equal(result.cycles, [])
  equal(result.declarations, [
    {
      dependencies: ['--a', '--b'],
      prop: 'color',
      resolvedValue: 'red',
      valid: true,
      value: 'var(--a)'
    }
  ])
})

test('marks reference cycle as invalid and lists its nodes', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, red)' },
    { prop: '--b', value: 'var(--a)' },
    { prop: 'color', value: 'var(--a)' }
  ])

  equal(result.cycles, [['--a', '--b']])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, false)
  is(a.reason, 'cycle')
  is(a.value, null)
  equal(a.cycle, ['--a', '--b'])

  let b = result.variables.get('--b')
  ok(b)
  is(b.valid, false)
  is(b.reason, 'cycle')
  equal(b.cycle, ['--a', '--b'])

  // Fallback is not consulted for cyclic (guaranteed-invalid) references
  let color = result.declarations[0]
  is(color.valid, false)
  is(color.resolvedValue, null)
})

test('detects self-references and longer cycles', () => {
  let result = analyze([
    { prop: '--self', value: 'var(--self)' },
    { prop: '--a', value: 'var(--b)' },
    { prop: '--b', value: 'var(--c)' },
    { prop: '--c', value: 'var(--a)' },
    { prop: '--ok', value: 'blue' }
  ])

  equal(result.cycles, [
    ['--a', '--b', '--c'],
    ['--self']
  ])
  equal(result.variables.get('--c')?.cycle, ['--a', '--b', '--c'])
  equal(result.variables.get('--self')?.cycle, ['--self'])
  is(result.variables.get('--ok')?.valid, true)
})

test('resolves nested var() inside fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, var(--c, green))' },
    { prop: '--c', value: 'blue' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, true)
  is(a.value, 'blue')
  equal(a.dependencies, ['--b', '--c'])

  let missing = analyze([{ prop: '--a', value: 'var(--b, var(--c, green))' }])
  is(missing.variables.get('--a')?.value, 'green')
  equal(missing.variables.get('--a')?.dependencies, ['--b', '--c'])
})

test('supports empty fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b,)' },
    { prop: 'content', value: '"x" var(--c, ) "y"' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, true)
  is(a.value, '')

  is(result.declarations[0].valid, true)
  is(result.declarations[0].resolvedValue, '"x"   "y"')
})

test('ignores var() lookalikes inside strings', () => {
  let result = analyze([
    { prop: '--a', value: '"var(--b)"' },
    { prop: 'content', value: 'var(--a) "var(--c)"' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, true)
  is(a.value, '"var(--b)"')
  equal(a.dependencies, [])
  is(result.variables.has('--b'), false)
  is(result.variables.has('--c'), false)

  is(result.declarations[0].resolvedValue, '"var(--b)" "var(--c)"')
})

test('handles escaped quotes inside strings', () => {
  let result = analyze([
    { prop: '--a', value: '"it' + BS + "'s var(--b)" + BS + '"' },
    { prop: 'content', value: 'var(--a)' }
  ])

  is(result.variables.get('--a')?.valid, true)
  is(result.variables.has('--b'), false)
  is(result.declarations[0].valid, true)
})

test('ignores var() lookalikes inside comments', () => {
  let result = analyze([
    { prop: '--a', value: '/* var(--z) */ var(--b/* name */, /* fb */ red)' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.valid, true)
  is(a.value, '/* var(--z) */  /* fb */ red')
  equal(a.dependencies, ['--b'])
  is(result.variables.has('--z'), false)
})

test('treats custom property names as case-sensitive', () => {
  let result = analyze([
    { prop: '--A', value: 'var(--a, red)' },
    { prop: '--a', value: 'blue' }
  ])

  is(result.variables.get('--A')?.value, 'blue')
  is(result.variables.get('--a')?.value, 'blue')
  equal(result.variables.get('--A')?.dependencies, ['--a'])

  let missing = analyze([{ prop: '--A', value: 'var(--a, red)' }])
  is(missing.variables.get('--A')?.value, 'red')
  is(missing.variables.get('--a')?.defined, false)
})

test('accepts var function name in any letter case', () => {
  let result = analyze([
    { prop: '--a', value: 'VAR(--b, RED)' },
    { prop: 'color', value: 'Var(--a)' }
  ])

  is(result.variables.get('--a')?.value, 'RED')
  is(result.declarations[0].resolvedValue, 'RED')
})

test('does not confuse idents ending with var with the var() function', () => {
  let result = analyze([
    { prop: '--a', value: '1px' },
    { prop: 'margin', value: 'avar(--a) 2px' }
  ])

  is(result.variables.get('--a')?.valid, true)
  is(result.declarations[0].valid, true)
  is(result.declarations[0].resolvedValue, 'avar(--a) 2px')
  equal(result.declarations[0].dependencies, [])
})

test('uses defined variable instead of its fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, var(--c, red))' },
    { prop: '--b', value: 'blue' },
    { prop: '--c', value: 'green' }
  ])

  let a = result.variables.get('--a')
  ok(a)
  is(a.value, 'blue')
  equal(a.dependencies, ['--b'])
})

test('fails undefined variable without fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b)' },
    { prop: 'color', value: 'var(--a)' }
  ])

  is(result.variables.get('--a')?.valid, false)
  is(result.variables.get('--a')?.reason, 'invalid')
  is(result.declarations[0].valid, false)
})

test('does not recover guaranteed-invalid references with fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, red)' },
    { prop: '--b', value: 'var(--c)' }
  ])

  // --b is defined but invalid at computed-value time, so the fallback
  // of var(--b, red) is not used
  is(result.variables.get('--b')?.valid, false)
  is(result.variables.get('--a')?.valid, false)
  is(result.variables.get('--a')?.reason, 'invalid')
})

test('recovers undefined variable only with valid fallback', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b, var(--c))' },
    { prop: '--x', value: 'var(--d, yellow)' }
  ])

  // --b is undefined and its fallback var(--c) has no valid fallback
  is(result.variables.get('--a')?.valid, false)
  // fallback recovers undefined --d
  is(result.variables.get('--x')?.valid, true)
  is(result.variables.get('--x')?.value, 'yellow')
})

test('treats initial value as guaranteed-invalid', () => {
  let result = analyze([
    { prop: '--a', value: 'initial' },
    { prop: 'color', value: 'var(--a, red)' }
  ])

  is(result.variables.get('--a')?.valid, false)
  is(result.declarations[0].valid, false)
})

test('resolves chains of defined variables', () => {
  let result = analyze([
    { prop: '--a', value: 'var(--b)' },
    { prop: '--b', value: '1px solid var(--c)' },
    { prop: '--c', value: 'red' },
    { prop: 'border', value: 'var(--a)' }
  ])

  is(result.variables.get('--a')?.value, '1px solid red')
  equal(result.variables.get('--a')?.dependencies, ['--b', '--c'])
  is(result.declarations[0].resolvedValue, '1px solid red')
})

test('accepts PostCSS declaration nodes', () => {
  let root = parse('a{--a: var(--b, red); color: var(--a)}')
  let declarations: { prop: string; value: string }[] = []
  root.walkDecls(decl => {
    declarations.push(decl)
  })

  let result = new CustomPropertyAnalyzer(declarations).analyze()
  is(result.variables.get('--a')?.value, 'red')
  is(result.declarations[0].resolvedValue, 'red')
})

test.run()
