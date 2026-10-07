'use strict'

function asNode(node) {
  if (node && node.proxyOf) return node.proxyOf
  return node
}

function flatNodes(adds, result = []) {
  for (let add of adds) {
    if (Array.isArray(add)) {
      flatNodes(add, result)
    } else {
      result.push(add)
    }
  }
  return result
}

class Transaction {
  constructor(root) {
    this.root = asNode(root)
    this.ops = []
    this.status = 'active'
  }

  _apply() {
    let replacedFirst = new Map()
    let replacedLast = new Map()

    for (let op of this.ops) {
      let target = op.target
      if (op.type === 'remove') {
        target.remove()
      } else if (op.type === 'replace') {
        let parent = target.parent
        let inserted = []
        for (let add of op.adds) {
          let before = parent.index(target)
          parent.insertBefore(target, add)
          inserted.push(...parent.nodes.slice(before, parent.index(target)))
        }
        target.remove()
        if (inserted.length > 0) {
          replacedFirst.set(target, inserted[0])
          replacedLast.set(target, inserted[inserted.length - 1])
        }
      } else if (op.type === 'before') {
        let anchor = replacedFirst.get(target) || target
        anchor.parent.insertBefore(anchor, op.adds[0])
      } else {
        let anchor = replacedLast.get(target) || target
        anchor.parent.insertAfter(anchor, op.adds[0])
      }
    }
  }

  _assertActive(action) {
    if (this.status !== 'active') {
      throw new Error(
        `PostCSS transaction: cannot ${action} in a ${this.status} transaction`
      )
    }
  }

  _validate() {
    let edited = new Map()

    for (let op of this.ops) {
      let target = op.target
      if (!target || typeof target.root !== 'function') {
        throw new Error(
          'PostCSS transaction: edit target is not a PostCSS node'
        )
      }
      if (!target.parent || target.root() !== this.root) {
        throw target.error(
          'PostCSS transaction: target node is not attached ' +
            'to the transaction root'
        )
      }
      if (op.type === 'replace' || op.type === 'remove') {
        if (edited.has(target)) {
          throw target.error(
            `PostCSS transaction: node already has ` +
              `a pending ${edited.get(target).type} edit`
          )
        }
        edited.set(target, op)
      }
    }

    let isInsideEdited = node => {
      let current = node.parent
      while (current) {
        if (edited.has(current)) return true
        current = current.parent
      }
      return false
    }

    for (let op of this.ops) {
      if (isInsideEdited(op.target)) {
        throw op.target.error(
          'PostCSS transaction: cannot edit a node inside ' +
            'a removed or replaced subtree'
        )
      }
      if (op.type === 'before' || op.type === 'after') {
        let anchorEdit = edited.get(op.target)
        if (
          anchorEdit &&
          (anchorEdit.type === 'remove' || anchorEdit.adds.length === 0)
        ) {
          throw op.target.error(
            'PostCSS transaction: cannot insert relative to a removed node'
          )
        }
      }
      for (let add of flatNodes(op.adds)) {
        let node = asNode(add)
        if (
          node &&
          typeof node === 'object' &&
          typeof node.root === 'function' &&
          node.parent
        ) {
          if (node.root() !== this.root) {
            throw node.error(
              'PostCSS transaction: cannot move a node from another root'
            )
          }
          if (isInsideEdited(node)) {
            throw node.error(
              'PostCSS transaction: cannot insert a node from ' +
                'a removed or replaced subtree'
            )
          }
        }
      }
    }
  }

  commit() {
    this._assertActive('commit')
    this._validate()
    this._apply()
    this.status = 'committed'
    return this.root
  }

  insertAfter(anchor, add) {
    this._assertActive('record insertAfter')
    this.ops.push({ adds: [add], target: asNode(anchor), type: 'after' })
    return this
  }

  insertBefore(anchor, add) {
    this._assertActive('record insertBefore')
    this.ops.push({ adds: [add], target: asNode(anchor), type: 'before' })
    return this
  }

  remove(target) {
    this._assertActive('record remove')
    this.ops.push({ adds: [], target: asNode(target), type: 'remove' })
    return this
  }

  replace(target, ...adds) {
    this._assertActive('record replace')
    this.ops.push({ adds, target: asNode(target), type: 'replace' })
    return this
  }

  rollback() {
    this._assertActive('rollback')
    this.ops = []
    this.status = 'rolled back'
    return this
  }
}

module.exports = Transaction
Transaction.default = Transaction
