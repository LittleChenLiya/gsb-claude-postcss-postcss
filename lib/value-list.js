'use strict'

let CssSyntaxError = require('./css-syntax-error')

const BACKSLASH = '\\'.charCodeAt(0)
const COMMA = ','.charCodeAt(0)
const SINGLE_QUOTE = "'".charCodeAt(0)
const DOUBLE_QUOTE = '"'.charCodeAt(0)
const SLASH = '/'.charCodeAt(0)
const ASTERISK = '*'.charCodeAt(0)
const OPEN_PAREN = '('.charCodeAt(0)
const CLOSE_PAREN = ')'.charCodeAt(0)
const OPEN_SQUARE = '['.charCodeAt(0)
const CLOSE_SQUARE = ']'.charCodeAt(0)

function isWhitespace(code) {
  return (
    code === 0x20 /* space */ ||
    code === 0x0a /* \n */ ||
    code === 0x09 /* \t */ ||
    code === 0x0d /* \r */ ||
    code === 0x0c /* \f */
  )
}

function positionAt(value, offset) {
  let line = 1
  let column = 1
  for (let i = 0; i < offset && i < value.length; i++) {
    if (value.charCodeAt(i) === 0x0a) {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { column, line }
}

function syntaxError(message, value, offset) {
  let pos = positionAt(value, offset)
  let error = new CssSyntaxError(message, pos.line, pos.column, value)
  error.offset = offset
  return error
}

function trimRange(value, start, end) {
  while (start < end && isWhitespace(value.charCodeAt(start))) start += 1
  while (end > start && isWhitespace(value.charCodeAt(end - 1))) end -= 1
  return { end, start }
}

/**
 * Splits a declaration value into top-level comma-separated items,
 * preserving the original byte range of every item.
 *
 * Commas inside strings, comments, functions and nested brackets are not
 * split. CSS escapes (a backslash escaping the next character) and nested
 * parentheses/brackets follow explicit lexical rules. An unclosed string,
 * comment or bracket raises a `CssSyntaxError` pointing at the start of the
 * unclosed structure instead of returning a partial list.
 *
 * @param {string} value Declaration value.
 * @return {Array<{text: string, start: number, end: number}>} Items with
 *   `start`/`end` offsets (exclusive `end`) into the original string.
 */
function parse(value) {
  if (typeof value !== 'string') {
    throw new TypeError(
      'value-list.parse expects a string, got ' + typeof value
    )
  }

  let items = []
  let length = value.length
  let pos = 0
  let spanStart = 0

  let stack = []
  let quote = 0
  let quotePos = -1
  let commentPos = -1

  function pushItem(end) {
    let range = trimRange(value, spanStart, end)
    items.push({
      end: range.end,
      start: range.start,
      text: value.slice(range.start, range.end)
    })
  }

  function fail(message, offset) {
    throw syntaxError(message, value, offset)
  }

  while (pos < length) {
    let code = value.charCodeAt(pos)

    if (quote !== 0) {
      if (code === BACKSLASH) {
        pos += 2
        continue
      }
      if (code === quote) {
        quote = 0
      }
      pos += 1
      continue
    }

    if (commentPos !== -1) {
      if (code === ASTERISK && value.charCodeAt(pos + 1) === SLASH) {
        commentPos = -1
        pos += 2
        continue
      }
      pos += 1
      continue
    }

    if (code === BACKSLASH) {
      pos += 2
      continue
    }

    if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
      quote = code
      quotePos = pos
      pos += 1
      continue
    }

    if (code === SLASH && value.charCodeAt(pos + 1) === ASTERISK) {
      commentPos = pos
      pos += 2
      continue
    }

    if (code === OPEN_PAREN || code === OPEN_SQUARE) {
      stack.push({ char: code, pos })
      pos += 1
      continue
    }

    if (code === CLOSE_PAREN || code === CLOSE_SQUARE) {
      let want = code === CLOSE_PAREN ? OPEN_PAREN : OPEN_SQUARE
      let top = stack[stack.length - 1]
      if (!top || top.char !== want) {
        fail('Unclosed bracket', pos)
      }
      stack.pop()
      pos += 1
      continue
    }

    if (code === COMMA && stack.length === 0) {
      pushItem(pos)
      spanStart = pos + 1
    }

    pos += 1
  }

  if (quote !== 0) {
    fail('Unclosed string', quotePos)
  }
  if (commentPos !== -1) {
    fail('Unclosed comment', commentPos)
  }
  if (stack.length > 0) {
    fail('Unclosed bracket', stack[stack.length - 1].pos)
  }

  pushItem(length)
  return items
}

/**
 * Replaces one top-level item of a declaration value while keeping every
 * other byte of the original string intact.
 *
 * @param {string} value Declaration value.
 * @param {number} index Zero-based item index.
 * @param {string} replacement New item text.
 * @return {string} The value with only the selected item replaced.
 */
function replace(value, index, replacement) {
  if (typeof value !== 'string') {
    throw new TypeError(
      'value-list.replace expects a string, got ' + typeof value
    )
  }
  let items = parse(value)
  if (typeof index !== 'number' || index < 0 || index >= items.length) {
    throw new RangeError(
      'value-list.replace index out of range: ' +
        index +
        ' (0..' +
        (items.length - 1) +
        ')'
    )
  }
  let item = items[index]
  return (
    value.slice(0, item.start) +
    String(replacement) +
    value.slice(item.end)
  )
}

/**
 * Reads the top-level items of a declaration node's value. It only touches
 * `decl.value` and never reads or modifies `decl.source`.
 *
 * @param {import('./declaration')} decl PostCSS declaration node.
 * @return {Array<{text: string, start: number, end: number}>} Items.
 */
function read(decl) {
  return parse(decl.value)
}

module.exports = { parse, read, replace }
module.exports.default = module.exports
