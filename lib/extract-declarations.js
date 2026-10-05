'use strict'

let Rule = require('./rule')

// Two or more consecutive line breaks inside a node's leading whitespace
// mean there is at least one empty line before that node.
const BLANK_LINE = /(\r\n?|\n)[ \t]*(?:\r\n?|\n)/

function hasBlankLine(before) {
  return typeof before === 'string' && BLANK_LINE.test(before)
}

// Collapse the leading blank line(s) of `raws.before`, keeping a single
// line break and the original indentation. This keeps moved groups tidy
// without touching any of the other raws (`between`, `left`, ...).
function dropBlankLine(before) {
  if (typeof before !== 'string') return before
  let match = before.match(/^(?:[ \t]*(?:\r\n?|\n))+/)
  if (!match) return before
  let lines = match[0].split(/\r\n?|\n/)
  return '\n' + lines[lines.length - 1] + before.slice(match[0].length)
}

// Make sure the remaining sibling after a removed group keeps the blank
// line that separated the group from what stayed in the rule.
function withBlankLine(before) {
  if (hasBlankLine(before)) return before
  return before.includes('\n') ? '\n' + before : '\n\n'
}

function realNode(node) {
  return node && node.proxyOf ? node.proxyOf : node
}

function validate(rule, decls) {
  rule = realNode(rule)
  if (!rule || rule.type !== 'rule') {
    throw new TypeError('The first argument must be a Rule node')
  }
  if (!Array.isArray(decls) || decls.length === 0) {
    throw new TypeError('Declarations list must be a non-empty array')
  }
  let chosen = []
  let seen = new Set()
  for (let decl of decls) {
    let real = realNode(decl)
    if (!real || real.type !== 'decl') {
      throw new TypeError(
        'Declarations list must contain only Declaration nodes'
      )
    }
    // Every node must belong to the same target rule; otherwise the whole
    // plan is rejected without touching the AST.
    if (real.parent !== rule) {
      throw new Error(
        'Cannot extract declarations: some nodes do not belong to the target rule'
      )
    }
    if (!seen.has(real)) {
      seen.add(real)
      chosen.push(real)
    }
  }
  return chosen
}

// Resolve which comments are attached to the chosen declarations.
//
// Attribution rules (see docs/guidelines/extract-declarations.md):
//  - A run of comments immediately preceding a declaration belongs to
//    that declaration and moves together with it.
//  - The run is collected backwards until a non-comment node, the rule
//    start, or an empty line in the gap before the run is reached.
//  - Standalone rule-introductory comments and comments separated from
//    the declaration by an empty line stay in the original rule.
function collectMoving(rule, chosen) {
  let nodes = rule.nodes
  let moving = new Set(chosen)

  for (let decl of chosen) {
    // `anchor` is the nearest node already collected for this declaration.
    let anchor = decl
    let i = nodes.indexOf(decl) - 1
    while (i >= 0) {
      let node = nodes[i]
      if (node.type !== 'comment') break
      // Attribution is decided by the gap between the candidate comment
      // and the nearest collected node: an empty line detaches the comment,
      // so rule descriptions and standalone notes stay in place.
      if (hasBlankLine(anchor.raws.before)) break
      moving.add(node)
      anchor = node
      i -= 1
    }
  }

  return moving
}

// Split moving nodes into maximal contiguous runs in source order.
function movingGroups(rule, moving) {
  let groups = []
  let group = null
  for (let node of rule.nodes) {
    if (moving.has(node)) {
      if (!group) {
        group = []
        groups.push(group)
      }
      group.push(node)
    } else {
      group = null
    }
  }
  return groups
}

/**
 * Builds an extraction plan for moving selected declarations out of a rule
 * into a new rule. The plan is computed and fully validated before any node
 * is touched: if any of the passed nodes does not belong to `rule`, the
 * function throws and the AST stays untouched.
 *
 * @param {import('./rule.js')} rule source rule
 * @param {Array<import('./declaration.js')>} decls declarations to extract
 * @param {{ selector?: string }} [opts]
 * @returns {import('./extract-declarations.js').ExtractionPlan}
 */
function planExtraction(rule, decls, opts = {}) {
  let target = realNode(rule)
  let chosen = validate(target, decls)
  if (opts.selector != null && typeof opts.selector !== 'string') {
    throw new TypeError('`selector` option must be a string')
  }

  let moving = collectMoving(target, chosen)
  let groups = movingGroups(target, moving)

  return {
    groups,
    rule: target,
    selector: typeof opts.selector === 'string' ? opts.selector : target.selector
  }
}

/**
 * Applies a plan created by {@link planExtraction}. Nodes move with their
 * original `source` and `raws` intact, so source maps and formatting are
 * preserved.
 *
 * @param {import('./extract-declarations.js').ExtractionPlan} plan
 * @returns {{ from: import('./rule.js'), to: import('./rule.js') }}
 */
function applyExtraction(plan) {
  if (!plan || !plan.rule || !Array.isArray(plan.groups)) {
    throw new TypeError('Invalid extraction plan')
  }
  let rule = plan.rule
  if (!rule.parent) {
    throw new Error('Cannot extract declarations from a detached rule')
  }

  let nodes = rule.nodes

  // Re-validate ownership: a stale plan must not mutate a changed tree.
  for (let group of plan.groups) {
    for (let node of group) {
      if (node.parent !== rule) {
        throw new Error('Cannot apply extraction plan: nodes changed')
      }
    }
  }

  let moving = new Set()
  for (let group of plan.groups) {
    for (let node of group) moving.add(node)
  }

  // Remember where blank lines must be carried after removal: when a group
  // is flanked by remaining siblings and its run started after a blank
  // line, that empty line belongs to the first sibling left behind.
  let carryTo = []
  for (let group of plan.groups) {
    let first = group[0]
    let last = group[group.length - 1]
    let firstIndex = nodes.indexOf(first)
    let lastIndex = nodes.indexOf(last)
    let remainBefore = firstIndex > 0 ? nodes[firstIndex - 1] : null
    let remainAfter =
      lastIndex < nodes.length - 1 ? nodes[lastIndex + 1] : null
    if (
      remainBefore &&
      remainAfter &&
      !moving.has(remainAfter) &&
      hasBlankLine(first.raws.before)
    ) {
      carryTo.push(remainAfter)
    }
  }

  // Detach the selected nodes. Removing from the end keeps indices stable.
  let movingOrdered = nodes.filter(i => moving.has(i))
  for (let i = movingOrdered.length - 1; i >= 0; i--) {
    rule.removeChild(movingOrdered[i])
  }

  for (let node of carryTo) {
    if (node.parent === rule) {
      node.raws.before = withBlankLine(node.raws.before)
    }
  }

  // Build the new rule. Copy block raws from the source rule so the output
  // keeps the same formatting; its own `before` comes from the insertion
  // context via `normalize`.
  let newRule = new Rule({ nodes: [], raws: {}, selector: plan.selector })
  for (let key of ['between', 'after', 'ownSemicolon']) {
    if (typeof rule.raws[key] !== 'undefined') {
      newRule.raws[key] = rule.raws[key]
    }
  }
  // Moved declarations were terminated in the source rule (they had
  // siblings); keep them terminated when they land last in the new rule.
  newRule.raws.semicolon = true
  // Map the new selector onto the original rule position for source maps.
  newRule.source = rule.source

  let firstMoved = true
  for (let group of plan.groups) {
    for (let node of group) {
      if (firstMoved) {
        node.raws.before = dropBlankLine(node.raws.before)
        firstMoved = false
      }
      newRule.append(node)
    }
  }

  rule.parent.insertAfter(rule, newRule)

  return { from: rule, to: newRule }
}

module.exports = { applyExtraction, planExtraction }
