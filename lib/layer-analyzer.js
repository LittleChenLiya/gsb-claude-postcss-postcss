'use strict'

let Input = require('./input')
let tokenize = require('./tokenize')

let parse

function getParse() {
  // eslint-disable-next-line n/global-require
  if (!parse) parse = require('./parse')
  return parse
}

function unescapeIdent(value) {
  return value.replace(/\\([\da-f]{1,6}\s?|.)/gi, (all, escaped) => {
    if (/^[\da-f]/i.test(escaped)) {
      let code = parseInt(escaped, 16)
      if (code === 0 || code > 0x10ffff) return '\ufffd'
      return String.fromCodePoint(code)
    }
    return escaped
  })
}

function splitLayerName(raw) {
  let segments = []
  let current = ''
  for (let i = 0; i < raw.length; i++) {
    let char = raw[i]
    if (char === '\\') {
      current += char + (raw[i + 1] || '')
      i += 1
    } else if (char === '.') {
      segments.push(current)
      current = ''
    } else {
      current += char
    }
  }
  segments.push(current)
  return segments.filter(i => i !== '').map(unescapeIdent)
}

function preludeTokens(params) {
  let tokenizer = tokenize(new Input(params))
  let tokens = []
  while (!tokenizer.endOfFile()) {
    tokens.push(tokenizer.nextToken())
  }
  return tokens
}

function isSpace(token) {
  return token[0] === 'space' || token[0] === 'comment'
}

function skipSpaces(tokens, i) {
  while (i < tokens.length && isSpace(tokens[i])) i += 1
  return i
}

function layerNameGroups(tokens) {
  let groups = []
  let current = ''
  for (let token of tokens) {
    if (isSpace(token)) continue
    let value = token[1]
    let start = 0
    for (let i = 0; i < value.length; i++) {
      let char = value[i]
      if (char === '\\') {
        i += 1
      } else if (char === ',') {
        current += value.slice(start, i)
        groups.push(current)
        current = ''
        start = i + 1
      }
    }
    current += value.slice(start)
  }
  groups.push(current)
  return groups.filter(i => i.trim() !== '')
}

function unquote(token) {
  return token[1].slice(1, -1)
}

function unquoteString(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function isFunctionStart(token) {
  return token && (token[0] === 'brackets' || token[0] === '(')
}

function functionBody(tokens, i) {
  let token = tokens[i]
  if (token[0] === 'brackets') {
    return [token[1].slice(1, -1).trim(), i + 1]
  }
  let body = ''
  let deep = 0
  i += 1
  while (i < tokens.length) {
    token = tokens[i]
    if (token[0] === '(') {
      deep += 1
      body += token[1]
    } else if (token[0] === ')') {
      if (deep === 0) return [body.trim(), i + 1]
      deep -= 1
      body += token[1]
    } else if (isSpace(token)) {
      if (body !== '' && !body.endsWith(' ') && !body.endsWith('(')) {
        body += ' '
      }
    } else {
      body += token[1]
    }
    i += 1
  }
  return [body.trim(), i]
}

function parseImportParams(params) {
  let tokens = preludeTokens(params)
  let result = { layer: undefined, media: '', supports: '', url: undefined }
  let i = skipSpaces(tokens, 0)

  if (i < tokens.length) {
    let first = tokens[i]
    if (first[0] === 'string') {
      result.url = unquote(first)
      i += 1
    } else if (
      first[0] === 'word' &&
      first[1].toLowerCase() === 'url' &&
      isFunctionStart(tokens[skipSpaces(tokens, i + 1)])
    ) {
      let body
      ;[body, i] = functionBody(tokens, skipSpaces(tokens, i + 1))
      result.url = unquoteString(body)
    } else if (first[0] === 'word') {
      result.url = first[1]
      i += 1
    }
  }

  let previous
  while (i < tokens.length) {
    i = skipSpaces(tokens, i)
    if (i >= tokens.length) break
    let token = tokens[i]
    let word = token[0] === 'word' ? token[1].toLowerCase() : ''
    let next = tokens[skipSpaces(tokens, i + 1)]
    if (word === 'layer') {
      if (isFunctionStart(next)) {
        let body
        ;[body, i] = functionBody(tokens, skipSpaces(tokens, i + 1))
        result.layer = body
      } else {
        result.layer = null
        i += 1
      }
      previous = undefined
    } else if (word === 'supports' && isFunctionStart(next)) {
      ;[result.supports, i] = functionBody(tokens, skipSpaces(tokens, i + 1))
      previous = undefined
    } else {
      if (
        result.media !== '' &&
        token[0] !== ')' &&
        previous &&
        previous[0] !== '('
      ) {
        result.media += ' '
      }
      result.media += token[1]
      previous = token
      i += 1
    }
  }

  return result
}

function positionOf(node) {
  if (!node.source || !node.source.start) return undefined
  let position = {
    column: node.source.start.column,
    line: node.source.start.line
  }
  if (node.source.input) {
    position.file = node.source.input.file || node.source.input.id
  }
  return position
}

function sourceId(node) {
  if (node.source && node.source.input) {
    return node.source.input.file || node.source.input.id
  }
  return undefined
}

class LayerAnalyzer {
  constructor(options) {
    this.options = options || {}
    this.named = new Map()
    this.topOrder = []
    this.anonymousCount = 0
    this.conditions = []
    this.diagnostics = []
    this.unlayered = undefined
  }

  analyze(root) {
    this.walk(root, {
      chain: [sourceId(root) || '<input>'],
      conditions: [],
      layer: null
    })
    return this.buildResult()
  }

  buildResult() {
    let layers = []
    let normal = []
    let flatten = list => {
      for (let layer of list) {
        layers.push(layer)
        normal.push({ layer, type: 'layer' })
        flatten(layer.children)
      }
    }
    flatten(this.topOrder)
    for (let i = 0; i < layers.length; i++) layers[i].order = i

    if (this.unlayered) {
      normal.push({ type: 'unlayered', unlayered: this.unlayered })
    }

    let important = []
    if (this.unlayered) {
      important.push({ type: 'unlayered', unlayered: this.unlayered })
    }
    for (let i = normal.length - 1; i >= 0; i--) {
      if (normal[i].type === 'layer') {
        important.push({ layer: normal[i].layer, type: 'layer' })
      }
    }

    return {
      conditions: this.conditions,
      diagnostics: this.diagnostics,
      important,
      layers,
      normal,
      unlayered: this.unlayered
    }
  }

  createAnonymous(context, node) {
    this.anonymousCount += 1
    let record = {
      anonymous: true,
      children: [],
      conditions: context.conditions.slice(),
      directDeclarations: 0,
      firstPosition: positionOf(node),
      fullName: null,
      id: 'anonymous-' + this.anonymousCount,
      name: null,
      occurrences: 1,
      parent: context.layer ? context.layer.id : null
    }
    let list = context.layer ? context.layer.children : this.topOrder
    list.push(record)
    return record
  }

  declaration(decl, context) {
    if (context.layer) {
      context.layer.directDeclarations += 1
    } else if (this.unlayered) {
      this.unlayered.declarations += 1
    } else {
      this.unlayered = {
        conditions: context.conditions.slice(),
        declarations: 1,
        firstPosition: positionOf(decl)
      }
    }
  }

  declareLayer(segments, context, node) {
    let parent = context.layer
    let list = parent ? parent.children : this.topOrder
    let prefix = parent ? parent.id : null
    let record
    for (let segment of segments) {
      let fullName = prefix ? prefix + '.' + segment : segment
      record = this.named.get(fullName)
      if (!record) {
        record = {
          anonymous: false,
          children: [],
          conditions: context.conditions.slice(),
          directDeclarations: 0,
          firstPosition: positionOf(node),
          fullName,
          id: fullName,
          name: segment,
          occurrences: 0,
          parent: prefix
        }
        this.named.set(fullName, record)
        list.push(record)
      }
      record.occurrences += 1
      list = record.children
      prefix = fullName
    }
    return record
  }

  importAtRule(atRule, context) {
    let parsed = parseImportParams(atRule.params)
    let layer = context.layer
    if (parsed.layer !== undefined) {
      if (parsed.layer === null) {
        layer = this.createAnonymous(context, atRule)
      } else {
        layer = this.declareLayer(splitLayerName(parsed.layer), context, atRule)
      }
    }
    let conditions = context.conditions
    if (parsed.supports !== '') {
      conditions = conditions.concat([
        this.recordCondition('supports', parsed.supports)
      ])
    }
    if (parsed.media !== '') {
      conditions = conditions.concat([
        this.recordCondition('media', parsed.media)
      ])
    }

    let resolve = this.options.resolveImport
    if (!resolve || parsed.url === undefined) return

    let resolved
    try {
      resolved = resolve(parsed.url, {
        from: sourceId(atRule),
        layer: parsed.layer,
        media: parsed.media === '' ? undefined : parsed.media,
        supports: parsed.supports === '' ? undefined : parsed.supports
      })
    } catch (error) {
      this.diagnostics.push({
        chain: context.chain.slice(),
        import: parsed.url,
        reason: error.message,
        type: 'import-failed'
      })
      return
    }

    if (resolved === null || resolved === undefined) {
      this.diagnostics.push({
        chain: context.chain.slice(),
        import: parsed.url,
        reason: 'Import could not be resolved',
        type: 'import-failed'
      })
      return
    }

    let css, file, imported
    if (typeof resolved === 'string') {
      css = resolved
    } else if (resolved.type === 'root') {
      imported = resolved
    } else {
      css = resolved.css
      file = resolved.file
    }

    let id = file || parsed.url
    let chain = context.chain.concat([id])
    if (context.chain.includes(id)) {
      this.diagnostics.push({
        chain,
        import: parsed.url,
        reason: 'Circular import detected',
        type: 'import-cycle'
      })
      return
    }

    if (!imported) {
      try {
        imported = getParse()(css, { from: file })
      } catch (error) {
        this.diagnostics.push({
          chain: context.chain.slice(),
          import: parsed.url,
          reason: error.message,
          type: 'import-failed'
        })
        return
      }
    }

    this.walk(imported, { chain, conditions, layer })
  }

  layerAtRule(atRule, context) {
    let tokens = preludeTokens(atRule.params).filter(i => !isSpace(i))
    let isBlock = Boolean(atRule.nodes)
    if (tokens.length === 0) {
      if (isBlock) {
        let layer = this.createAnonymous(context, atRule)
        this.walk(atRule, {
          chain: context.chain,
          conditions: context.conditions,
          layer
        })
      }
      return
    }
    let names = layerNameGroups(tokens)
    let declared = []
    for (let raw of names) {
      declared.push(this.declareLayer(splitLayerName(raw), context, atRule))
    }
    if (isBlock) {
      this.walk(atRule, {
        chain: context.chain,
        conditions: context.conditions,
        layer: names.length === 1 ? declared[0] : context.layer
      })
    }
  }

  recordCondition(type, query) {
    for (let condition of this.conditions) {
      if (condition.type === type && condition.query === query) return condition
    }
    let condition = { query, state: this.resolveCondition(type, query), type }
    this.conditions.push(condition)
    return condition
  }

  resolveCondition(type, query) {
    let conditions = this.options.conditions
    let value
    if (typeof conditions === 'function') {
      value = conditions(type, query)
    } else if (conditions && typeof conditions === 'object') {
      if (type + ' ' + query in conditions) {
        value = conditions[type + ' ' + query]
      } else if (query in conditions) {
        value = conditions[query]
      }
    }
    if (value === undefined) return 'unknown'
    return Boolean(value)
  }

  walk(container, context) {
    if (!container.nodes) return
    for (let child of container.nodes) {
      if (child.type === 'atrule') {
        let name = child.name.toLowerCase()
        if (name === 'layer') {
          this.layerAtRule(child, context)
        } else if (name === 'import') {
          this.importAtRule(child, context)
        } else if (name === 'media' || name === 'supports') {
          let condition = this.recordCondition(name, child.params)
          this.walk(child, {
            chain: context.chain,
            conditions: context.conditions.concat([condition]),
            layer: context.layer
          })
        } else {
          this.walk(child, context)
        }
      } else if (child.type === 'decl') {
        this.declaration(child, context)
      } else {
        this.walk(child, context)
      }
    }
  }
}

function analyzeLayers(root, options) {
  return new LayerAnalyzer(options).analyze(root)
}

module.exports = { analyzeLayers, LayerAnalyzer }
module.exports.default = module.exports
