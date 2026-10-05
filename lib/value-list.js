'use strict'

/**
 * Error thrown when a declaration value contains an unclosed structure
 * (string, comment or function bracket). Carries the offset of the
 * structure start so callers can point at the exact source position.
 */
class ValueListSyntaxError extends Error {
  constructor(reason, pos, source) {
    super(`${reason} at offset ${pos}`)
    this.name = 'ValueListSyntaxError'
    this.reason = reason
    this.pos = pos
    this.source = source
  }
}

/**
 * Splits a declaration value by top-level commas and keeps the exact
 * source range of every item.
 *
 * Lexical rules:
 * - `\` escapes the next character everywhere outside comments,
 *   so `a\,b` is a single item and the escape bytes are preserved.
 * - commas inside `"..."`, `'...'`, `/* ... *\/` and nested `(...)`
 *   never split the list.
 * - an unclosed string, comment or bracket throws ValueListSyntaxError
 *   positioned at the structure start; no partial list is delivered.
 *
 * @param {string} value Declaration value to read.
 * @return {Array<{ value: string, start: number, end: number }>}
 *   Items with raw (untrimmed) text and [start, end) offsets into `value`.
 */
function parse(value) {
  if (typeof value !== 'string') return []

  let items = []
  let itemStart = 0
  let depth = 0
  let brackets = []
  let i = 0
  let n = value.length

  while (i < n) {
    let ch = value[i]

    if (ch === '\\') {
      i += 2
      continue
    }

    if (ch === '"' || ch === "'") {
      let quoteStart = i
      i += 1
      while (i < n && value[i] !== ch) {
        i += value[i] === '\\' ? 2 : 1
      }
      if (i >= n) {
        throw new ValueListSyntaxError('Unclosed quote', quoteStart, value)
      }
      i += 1
      continue
    }

    if (ch === '/' && value[i + 1] === '*') {
      let commentStart = i
      let end = value.indexOf('*/', i + 2)
      if (end === -1) {
        throw new ValueListSyntaxError('Unclosed comment', commentStart, value)
      }
      i = end + 2
      continue
    }

    if (ch === '(') {
      depth += 1
      brackets.push(i)
      i += 1
      continue
    }

    if (ch === ')') {
      if (depth > 0) {
        depth -= 1
        brackets.pop()
      }
      i += 1
      continue
    }

    if (ch === ',' && depth === 0) {
      items.push({ end: i, start: itemStart, value: value.slice(itemStart, i) })
      itemStart = i + 1
    }

    i += 1
  }

  if (depth > 0) {
    throw new ValueListSyntaxError(
      'Unclosed function bracket',
      brackets[brackets.length - 1],
      value
    )
  }

  items.push({ end: n, start: itemStart, value: value.slice(itemStart) })
  return items
}

/**
 * Replaces the item at `index` with `text`. Every byte outside the item
 * range (other items, commas, whitespace, comments) is kept untouched.
 *
 * @param {string} value Original declaration value.
 * @param {number} index Zero-based item index.
 * @param {string} text Replacement text.
 * @return {string} New value string.
 */
function replace(value, index, text) {
  let items = parse(value)
  if (index < 0 || index >= items.length) {
    throw new RangeError(
      `Item index ${index} is out of range (0..${items.length - 1})`
    )
  }
  let item = items[index]
  return value.slice(0, item.start) + text + value.slice(item.end)
}

/**
 * Replaces the item at `index` inside a PostCSS declaration node.
 * Only `decl.value` is reassigned; `decl.source`, `decl.raws` and every
 * other meta field of the node are left untouched.
 *
 * @param {object} decl PostCSS declaration (or any object with a string `value`).
 * @param {number} index Zero-based item index.
 * @param {string} text Replacement text.
 * @return {object} The same declaration node.
 */
function replaceInDecl(decl, index, text) {
  decl.value = replace(decl.value, index, text)
  return decl
}

module.exports = {
  parse,
  replace,
  replaceInDecl,
  ValueListSyntaxError
}
module.exports.default = module.exports
