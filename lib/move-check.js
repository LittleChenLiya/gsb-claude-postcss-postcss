'use strict'

// At-rule kinds that carry cascading context. A move that changes any of
// these between the old and the new parent chain is a risk.
const CONTEXT_KINDS = ['media', 'supports', 'layer']

function isContextAtRule(node) {
  return (
    node != null &&
    node.type === 'atrule' &&
    CONTEXT_KINDS.indexOf(node.name) !== -1
  )
}

// Build a comparable descriptor for an at-rule that carries cascading
// context. Named contexts compare by their condition/name; anonymous
// layers compare by node identity, so two anonymous @layer blocks with
// identical params are never treated as the same layer.
function contextDescriptor(atRule) {
  if (atRule.name === 'layer') {
    let name = (atRule.params || '').trim()
    if (name) {
      return { kind: 'layer', name, node: atRule }
    }
    return { anonymous: true, kind: 'layer', name: null, node: atRule }
  }
  return { condition: atRule.params, kind: atRule.name, node: atRule }
}

// Walk from `start` up to the root, collecting context at-rules. The
// returned list is ordered from the nearest ancestor outward.
function contextChainFrom(start) {
  let chain = []
  let current = start
  while (current) {
    if (isContextAtRule(current)) {
      chain.push(contextDescriptor(current))
    }
    current = current.parent
  }
  return chain
}

function contextEqual(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind === 'layer') {
    if (a.name !== b.name) return false
    // Anonymous layers have no name; identity is the only stable key.
    if (a.name === null) return a.node === b.node
    return true
  }
  return a.condition === b.condition
}

function sourceOf(node) {
  if (!node || !node.source) return null
  return {
    end: node.source.end || null,
    input: node.source.input ? node.source.input.from : undefined,
    start: node.source.start || null
  }
}

function describeContext(ctx) {
  if (!ctx) return '(none)'
  if (ctx.kind === 'layer') {
    return ctx.name ? '@layer ' + ctx.name : '@layer (anonymous)'
  }
  return '@' + ctx.kind + ' ' + ctx.condition
}

// Layer order is part of the cascade: unlayered styles have the lowest
// priority and layers are ordered by their first declaration. Moving a
// rule to a different layer changes its cascade priority, so we always
// attach this explanation to layer risks.
const LAYER_ORDER_NOTE =
  'Layer order determines cascade priority: layers are ordered by first ' +
  'declaration and unlayered styles have the lowest priority. Moving this ' +
  'rule to a different layer changes its cascade priority.'

function makeRisk(type, message, oldCtx, newCtx, movedNode) {
  let risk = {
    message,
    new: newCtx,
    node: movedNode,
    old: oldCtx,
    source: sourceOf(movedNode),
    type
  }
  if (type === 'layer') {
    risk.layerOrder = LAYER_ORDER_NOTE
  }
  return risk
}

function compareChains(oldChain, newChain, movedNode) {
  let risks = []
  let len = Math.max(oldChain.length, newChain.length)
  for (let i = 0; i < len; i++) {
    let oldCtx = oldChain[i]
    let newCtx = newChain[i]
    if (!oldCtx && newCtx) {
      risks.push(
        makeRisk(
          newCtx.kind,
          'Context added: ' + describeContext(newCtx),
          null,
          newCtx,
          movedNode
        )
      )
    } else if (oldCtx && !newCtx) {
      risks.push(
        makeRisk(
          oldCtx.kind,
          'Context removed: ' + describeContext(oldCtx),
          oldCtx,
          null,
          movedNode
        )
      )
    } else if (!contextEqual(oldCtx, newCtx)) {
      risks.push(
        makeRisk(
          oldCtx.kind,
          'Context changed: ' +
            describeContext(oldCtx) +
            ' -> ' +
            describeContext(newCtx),
          oldCtx,
          newCtx,
          movedNode
        )
      )
    }
  }
  return risks
}

function isDescendant(ancestor, node) {
  let current = node.parent
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function resolveTarget(node, target, opts) {
  let newParent
  let newIndex
  if (
    target.type === 'root' ||
    target.type === 'document' ||
    target.type === 'atrule'
  ) {
    // Target is a container: the node would be appended (or inserted at
    // opts.index) into it.
    newParent = target
    if (opts.index != null) {
      newIndex = opts.index
    } else {
      newIndex = target.proxyOf.nodes ? target.proxyOf.nodes.length : 0
    }
  } else if (target.parent) {
    // Target is a child node: the node would be inserted before/after it
    // in the same parent.
    newParent = target.parent
    if (opts.before) {
      newIndex = newParent.index(target)
    } else if (opts.after) {
      newIndex = newParent.index(target) + 1
    } else if (opts.index != null) {
      newIndex = opts.index
    } else {
      newIndex = newParent.proxyOf.nodes ? newParent.proxyOf.nodes.length : 0
    }
  } else {
    throw new Error(
      'moveCheck: target must be a container or a child of a container'
    )
  }
  return { newIndex, newParent }
}

// Precheck a rule move without performing it. Compares the old and new
// parent at-rule chains and reports whether the move changes the media,
// supports, or layer context. Returns a plan plus risks; the node is
// never modified.
function moveCheck(node, target, opts = {}) {
  if (!node || !node.type) {
    throw new Error('moveCheck: node must be a PostCSS node')
  }
  if (!target || !target.type) {
    throw new Error('moveCheck: target must be a PostCSS node')
  }

  let oldParent = node.parent
  let oldIndex = oldParent ? oldParent.index(node) : -1

  let { newIndex, newParent } = resolveTarget(node, target, opts)

  let plan = {
    from: { index: oldIndex, parent: oldParent, source: sourceOf(node) },
    node,
    to: { index: newIndex, parent: newParent, source: sourceOf(node) }
  }

  // Moving a node into itself or into a descendant would create a cycle.
  if (
    target === node ||
    isDescendant(node, target) ||
    newParent === node ||
    isDescendant(node, newParent)
  ) {
    return {
      plan,
      risks: [
        {
          message: 'Cannot move a node into itself (would create a cycle)',
          new: null,
          node,
          old: null,
          source: sourceOf(node),
          type: 'cycle'
        }
      ],
      safe: false
    }
  }

  let oldChain = oldParent ? contextChainFrom(oldParent) : []
  let newChain = contextChainFrom(newParent)

  let risks = compareChains(oldChain, newChain, node)

  return { plan, risks, safe: risks.length === 0 }
}

module.exports = moveCheck
module.exports.default = moveCheck
