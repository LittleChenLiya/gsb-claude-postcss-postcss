'use strict'

let CssSyntaxError = require('./css-syntax-error')

function isNode(value) {
  return Boolean(value) && typeof value === 'object' && Boolean(value.type)
}

function topmost(node) {
  let current = node
  while (current.parent) current = current.parent
  return current
}

class Transaction {
  get active() {
    return this.state === 'open'
  }

  constructor(root) {
    if (!root || root.type !== 'root') {
      throw new Error('Transaction can be started only on a Root node')
    }
    this.root = root.proxyOf || root
    this.ops = []
    this.state = 'open'
  }

  _apply(op) {
    let target = op.target
    if (op.type === 'remove') {
      target.remove()
    } else if (op.type === 'replace') {
      target.replaceWith(...op.nodes)
    } else if (op.type === 'insertBefore') {
      for (let add of op.nodes) target.parent.insertBefore(target, add)
    } else {
      for (let i = op.nodes.length - 1; i >= 0; i--) {
        target.parent.insertAfter(target, op.nodes[i])
      }
    }
  }

  _assertOpen() {
    if (this.state !== 'open') {
      throw new Error(`Transaction is already ${this.state}`)
    }
  }

  _belongsToRoot(node) {
    let current = node
    while (current) {
      if (current === this.root) return true
      current = current.parent
    }
    return false
  }

  _checkAdd(op, add) {
    if (Array.isArray(add)) {
      for (let item of add) this._checkAdd(op, item)
      return
    }
    if (typeof add === 'string' || typeof add === 'undefined') return
    if (isNode(add)) {
      let node = add.proxyOf || add
      if (node.parent && topmost(node) !== this.root) {
        throw this._error(
          `Transaction ${this._opName(op)} can not move a node ` +
            'from another root',
          node
        )
      }
      return
    }
    if (add && typeof add === 'object') {
      if (add.prop) {
        if (typeof add.value === 'undefined') {
          throw this._error(
            'Value field is missed in node creation ' +
              `in transaction ${this._opName(op)}`,
            op.target
          )
        }
        return
      }
      if (add.selector || add.selectors || add.name || add.text) return
    }
    throw this._error(
      `Unknown node type in node creation in transaction ${this._opName(op)}`,
      op.target
    )
  }

  _error(message, node) {
    let error
    if (node && node.source && typeof node.error === 'function') {
      error = node.error(message)
    } else {
      error = new CssSyntaxError(message)
    }
    if (node && !error.postcssNode) error.postcssNode = node
    return error
  }

  _isInside(node, ancestor) {
    let current = node.parent
    while (current) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }

  _opName(op) {
    return `#${op.index + 1} ${op.type}`
  }

  _record(type, target, nodes) {
    this._assertOpen()
    if (!isNode(target)) {
      throw new Error('Transaction target must be a PostCSS node')
    }
    if (nodes.length === 1 && Array.isArray(nodes[0])) nodes = nodes[0]
    this.ops.push({ nodes, target: target.proxyOf || target, type })
    return this
  }

  _validate() {
    let byTarget = new Map()
    let removed = []
    this.ops.forEach((op, index) => {
      op.index = index
      if (!this._belongsToRoot(op.target)) {
        throw this._error(
          `Transaction ${this._opName(op)} target ` +
            'is not attached to the transaction root',
          op.target
        )
      }
      let previous = byTarget.get(op.target)
      if (previous) {
        throw this._error(
          `Conflicting transaction operations ${this._opName(previous)} ` +
            `and ${this._opName(op)} on the same node`,
          op.target
        )
      }
      byTarget.set(op.target, op)
      if (op.type === 'remove') removed.push(op)
      for (let add of op.nodes) this._checkAdd(op, add)
    })
    for (let op of this.ops) {
      for (let ancestor of removed) {
        if (
          op.target !== ancestor.target &&
          this._isInside(op.target, ancestor.target)
        ) {
          throw this._error(
            `Transaction ${this._opName(op)} targets a node inside ` +
              `the subtree removed by ${this._opName(ancestor)}`,
            op.target
          )
        }
      }
    }
  }

  commit() {
    this._assertOpen()
    this._validate()
    for (let op of this.ops) this._apply(op)
    this.ops = []
    this.state = 'committed'
    return this.root
  }

  insertAfter(target, ...nodes) {
    return this._record('insertAfter', target, nodes)
  }

  insertBefore(target, ...nodes) {
    return this._record('insertBefore', target, nodes)
  }

  remove(target) {
    return this._record('remove', target, [])
  }

  replace(target, ...nodes) {
    return this._record('replace', target, nodes)
  }

  rollback() {
    this._assertOpen()
    this.ops = []
    this.state = 'rolled back'
    return this.root
  }
}

module.exports = Transaction
Transaction.default = Transaction
