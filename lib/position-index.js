'use strict'

let { mutationVersion } = require('./symbols')

let inputIndexCache = Symbol('positionIndexInput')

function getInputIndex(input) {
  let cached = input[inputIndexCache]
  if (cached) return cached

  let css = 'document' in input ? input.document : input.css
  let bytes = new Uint32Array(css.length + 1)
  let lines = [0]
  let byte = 0

  for (let i = 0; i < css.length; i++) {
    bytes[i] = byte
    let code = css.charCodeAt(i)
    if (code === 0x0a) lines.push(i + 1)
    if (code < 0x80) {
      byte += 1
    } else if (code < 0x800) {
      byte += 2
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < css.length &&
      css.charCodeAt(i + 1) >= 0xdc00 &&
      css.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes[i + 1] = byte
      byte += 4
      i += 1
    } else {
      byte += 3
    }
  }
  bytes[css.length] = byte

  cached = { bytes, css, length: byte, lines }
  input[inputIndexCache] = cached
  return cached
}

function lineColumnToOffset(index, line, column) {
  let start = index.lines[line - 1]
  if (typeof start !== 'number') return index.css.length
  return Math.min(start + column - 1, index.css.length)
}

function nodeByteRange(index, source) {
  let start = source.start
  let startOffset =
    typeof start.offset === 'number'
      ? start.offset
      : lineColumnToOffset(index, start.line, start.column)

  let endOffset
  if (source.end) {
    if (typeof source.end.offset === 'number') {
      // `source.end.offset` is already exclusive
      endOffset = source.end.offset
    } else {
      // `source.end` line/column is inclusive, convert to exclusive
      endOffset = lineColumnToOffset(index, source.end.line, source.end.column) + 1
    }
  } else {
    endOffset = index.css.length
  }

  return { end: index.bytes[endOffset], start: index.bytes[startOffset] }
}

class PositionIndex {
  get stale() {
    return (this.root[mutationVersion] || 0) !== this.version
  }

  constructor(root) {
    this.root = root
    this.version = root[mutationVersion] || 0

    this.inputs = []
    this.ranges = new Map()

    let inputs = new Set()
    let stack = [root]
    while (stack.length > 0) {
      let node = stack.pop()
      if (node.source && node.source.input && node.source.start) {
        let input = node.source.input
        let range = nodeByteRange(getInputIndex(input), node.source)
        this.ranges.set(node, { end: range.end, input, start: range.start })
        inputs.add(input)
      }
      if (node.nodes) {
        for (let child of node.nodes) stack.push(child)
      }
    }
    this.inputs = Array.from(inputs)
  }

  find(byteOffset, input) {
    if (
      typeof byteOffset !== 'number' ||
      Number.isNaN(byteOffset) ||
      byteOffset < 0
    ) {
      return undefined
    }

    if (!input) {
      if (this.inputs.length === 1) {
        input = this.inputs[0]
      } else if (this.root.source && this.root.source.input) {
        input = this.root.source.input
      }
    }
    if (!input) return undefined

    let index = getInputIndex(input)
    if (byteOffset >= index.length) return undefined

    // The root conceptually spans the whole input, even when its own
    // source comes from another input (e.g. after appending foreign nodes)
    let range = this.ranges.get(this.root)
    if (!range || range.input !== input) {
      range = { end: index.length, input, start: 0 }
    } else if (byteOffset < range.start || byteOffset >= range.end) {
      return undefined
    }

    let node = this.root
    let parents = []
    while (node.nodes) {
      let child
      let childRange
      for (let candidate of node.nodes) {
        let candidateRange = this.ranges.get(candidate)
        if (
          candidateRange &&
          candidateRange.input === input &&
          byteOffset >= candidateRange.start &&
          byteOffset < candidateRange.end &&
          (!childRange ||
            candidateRange.end - candidateRange.start <
              childRange.end - childRange.start)
        ) {
          child = candidate
          childRange = candidateRange
        }
      }
      if (!child) break
      parents.push(node)
      node = child
      range = childRange
    }

    return { end: range.end, node, parents, start: range.start }
  }

  rangeOf(node) {
    let range = this.ranges.get(node)
    if (!range) return undefined
    return { end: range.end, start: range.start }
  }
}

module.exports = PositionIndex
PositionIndex.default = PositionIndex
