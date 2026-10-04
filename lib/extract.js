'use strict'

let Rule = require('./rule')

// A blank line is two line breaks separated only by horizontal whitespace.
const BLANK_LINE = /\n[ \t]*\n/

function hasBlankLine(node) {
  let before = node.raws && node.raws.before
  return typeof before === 'string' && BLANK_LINE.test(before)
}

// The first node moved into a new rule may carry a leading blank line that
// only made sense in its old position. Collapse it to a single line break so
// the new rule does not start with an empty line.
function stripLeadingBlankLines(before) {
  if (typeof before !== 'string') return before
  return before.replace(/^\n(?:[ \t]*\n)+/, '\n')
}

function isRule(node) {
  return node && node.type === 'rule'
}

function isDeclaration(node) {
  return node && node.type === 'decl'
}

function isComment(node) {
  return node && node.type === 'comment'
}

function fail(message) {
  let error = new Error(message)
  error.name = 'ExtractionError'
  throw error
}

function findDeclaration(rule, prop) {
  for (let node of rule.nodes) {
    if (isDeclaration(node) && node.prop === prop) return node
  }
  return undefined
}

/**
 * Plan the extraction of declarations from `rule` into a new rule with
 * `selector`.
 *
 * The plan is fully validated before any node is moved. If a declaration
 * does not exist in the rule, or a node passed in belongs to a different
 * rule, the whole plan is rejected and the tree is left untouched.
 *
 * Comment ownership:
 *
 *   - A chain of comments immediately preceding a declaration moves together
 *     with that declaration. The chain is broken by a blank line: a comment
 *     separated from the declaration (or from the next comment) by a blank
 *     line does not move.
 *   - A standalone description at the start of the rule, and comments
 *     flanked by blank lines, stay in the original rule.
 *
 * Returns an object with `apply()`, which performs the move and returns the
 * new rule.
 */
function extract(rule, selector, props) {
  if (!isRule(rule)) {
    fail('Extraction target must be a rule node')
  }
  if (typeof selector !== 'string' || selector.trim() === '') {
    fail('Extraction selector must be a non-empty string')
  }
  if (!Array.isArray(props) || props.length === 0) {
    fail('Extraction requires at least one declaration to move')
  }
  if (!rule.parent) {
    fail('Extraction target rule must belong to a tree')
  }

  // Phase 1: validate ownership. Nothing is moved until every declaration
  // is confirmed to be a direct child of the specified rule.
  let decls = []
  let seen = new Set()
  for (let prop of props) {
    let decl
    if (typeof prop === 'string') {
      decl = findDeclaration(rule, prop)
      if (!decl) {
        fail('Declaration "' + prop + '" was not found in the rule')
      }
    } else if (isDeclaration(prop)) {
        decl = prop
        if (decl.parent !== rule) {
          fail(
            'Declaration "' +
              decl.prop +
              '" does not belong to the specified rule'
          )
        }
    } else {
      fail('Extraction props must be prop names or declaration nodes')
    }
    if (!seen.has(decl)) {
      seen.add(decl)
      decls.push(decl)
    }
  }

  // Phase 2: build comment ownership groups. A comment chain attaches to the
  // next declaration only when there is no blank line between them.
  let groups = []
  let pending = []
  for (let node of rule.nodes) {
    if (isComment(node)) {
      pending = hasBlankLine(node) ? [node] : pending.concat(node)
    } else if (isDeclaration(node)) {
      groups.push({
        comments: hasBlankLine(node) ? [] : pending,
        decl: node
      })
      pending = []
    }
  }

  let planned = decls.map(decl => {
    let group = groups.find(i => i.decl === decl)
    return { comments: group ? group.comments : [], decl }
  })

  return {
    apply() {
      let extracted = new Rule({ selector, source: rule.source })
      extracted.raws = { ...rule.raws }
      delete extracted.raws.before

      for (let i = 0; i < planned.length; i++) {
        let { comments, decl } = planned[i]
        for (let comment of comments) comment.remove()
        decl.remove()
        if (i === 0) {
          if (comments.length > 0) {
            comments[0].raws.before = stripLeadingBlankLines(
              comments[0].raws.before
            )
          } else {
            decl.raws.before = stripLeadingBlankLines(decl.raws.before)
          }
        }
        extracted.append(...comments, decl)
      }

      rule.parent.insertAfter(rule, extracted)
      return extracted
    },
    declarations: planned.map(i => i.decl),
    rule,
    selector
  }
}

module.exports = extract
module.exports.default = extract
