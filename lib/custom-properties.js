'use strict'

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

function isNameChar(ch) {
  if (!ch) return false
  let code = ch.charCodeAt(0)
  return (
    code > 127 ||
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    ch === '-' ||
    ch === '_'
  )
}

function skipString(value, i) {
  let quote = value[i]
  i += 1
  while (i < value.length) {
    if (value[i] === '\\') {
      i += 2
    } else if (value[i] === quote) {
      return i + 1
    } else {
      i += 1
    }
  }
  return i
}

function skipComment(value, i) {
  let end = value.indexOf('*/', i + 2)
  return end === -1 ? value.length : end + 2
}

function skipSeparators(value, i) {
  while (i < value.length) {
    if (isSpace(value[i])) {
      i += 1
    } else if (value[i] === '/' && value[i + 1] === '*') {
      i = skipComment(value, i)
    } else {
      break
    }
  }
  return i
}

function isVarAt(value, i) {
  if (value.slice(i, i + 4).toLowerCase() !== 'var(') return false
  return i === 0 || !isNameChar(value[i - 1])
}

// Parses a var() call starting at `start` (value begins with `var(`
// at this position). Returns the call description with the position
// right after the closing `)`.
function parseVar(value, start) {
  let i = skipSeparators(value, start + 4)
  let nameStart = i
  while (i < value.length && isNameChar(value[i])) i += 1
  let name = value.slice(nameStart, i)
  i = skipSeparators(value, i)

  let malformed = !name.startsWith('--')
  let fallback = null

  if (value[i] === ',') {
    i += 1
    let fallbackStart = i
    let depth = 0
    while (i < value.length) {
      let ch = value[i]
      if (ch === '"' || ch === "'") {
        i = skipString(value, i)
      } else if (ch === '/' && value[i + 1] === '*') {
        i = skipComment(value, i)
      } else if (ch === '(') {
        depth += 1
        i += 1
      } else if (ch === ')') {
        if (depth === 0) break
        depth -= 1
        i += 1
      } else {
        i += 1
      }
    }
    fallback = value.slice(fallbackStart, i)
  }

  if (value[i] === ')') {
    i += 1
  } else {
    malformed = true
  }

  return { end: i, fallback, malformed, name, start }
}

// Finds all top-level var() calls in a declaration value,
// ignoring var( sequences inside strings and comments.
function scanVarCalls(value) {
  let calls = []
  let i = 0
  while (i < value.length) {
    let ch = value[i]
    if (ch === '"' || ch === "'") {
      i = skipString(value, i)
    } else if (ch === '/' && value[i + 1] === '*') {
      i = skipComment(value, i)
    } else if ((ch === 'v' || ch === 'V') && isVarAt(value, i)) {
      let call = parseVar(value, i)
      calls.push(call)
      i = call.end
    } else {
      i += 1
    }
  }
  return calls
}

// Collects names of all custom properties referenced by var()
// in the value, including references inside fallbacks.
function collectReferences(value) {
  let references = []
  for (let call of scanVarCalls(value)) {
    if (call.name) references.push(call.name)
    if (call.fallback !== null) {
      references.push(...collectReferences(call.fallback))
    }
  }
  return references
}

// Tarjan's strongly connected components. Returns only cyclic
// components: groups of more than one variable, or a variable
// that references itself.
function findCycles(graph) {
  let cycles = []
  let counter = 0
  let index = new Map()
  let lowlink = new Map()
  let onStack = new Set()
  let stack = []

  function strongconnect(name) {
    index.set(name, counter)
    lowlink.set(name, counter)
    counter += 1
    stack.push(name)
    onStack.add(name)

    for (let next of graph.get(name)) {
      if (!index.has(next)) {
        strongconnect(next)
        lowlink.set(name, Math.min(lowlink.get(name), lowlink.get(next)))
      } else if (onStack.has(next)) {
        lowlink.set(name, Math.min(lowlink.get(name), index.get(next)))
      }
    }

    if (lowlink.get(name) === index.get(name)) {
      let component = []
      let member
      do {
        member = stack.pop()
        onStack.delete(member)
        component.push(member)
      } while (member !== name)
      if (component.length > 1 || graph.get(name).includes(name)) {
        cycles.push(component.sort())
      }
    }
  }

  for (let name of graph.keys()) {
    if (!index.has(name)) strongconnect(name)
  }

  return cycles
}

function normalize(declarations) {
  let decls = []
  if (declarations && typeof declarations.walkDecls === 'function') {
    declarations.walkDecls(decl => {
      decls.push({ prop: decl.prop, value: decl.value })
    })
  } else if (Array.isArray(declarations)) {
    for (let decl of declarations) {
      decls.push({ prop: decl.prop, value: String(decl.value) })
    }
  } else if (declarations && typeof declarations === 'object') {
    for (let prop of Object.keys(declarations)) {
      decls.push({ prop, value: String(declarations[prop]) })
    }
  } else {
    throw new Error(
      'analyzeCustomProperties() expects an array of declarations, ' +
        'a PostCSS container, or an object with property values'
    )
  }
  return decls
}

// Analyzes a set of final declarations of a single element: resolves
// var() references between custom properties, detects dependency
// cycles, and reports the result for every variable and declaration.
function analyzeCustomProperties(declarations) {
  let decls = normalize(declarations)

  let custom = new Map()
  for (let decl of decls) {
    if (decl.prop.startsWith('--')) custom.set(decl.prop, decl.value)
  }

  let references = new Map()
  let graph = new Map()
  for (let [name, value] of custom) {
    let refs = collectReferences(value)
    references.set(name, refs)
    graph.set(
      name,
      refs.filter(ref => custom.has(ref))
    )
  }

  let cycles = findCycles(graph)
  let cycleOf = new Map()
  for (let component of cycles) {
    for (let name of component) cycleOf.set(name, component)
  }

  let resolved = new Map()

  function resolveValue(value) {
    let calls = scanVarCalls(value)
    if (calls.length === 0) {
      return { dependencies: [], valid: true, value }
    }

    let dependencies = new Set()
    let valid = true
    let out = ''
    let last = 0

    for (let call of calls) {
      out += value.slice(last, call.start)
      last = call.end

      if (call.malformed) {
        valid = false
        continue
      }

      let substitution = null
      if (custom.has(call.name)) {
        let target = resolveVariable(call.name)
        if (target.valid) {
          substitution = target.value
          dependencies.add(call.name)
          for (let dep of target.dependencies) dependencies.add(dep)
        }
      }

      if (substitution === null && call.fallback !== null) {
        let fallback = resolveValue(call.fallback.trim())
        if (fallback.valid) {
          substitution = fallback.value
          for (let dep of fallback.dependencies) dependencies.add(dep)
        }
      }

      if (substitution === null) {
        valid = false
      } else {
        out += substitution
      }
    }

    out += value.slice(last)
    return {
      dependencies: [...dependencies],
      valid,
      value: valid ? out : null
    }
  }

  function resolveVariable(name) {
    if (resolved.has(name)) return resolved.get(name)
    let result
    if (cycleOf.has(name)) {
      // Custom properties in a dependency cycle are invalid
      // at computed-value time regardless of fallbacks.
      result = { dependencies: [], valid: false, value: null }
    } else {
      result = resolveValue(custom.get(name))
    }
    resolved.set(name, result)
    return result
  }

  let variables = {}
  for (let name of custom.keys()) {
    let result = resolveVariable(name)
    variables[name] = {
      cycle: cycleOf.get(name) || null,
      cyclic: cycleOf.has(name),
      dependencies: result.dependencies,
      name,
      references: references.get(name),
      valid: result.valid,
      value: result.value
    }
  }

  let analyzed = []
  for (let decl of decls) {
    if (decl.prop.startsWith('--')) {
      let variable = variables[decl.prop]
      analyzed.push({
        cycle: variable.cycle,
        cyclic: variable.cyclic,
        dependencies: variable.dependencies,
        prop: decl.prop,
        references: variable.references,
        valid: variable.valid,
        value: variable.value
      })
    } else {
      let result = resolveValue(decl.value)
      analyzed.push({
        cycle: null,
        cyclic: false,
        dependencies: result.dependencies,
        prop: decl.prop,
        references: collectReferences(decl.value),
        valid: result.valid,
        value: result.value
      })
    }
  }

  return { cycles, declarations: analyzed, variables }
}

module.exports = analyzeCustomProperties
analyzeCustomProperties.default = analyzeCustomProperties
