'use strict'

// Root -> Set of its live indexes; the count keeps parser paths cheap.
let indexesByRoot = new WeakMap()
let globalIndexCount = 0

// Input -> UTF-16 code-unit index to UTF-8 byte offsets.
let byteMapsByInput = new WeakMap()

function buildByteOffsetMap(css) {
  let before = new Uint32Array(css.length + 1)
  let bytes = 0
  for (let i = 0; i < css.length; i++) {
    before[i] = bytes
    let code = css.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      let next = css.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        before[i + 1] = bytes
        i += 1
        before[i] = bytes
        bytes += 4
        continue
      }
    }
    let charBytes = 3
    if (code < 0x80) {
      charBytes = 1
    } else if (code < 0x800) {
      charBytes = 2
    }
    bytes += charBytes
  }
  before[css.length] = bytes
  return before
}

function invalidateFrom(container) {
  if (globalIndexCount === 0) return
  let indexes = indexesByRoot.get(container.root())
  if (indexes) for (let index of indexes) index.stale = true
}

function sourceRange(node, map, input) {
  let source = node.source
  if (!source || source.input !== input || !source.start || !source.end) {
    return undefined
  }
  return [map[source.start.offset], map[source.end.offset]]
}

function byteOffsetsFor(input) {
  let map = byteMapsByInput.get(input)
  if (!map) {
    map = buildByteOffsetMap(input.css)
    byteMapsByInput.set(input, map)
  }
  return map
}

// Read-only UTF-8 byte position -> innermost node + parent chain snapshot.
// Created via Root#createPositionIndex() or cached root.positionIndex.
class PositionIndex {
  constructor(root) {
    this.root = root
    this.stale = false
    this.inputs = new Map()
    this.build()
    let indexes = indexesByRoot.get(root) || new Set()
    indexesByRoot.set(root, indexes)
    indexes.add(this)
    globalIndexCount++
  }

  build() {
    this.inputs.clear()
    let stack = [[this.root, 0]]
    while (stack.length > 0) {
      let [node, depth] = stack.pop()
      let source = node.source
      if (source && source.input) {
        let input = source.input
        let records = this.inputs.get(input)
        if (!records) this.inputs.set(input, (records = []))
        let offsets = sourceRange(node, byteOffsetsFor(input), input)
        if (offsets) {
          records.push({ depth, end: offsets[1], node, start: offsets[0] })
        }
      }
      if (node.nodes) {
        for (let child of node.nodes) stack.push([child, depth + 1])
      }
    }
    // Deepest last on tied starts: find() takes the rightmost record.
    for (let records of this.inputs.values()) {
      records.sort((a, b) =>
        a.start === b.start ? a.depth - b.depth : a.start - b.start
      )
      records.starts = records.map(record => record.start)
    }
  }

  // Innermost node covering a UTF-8 byte offset, with its parent chain.
  // Whitespace/comments resolve via real ranges; a node's exclusive end
  // is covered (EOF resolves); uncovered gaps return null.
  find(position, input) {
    if (this.stale) {
      throw new Error('PositionIndex is stale: rebuild it after AST changes')
    }
    if (!Number.isInteger(position)) {
      throw new RangeError('Position must be an integer, got ' + position)
    }
    if (position < 0) {
      throw new RangeError('Position must not be negative: ' + position)
    }

    let resolved = this.resolveInput(input)
    if (this.inputs.size > 1 && !resolved) {
      throw new Error(
        'The tree contains multiple inputs; pass the input to find().'
      )
    }
    if (!resolved) throw new Error('PositionIndex has no indexed input')

    let records = this.inputs.get(resolved)
    let map = byteOffsetsFor(resolved)
    let byteLength = map[resolved.css.length]
    if (position > byteLength) {
      throw new RangeError(
        position + ' is after the end of input (' + byteLength + ' bytes)'
      )
    }

    // Rightmost record whose start is not after the position.
    let starts = records.starts
    let lo = 0
    let hi = starts.length
    while (lo < hi) {
      let mid = (lo + hi) >> 1
      if (starts[mid] <= position) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return null

    let node = records[lo - 1].node
    while (node) {
      let offsets = sourceRange(node, map, resolved)
      if (offsets && position >= offsets[0] && position <= offsets[1]) {
        let parents = []
        let parent = node.parent
        while (parent && parent !== this.root) {
          parents.unshift(parent)
          parent = parent.parent
        }
        return {
          end: offsets[1],
          input: resolved,
          node,
          parents,
          range: offsets,
          start: offsets[0]
        }
      }
      node = node.parent
    }
    return null
  }

  rebuild() {
    this.build()
    this.stale = false
    return this
  }

  release() {
    let indexes = indexesByRoot.get(this.root)
    if (indexes && indexes.delete(this)) {
      globalIndexCount--
      if (indexes.size === 0) indexesByRoot.delete(this.root)
    }
  }

  resolveInput(input) {
    if (input === undefined) {
      return this.inputs.size === 1
        ? this.inputs.keys().next().value
        : undefined
    }
    for (let candidate of this.inputs.keys()) {
      if (
        candidate === input ||
        candidate.from === input ||
        candidate.file === input ||
        candidate.id === input
      ) {
        return candidate
      }
    }
    return undefined
  }
}

module.exports = PositionIndex
module.exports.default = PositionIndex
module.exports.invalidateFrom = invalidateFrom
