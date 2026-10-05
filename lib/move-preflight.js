'use strict'

/**
 * Explicit preflight for moving a node (usually a Rule) to a new parent.
 *
 * The preflight walks the real AST ancestor chains of the current parent
 * and of the target parent and reports whether the move would change the
 * media, supports, or cascade-layer context of the node. It only returns
 * a plan with risks: it never moves, clones, or mutates any node, so every
 * node referenced by the plan keeps its original source position.
 */

function positionOf(node) {
  if (node && node.source && node.source.start) {
    let { column, line, offset } = node.source.start
    let position = { column, line }
    if (offset !== undefined) position.offset = offset
    return position
  }
  return null
}

function layerIdentity(atRule) {
  let name = atRule.params.trim()
  if (name === '') {
    // Anonymous cascade layer. Its identity is the AST node itself:
    // two anonymous layers are never equal, even if their (empty)
    // params look identical.
    return { name: null, node: atRule, type: 'anonymous' }
  }
  return { name, node: atRule, type: 'named' }
}

function sameLayer(a, b) {
  if (a.type !== b.type) return false
  if (a.type === 'anonymous') return a.node === b.node
  return a.name === b.name
}

function layerLabel(identity) {
  if (identity.type === 'anonymous') {
    let position = positionOf(identity.node)
    if (position) return `(anonymous layer at ${position.line}:${position.column})`
    return '(anonymous layer)'
  }
  return identity.name
}

function atRuleEntry(atRule) {
  let lower = atRule.name.toLowerCase()
  let entry = {
    kind: 'other',
    name: atRule.name,
    node: atRule,
    params: atRule.params,
    position: positionOf(atRule)
  }
  if (lower === 'media') {
    entry.kind = 'media'
  } else if (lower === 'supports') {
    entry.kind = 'supports'
  } else if (lower === 'layer') {
    entry.kind = 'layer'
    entry.layer = layerIdentity(atRule)
  }
  return entry
}

function chainOf(container) {
  // Real AST at-rule chain of a container (itself included), root-first.
  let chain = []
  let current = container
  while (current) {
    if (current.type === 'atrule') chain.unshift(atRuleEntry(current))
    current = current.parent
  }
  return chain
}

function paramsOf(chain, kind) {
  return chain.filter(entry => entry.kind === kind).map(entry => entry.params)
}

function layersOf(chain) {
  return chain.filter(entry => entry.kind === 'layer').map(entry => entry.layer)
}

function othersOf(chain) {
  return chain
    .filter(entry => entry.kind === 'other')
    .map(entry => `@${entry.name} ${entry.params}`.trim())
}

function equalStrings(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function sameLayerChain(a, b) {
  return a.length === b.length && a.every((layer, i) => sameLayer(layer, b[i]))
}

function diffChains(fromChain, toChain) {
  let changes = []

  for (let kind of ['media', 'supports']) {
    let from = paramsOf(fromChain, kind)
    let to = paramsOf(toChain, kind)
    if (!equalStrings(from, to)) {
      changes.push({
        from,
        message:
          `@${kind} context changes from ` +
          `${from.length ? from.map(i => `"${i}"`).join(' > ') : '(none)'} to ` +
          `${to.length ? to.map(i => `"${i}"`).join(' > ') : '(none)'}: ` +
          `the moved node will match under different ${kind} conditions`,
        to,
        type: kind
      })
    }
  }

  let fromLayers = layersOf(fromChain)
  let toLayers = layersOf(toChain)
  if (!sameLayerChain(fromLayers, toLayers)) {
    let from = fromLayers.map(layerLabel)
    let to = toLayers.map(layerLabel)
    changes.push({
      from,
      message:
        `cascade layer context changes from ` +
        `${from.length ? from.join(' > ') : '(unlayered)'} to ` +
        `${to.length ? to.join(' > ') : '(unlayered)'}: ` +
        `the moved node will cascade in a different layer`,
      to,
      type: 'layer'
    })
  }

  let fromOthers = othersOf(fromChain)
  let toOthers = othersOf(toChain)
  if (!equalStrings(fromOthers, toOthers)) {
    changes.push({
      from: fromOthers,
      message:
        `at-rule context changes from ` +
        `${fromOthers.length ? fromOthers.join(' > ') : '(none)'} to ` +
        `${toOthers.length ? toOthers.join(' > ') : '(none)'}`,
      to: toOthers,
      type: 'atrule'
    })
  }

  return changes
}

function sameSegments(a, b) {
  return a.length === b.length && a.every((segment, i) => segment === b[i])
}

// Cascade layer order of one root: `@layer a, b;` statements and the first
// appearance of every layer define the order. Anonymous layers are tracked
// by node identity, so two anonymous layers never share a slot.
function collectLayerOrder(root) {
  let order = []

  function indexOf(segments) {
    return order.findIndex(entry => sameSegments(entry.segments, segments))
  }

  function labelOf(segments) {
    return segments
      .map(segment => (typeof segment === 'string' ? segment : '(anonymous)'))
      .join('.')
  }

  function register(segments) {
    if (indexOf(segments) === -1) {
      order.push({ label: labelOf(segments), segments })
    }
  }

  function walk(container, prefix) {
    if (!container.nodes) return
    for (let child of container.nodes) {
      if (child.type === 'atrule' && child.name.toLowerCase() === 'layer') {
        let params = child.params.trim()
        let branches
        if (params === '') {
          branches = [[...prefix, child]]
        } else {
          branches = params.split(',').map(name => [...prefix, name.trim()])
        }
        for (let segments of branches) {
          register(segments)
          if (child.nodes) walk(child, segments)
        }
      } else if (
        child.type === 'atrule' ||
        child.type === 'root' ||
        child.type === 'document'
      ) {
        walk(child, prefix)
      }
    }
  }

  walk(root, [])
  return { indexOf, order }
}

function layerSegments(layers) {
  return layers.map(layer => (layer.type === 'anonymous' ? layer.node : layer.name))
}

function describeSegments(segments, collected) {
  if (segments.length === 0) return { index: -1, label: '(unlayered)' }
  return {
    index: collected.indexOf(segments),
    label: segments
      .map(segment => (typeof segment === 'string' ? segment : '(anonymous)'))
      .join('.')
  }
}

function layerOrderInfo(fromRoot, toRoot, fromLayers, toLayers) {
  let sameRoot = fromRoot === toRoot
  let fromOrder = collectLayerOrder(fromRoot)
  let toOrder = sameRoot ? fromOrder : collectLayerOrder(toRoot)

  let fromSegments = layerSegments(fromLayers)
  let toSegments = layerSegments(toLayers)

  let info = {
    changed: false,
    from: describeSegments(fromSegments, fromOrder),
    message: null,
    order: fromOrder.order.map(entry => entry.label),
    to: describeSegments(toSegments, toOrder)
  }
  if (!sameRoot) info.toOrder = toOrder.order.map(entry => entry.label)

  if (!sameSegments(fromSegments, toSegments)) {
    info.changed = true
    let orderNote = sameRoot
      ? `layer order is [${info.order.join(', ') || '(empty)'}]`
      : 'layers live in different roots, each with its own order'
    info.message =
      `cascade layer order changes: ${info.from.label} ` +
      `(position ${info.from.index}) -> ${info.to.label} ` +
      `(position ${info.to.index}); ${orderNote}; ` +
      `later layers beat earlier ones, and unlayered styles beat all layers`
  }

  return info
}

/**
 * Builds a move plan for `node` as if it were moved into `newParent`,
 * without moving anything.
 *
 * @param {object} node Node (usually a rule) to move.
 * @param {object} newParent Target parent container.
 * @return {object} Move plan with `changes`, `risks`, and `layerOrder`.
 */
function movePreflight(node, newParent) {
  if (!node || typeof node.type !== 'string') {
    throw new TypeError('movePreflight() expects a PostCSS node to move')
  }
  if (!newParent || typeof newParent.append !== 'function') {
    throw new TypeError('movePreflight() expects a container as new parent')
  }

  let fromChain = chainOf(node.parent)
  let toChain = chainOf(newParent)

  let changes = diffChains(fromChain, toChain)

  let fromRoot = node.parent ? node.parent.root() : undefined
  let toRoot = newParent.root()
  let layerOrder
  if (fromRoot && toRoot) {
    layerOrder = layerOrderInfo(
      fromRoot,
      toRoot,
      layersOf(fromChain),
      layersOf(toChain)
    )
  } else {
    layerOrder = {
      changed: false,
      from: { index: -1, label: '(unlayered)' },
      message: null,
      order: [],
      to: { index: -1, label: '(unlayered)' }
    }
  }

  let risks = changes.map(change => change.message)
  if (layerOrder.message && !risks.includes(layerOrder.message)) {
    risks.push(layerOrder.message)
  }
  if (fromRoot && toRoot && fromRoot !== toRoot) {
    risks.push(
      'node and new parent belong to different roots/documents: ' +
        'source files and cascade layer orders may differ'
    )
  }

  return {
    changes,
    from: { chain: fromChain, parent: node.parent },
    layerOrder,
    node,
    risks,
    safe: changes.length === 0 && !layerOrder.changed,
    to: { chain: toChain, parent: newParent }
  }
}

module.exports = movePreflight
module.exports.default = movePreflight
