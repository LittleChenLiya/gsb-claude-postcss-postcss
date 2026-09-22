let parse = require('./parse')

let separator = String.fromCharCode(0)

function isSpace(char) {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f'
}

function unescapeIdent(value) {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    let char = value[i]
    if (char === '\\' && i + 1 < value.length) {
      let next = value[i + 1]
      if (/^[0-9a-fA-F]$/.test(next)) {
        let hex = next
        let j = i + 2
        while (
          j < value.length &&
          hex.length < 6 &&
          /^[0-9a-fA-F]$/.test(value[j])
        ) {
          hex += value[j]
          j++
        }
        if (j < value.length && isSpace(value[j])) j++
        result += String.fromCodePoint(parseInt(hex, 16))
        i = j - 1
      } else {
        result += next
        i++
      }
    } else {
      result += char
    }
  }
  return result
}

// Splits a params string on top-level commas, respecting strings,
// escapes and parentheses. Never splits inside "...", '...' or (...)
function splitTopLevelCommas(params) {
  let parts = []
  let current = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < params.length; i++) {
    let char = params[i]
    if (quote) {
      current += char
      if (char === '\\' && i + 1 < params.length) {
        current += params[i + 1]
        i++
      } else if (char === quote) {
        quote = null
      }
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === '\\' && i + 1 < params.length) {
      current += char + params[i + 1]
      i++
    } else if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

// Splits "a.b.c" into identifier segments on unescaped dots,
// unescaping each segment (e.g. "a\.b" stays a single "a.b" name)
function splitLayerPath(name) {
  let segments = []
  let current = ''
  for (let i = 0; i < name.length; i++) {
    let char = name[i]
    if (char === '\\' && i + 1 < name.length) {
      current += char + name[i + 1]
      i++
    } else if (char === '.') {
      segments.push(unescapeIdent(current.trim()))
      current = ''
    } else {
      current += char
    }
  }
  segments.push(unescapeIdent(current.trim()))
  return segments.filter(segment => segment !== '')
}

// Parses @import params into { url, layer, conditions } by walking
// tokens and respecting strings/parens instead of naive splitting
function parseImportParams(params) {
  let tokens = []
  let current = ''
  let depth = 0
  let quote = null
  for (let i = 0; i < params.length; i++) {
    let char = params[i]
    if (quote) {
      current += char
      if (char === '\\' && i + 1 < params.length) {
        current += params[i + 1]
        i++
      } else if (char === quote) {
        quote = null
      }
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (isSpace(char) && depth === 0) {
      if (current !== '') tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current !== '') tokens.push(current)

  let result = { conditions: [], layer: undefined, url: null }
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i]
    let lower = token.toLowerCase()
    if (i === 0) {
      if (lower.startsWith('url(')) {
        let inner = token.slice(4, token.endsWith(')') ? -1 : undefined).trim()
        result.url = unescapeIdent(inner.replace(/^['"]|['"]$/g, ''))
      } else {
        result.url = token.replace(/^['"]|['"]$/g, '')
      }
    } else if (lower === 'layer') {
      if (result.layer === undefined) result.layer = null
    } else if (lower.startsWith('layer(')) {
      let inner = token.slice(6, token.endsWith(')') ? -1 : undefined).trim()
      result.layer = splitLayerPath(inner)
    } else if (lower.startsWith('supports(')) {
      result.conditions.push({
        params: token.slice(9, token.endsWith(')') ? -1 : undefined).trim(),
        type: 'supports'
      })
    } else {
      result.conditions.push({ params: token, type: 'media' })
    }
  }
  return result
}

function positionOf(node) {
  if (node.source && node.source.start) {
    return {
      column: node.source.start.column,
      line: node.source.start.line,
      offset: node.source.start.offset,
      source: node.source.input ? node.source.input.from : undefined
    }
  }
  return undefined
}

function isDynamicCondition(params) {
  return /(?:var|env|attr)\s*\(/i.test(params)
}

class LayerRegistry {
  constructor() {
    this.anonymousCount = 0
    this.byKey = new Map()
    this.list = []
  }

  anonymousLayer(pathPrefix, position, conditions) {
    this.anonymousCount++
    let layer = {
      anonymous: true,
      conditions: conditions.slice(),
      firstPosition: position,
      id: '#anonymous-' + this.anonymousCount,
      name: null,
      order: this.list.length,
      parent: pathPrefix.length > 0 ? pathPrefix.join('.') : null,
      path: pathPrefix.concat(['#anonymous-' + this.anonymousCount])
    }
    this.byKey.set(layer.path.join(separator), layer)
    this.list.push(layer)
    return layer
  }

  // Registers a dotted path (relative to prefix) and returns the leaf.
  // First occurrence wins: re-declaring an existing layer never
  // changes its original order.
  ensure(pathPrefix, segments, position, conditions) {
    let full = pathPrefix.concat(segments)
    let current = []
    let leaf = null
    for (let segment of full) {
      current.push(segment)
      let key = current.join(separator)
      let existing = this.byKey.get(key)
      if (!existing) {
        existing = {
          anonymous: false,
          conditions: conditions.slice(),
          firstPosition: position,
          id: current.join('.'),
          name: segment,
          order: this.list.length,
          parent: current.length > 1 ? current.slice(0, -1).join('.') : null,
          path: current.slice()
        }
        this.byKey.set(key, existing)
        this.list.push(existing)
      }
      leaf = existing
    }
    return leaf
  }
}

class CascadeLayerAnalyzer {
  constructor(options) {
    this.diagnostics = []
    this.options = options || {}
    this.registry = new LayerRegistry()
    this.unlayered = { firstPosition: undefined, present: false }
  }

  analyze(root) {
    this.visitContainer(root, {
      chain: [],
      conditions: [],
      pathPrefix: []
    })
    return this.buildResult()
  }

  buildResult() {
    let layers = this.registry.list
    let normalOrder = layers.slice()
    if (this.unlayered.present) {
      normalOrder.push({
        anonymous: false,
        firstPosition: this.unlayered.firstPosition,
        id: null,
        name: null,
        order: normalOrder.length,
        unlayered: true
      })
    }
    // !important reverses the cascade: unlayered important declarations
    // lose to layered ones, and earlier layers win over later ones
    let importantOrder = normalOrder.slice().reverse()
    return {
      conditions: this.collectConditions(layers),
      diagnostics: this.diagnostics,
      importantOrder,
      layers,
      normalOrder,
      unlayered: {
        firstPosition: this.unlayered.firstPosition,
        present: this.unlayered.present
      }
    }
  }

  collectConditions(layers) {
    let seen = []
    for (let layer of layers) {
      for (let condition of layer.conditions) {
        seen.push(condition)
      }
    }
    return seen
  }

  conditionContext(atRule, conditions) {
    return conditions.concat([
      {
        dynamic: isDynamicCondition(atRule.params),
        node: atRule,
        params: atRule.params,
        position: positionOf(atRule),
        type: atRule.name.toLowerCase(),
        value: 'unknown'
      }
    ])
  }

  markUnlayered(node) {
    if (!this.unlayered.present) {
      this.unlayered.present = true
      this.unlayered.firstPosition = positionOf(node)
    }
  }

  visitAtRule(atRule, context) {
    let name = atRule.name.toLowerCase()
    if (name === 'layer') {
      this.visitLayerAtRule(atRule, context)
    } else if (name === 'import') {
      this.visitImportAtRule(atRule, context)
    } else if (name === 'media' || name === 'supports') {
      this.visitContainer(atRule, {
        ...context,
        conditions: this.conditionContext(atRule, context.conditions)
      })
    } else if (context.pathPrefix.length === 0 && atRule.nodes) {
      this.visitContainer(atRule, context)
    }
  }

  visitContainer(container, context) {
    if (!container.nodes) return
    for (let child of container.nodes) {
      this.visitNode(child, context)
    }
  }

  visitDeclaration(node, context) {
    if (context.pathPrefix.length === 0) this.markUnlayered(node)
  }

  visitImportAtRule(atRule, context) {
    let parsed = parseImportParams(atRule.params || '')
    let position = positionOf(atRule)
    let importConditions = context.conditions
    if (parsed.conditions.length > 0) {
      importConditions = context.conditions.concat(
        parsed.conditions.map(condition => ({
          dynamic: isDynamicCondition(condition.params),
          node: atRule,
          params: condition.params,
          position,
          type: condition.type,
          value: 'unknown'
        }))
      )
    }

    let pathPrefix = context.pathPrefix
    if (parsed.layer !== undefined) {
      if (parsed.layer === null) {
        let layer = this.registry.anonymousLayer(
          pathPrefix,
          position,
          importConditions
        )
        pathPrefix = layer.path
      } else {
        let leaf = this.registry.ensure(
          pathPrefix,
          parsed.layer,
          position,
          importConditions
        )
        pathPrefix = leaf.path
      }
    }

    let url = parsed.url
    if (!url) return
    let from = position && position.source
    let entry = { from, position, url }
    if (context.chain.some(chainEntry => chainEntry.url === url)) {
      this.diagnostics.push({
        chain: context.chain.concat([entry]),
        message: 'Circular @import detected for "' + url + '"',
        position,
        type: 'import-cycle',
        url
      })
      return
    }

    let resolver = this.options.resolveImport
    if (typeof resolver !== 'function') {
      this.diagnostics.push({
        chain: context.chain.concat([entry]),
        message: 'No resolveImport callback provided to load "' + url + '"',
        position,
        type: 'import-unresolved',
        url
      })
      return
    }

    let resolved
    try {
      resolved = resolver(url, { chain: context.chain.slice(), from })
    } catch (error) {
      this.diagnostics.push({
        chain: context.chain.concat([entry]),
        message: 'Failed to resolve "' + url + '": ' + (error && error.message),
        position,
        type: 'import-failed',
        url
      })
      return
    }
    if (!resolved || (!resolved.css && !resolved.root)) {
      this.diagnostics.push({
        chain: context.chain.concat([entry]),
        message: 'Failed to load "' + url + '"',
        position,
        type: 'import-failed',
        url
      })
      return
    }

    let importedRoot = resolved.root
    if (!importedRoot && resolved.css) {
      try {
        importedRoot = parse(resolved.css, { from: resolved.id || url })
      } catch (error) {
        this.diagnostics.push({
          chain: context.chain.concat([entry]),
          message: 'Failed to parse "' + url + '": ' + (error && error.message),
          position,
          type: 'import-failed',
          url
        })
        return
      }
    }

    this.visitContainer(importedRoot, {
      chain: context.chain.concat([entry]),
      conditions: importConditions,
      pathPrefix
    })
  }

  visitLayerAtRule(atRule, context) {
    let names = splitTopLevelCommas(atRule.params || '')
    let position = positionOf(atRule)
    if (atRule.nodes) {
      if (names.length === 0) {
        // Every anonymous @layer block is a brand-new identity
        let layer = this.registry.anonymousLayer(
          context.pathPrefix,
          position,
          context.conditions
        )
        this.visitContainer(atRule, {
          ...context,
          pathPrefix: layer.path
        })
      } else {
        for (let i = 0; i < names.length; i++) {
          let segments = splitLayerPath(names[i])
          let leaf = this.registry.ensure(
            context.pathPrefix,
            segments,
            position,
            context.conditions
          )
          // With a block, the rules inside belong to the last named layer
          if (i === names.length - 1) {
            this.visitContainer(atRule, {
              ...context,
              pathPrefix: leaf.path
            })
          }
        }
      }
    } else {
      for (let layerName of names) {
        this.registry.ensure(
          context.pathPrefix,
          splitLayerPath(layerName),
          position,
          context.conditions
        )
      }
    }
  }

  visitNode(node, context) {
    if (node.type === 'atrule') {
      this.visitAtRule(node, context)
    } else if (node.type === 'decl') {
      this.visitDeclaration(node, context)
    } else if (node.type === 'rule') {
      if (context.pathPrefix.length === 0) this.markUnlayered(node)
      this.visitContainer(node, context)
    } else if (
      node.type === 'container' ||
      node.type === 'root' ||
      node.type === 'document'
    ) {
      this.visitContainer(node, context)
    }
  }
}

function analyzeCascadeLayers(root, options) {
  return new CascadeLayerAnalyzer(options).analyze(root)
}

module.exports = analyzeCascadeLayers
module.exports.analyzeCascadeLayers = analyzeCascadeLayers
module.exports.default = analyzeCascadeLayers
