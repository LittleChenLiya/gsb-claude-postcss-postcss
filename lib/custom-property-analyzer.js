'use strict'

// Analyzer for CSS custom properties (`--*`) inside a single, already
// cascaded set of declarations. It does not implement the CSS cascade:
// the caller is expected to pass the final declarations of one element.
//
// The analyzer parses `var()` references (including nested fallbacks,
// empty fallbacks and `var(` lookalikes inside strings/comments), builds
// the dependency graph between custom properties and reports for every
// variable whether it can be resolved, which dependencies were actually
// used during resolution and which variables form dependency cycles.
//
// Resolution follows the CSS Custom Properties Level 1 rules:
// * An undefined variable is recovered by its fallback, if a valid
//   fallback (possibly empty) is present.
// * All custom properties taking part in a reference cycle compute to
//   the guaranteed-invalid value. Referencing such a variable makes the
//   referrer invalid at computed-value time too, and fallbacks are not
//   consulted in this case.

function isWhitespace(char) {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\r' ||
    char === '\f'
  )
}

function isNameChar(char) {
  if (!char) return false
  let code = char.charCodeAt(0)
  return (
    code > 127 ||
    char === '_' ||
    char === '-' ||
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  )
}

function isNameStart(char) {
  return char === '\\' || isNameChar(char)
}

function consumeString(str, start) {
  let quote = str[start]
  let i = start + 1
  while (i < str.length) {
    if (str[i] === '\\') {
      i += 2
    } else if (str[i] === quote) {
      return i + 1
    } else {
      i += 1
    }
  }
  return str.length
}

function consumeComment(str, start) {
  let end = str.indexOf('*/', start + 2)
  return end === -1 ? str.length : end + 2
}

function consumeIdent(str, start) {
  let i = start
  while (i < str.length) {
    if (str[i] === '\\') {
      i += i + 1 < str.length ? 2 : 1
    } else if (isNameChar(str[i])) {
      i += 1
    } else {
      break
    }
  }
  return i
}

function skipIgnorable(str, start) {
  let i = start
  while (i < str.length) {
    if (isWhitespace(str[i])) {
      i += 1
    } else if (str[i] === '/' && str[i + 1] === '*') {
      i = consumeComment(str, i)
    } else {
      break
    }
  }
  return i
}

// Parses a value into a list of `{ type: 'text' }` and `{ type: 'var' }`
// parts. When `nested` is true, stops before the first unmatched `)`.
function parseParts(str, start, nested) {
  let parts = []
  let text = ''
  let i = start

  function flush() {
    if (text !== '') {
      parts.push({ type: 'text', value: text })
      text = ''
    }
  }

  while (i < str.length) {
    let char = str[i]
    if (char === '"' || char === "'") {
      let end = consumeString(str, i)
      text += str.slice(i, end)
      i = end
    } else if (char === '/' && str[i + 1] === '*') {
      let end = consumeComment(str, i)
      text += str.slice(i, end)
      i = end
    } else if (char === ')' && nested) {
      flush()
      return { closed: true, end: i, parts }
    } else if (isNameStart(char)) {
      let end = consumeIdent(str, i)
      let word = str.slice(i, end)
      if (word.toLowerCase() === 'var' && str[end] === '(') {
        let parsed = parseVar(str, i, end + 1)
        if (parsed.error) return { error: true }
        flush()
        parts.push(parsed.part)
        i = parsed.end
      } else {
        text += word
        i = end
      }
    } else {
      text += char
      i += 1
    }
  }

  flush()
  if (nested) return { error: true }
  return { closed: true, end: i, parts }
}

// Parses arguments of `var(` starting right after the opening paren.
function parseVar(str, start, i) {
  i = skipIgnorable(str, i)
  if (str[i] !== '-' || str[i + 1] !== '-') return { error: true }
  let nameEnd = consumeIdent(str, i)
  let name = str.slice(i, nameEnd)
  i = skipIgnorable(str, nameEnd)
  if (str[i] === ')') {
    return {
      end: i + 1,
      part: { fallback: null, name, raw: str.slice(start, i + 1), type: 'var' }
    }
  }
  if (str[i] !== ',') return { error: true }
  let fallback = parseParts(str, i + 1, true)
  if (fallback.error) return { error: true }
  return {
    end: fallback.end + 1,
    part: {
      fallback: fallback.parts,
      name,
      raw: str.slice(start, fallback.end + 1),
      type: 'var'
    }
  }
}

function collectRefs(parts, refs) {
  for (let part of parts) {
    if (part.type === 'var') {
      refs.push(part.name)
      if (part.fallback) collectRefs(part.fallback, refs)
    }
  }
}

// Tarjan's algorithm: returns the strongly connected components of the
// graph which form reference cycles (including self-references).
function findCycles(graph) {
  let indices = new Map()
  let lowlinks = new Map()
  let onStack = new Set()
  let stack = []
  let counter = 0
  let cycles = []

  function strongconnect(node) {
    indices.set(node, counter)
    lowlinks.set(node, counter)
    counter += 1
    stack.push(node)
    onStack.add(node)

    for (let next of graph.get(node)) {
      if (!indices.has(next)) {
        strongconnect(next)
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)))
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)))
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      let component = []
      let member
      do {
        member = stack.pop()
        onStack.delete(member)
        component.push(member)
      } while (member !== node)
      if (component.length > 1 || graph.get(node).includes(node)) {
        cycles.push(component.sort())
      }
    }
  }

  for (let node of graph.keys()) {
    if (!indices.has(node)) strongconnect(node)
  }

  cycles.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return cycles
}

function isInitialValue(value) {
  return (
    value
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .trim()
      .toLowerCase() === 'initial'
  )
}

class CustomPropertyAnalyzer {
  constructor(declarations) {
    this.declarations = []
    for (let decl of declarations) {
      this.declarations.push({
        prop: String(decl.prop),
        value: String(decl.value)
      })
    }
  }

  analyze() {
    let custom = new Map()
    let regular = []

    for (let decl of this.declarations) {
      if (decl.prop.startsWith('--')) {
        let parsed = parseParts(decl.value, 0, false)
        custom.set(decl.prop, {
          error: parsed.error === true,
          parts: parsed.error ? [] : parsed.parts,
          refs: [],
          value: decl.value
        })
      } else {
        regular.push(decl)
      }
    }

    for (let entry of custom.values()) {
      collectRefs(entry.parts, entry.refs)
    }

    // Dependency graph between defined custom properties. References
    // inside fallbacks count as edges, like in the CSS specification.
    let graph = new Map()
    for (let [name, entry] of custom) {
      graph.set(name, entry.refs.filter(ref => custom.has(ref)))
    }
    let cycles = findCycles(graph)
    let cyclic = new Map()
    for (let component of cycles) {
      for (let name of component) cyclic.set(name, component)
    }

    let memo = new Map()

    function resolveVariable(name) {
      if (memo.has(name)) return memo.get(name)
      let entry = custom.get(name)
      let result
      if (!entry) {
        result = {
          reason: 'undefined',
          used: new Set(),
          valid: false,
          value: null
        }
      } else if (cyclic.has(name)) {
        result = {
          reason: 'cycle',
          used: new Set(),
          valid: false,
          value: null
        }
      } else if (entry.error || isInitialValue(entry.value)) {
        result = {
          reason: 'invalid',
          used: new Set(),
          valid: false,
          value: null
        }
      } else {
        let used = new Set()
        let resolved = resolveParts(entry.parts, used)
        if (resolved.valid) {
          result = {
            reason: null,
            used,
            valid: true,
            value: resolved.text.trim()
          }
        } else {
          result = { reason: 'invalid', used, valid: false, value: null }
        }
      }
      memo.set(name, result)
      return result
    }

    function resolveParts(parts, used) {
      let text = ''
      for (let part of parts) {
        if (part.type === 'text') {
          text += part.value
        } else {
          used.add(part.name)
          let dep = resolveVariable(part.name)
          if (dep.valid) {
            text += dep.value
            for (let depName of dep.used) used.add(depName)
          } else if (dep.reason === 'undefined' && part.fallback !== null) {
            let fallback = resolveParts(part.fallback, used)
            if (!fallback.valid) return { valid: false }
            text += fallback.text
          } else {
            // Guaranteed-invalid (cyclic or invalid) references and
            // undefined references without a fallback cannot be recovered.
            return { valid: false }
          }
        }
      }
      return { text, valid: true }
    }

    let variables = new Map()
    for (let [name, entry] of custom) {
      let resolved = resolveVariable(name)
      let component = cyclic.get(name) || null
      variables.set(name, {
        cycle: component,
        defined: true,
        dependencies: component
          ? [...new Set(entry.refs)].sort()
          : [...resolved.used].sort(),
        name,
        reason: resolved.reason,
        valid: resolved.valid,
        value: resolved.value
      })
    }

    let referenced = new Set()
    for (let entry of custom.values()) {
      for (let ref of entry.refs) referenced.add(ref)
    }
    for (let name of referenced) {
      if (!variables.has(name)) {
        variables.set(name, {
          cycle: null,
          defined: false,
          dependencies: [],
          name,
          reason: 'undefined',
          valid: false,
          value: null
        })
      }
    }

    let declarations = regular.map(decl => {
      let parsed = parseParts(decl.value, 0, false)
      if (parsed.error) {
        return {
          dependencies: [],
          prop: decl.prop,
          resolvedValue: null,
          valid: false,
          value: decl.value
        }
      }
      let used = new Set()
      let resolved = resolveParts(parsed.parts, used)
      return {
        dependencies: [...used].sort(),
        prop: decl.prop,
        resolvedValue: resolved.valid ? resolved.text.trim() : null,
        valid: resolved.valid,
        value: decl.value
      }
    })

    return { cycles, declarations, variables }
  }
}

module.exports = CustomPropertyAnalyzer
CustomPropertyAnalyzer.default = CustomPropertyAnalyzer
