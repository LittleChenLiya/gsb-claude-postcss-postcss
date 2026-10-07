import Container from './container.js'
import Node from './node.js'
import Root from './root.js'

declare namespace Transaction {
  export interface EditOp {
    /**
     * New nodes (or raw CSS/objects to build them) recorded with the edit.
     */
    adds: Container.NewChild[]

    /**
     * Node the edit is anchored to.
     */
    target: Node

    /**
     * Kind of the recorded edit.
     */
    type: 'after' | 'before' | 'remove' | 'replace'
  }

  export { Transaction_ as default }
}

/**
 * An explicit edit transaction bound to a single `Root`.
 *
 * ```js
 * let tx = root.transaction()
 * tx.replace(decl, decl.clone({ value: 'var(--color)' }))
 * tx.insertBefore(decl, postcss.decl({ prop: 'color', value: 'red' }))
 * tx.commit() // validates all edits and applies them at once
 * ```
 *
 * Recording edits never touches the tree. On `commit()` every target
 * is checked to still belong to the transaction’s root and to not
 * conflict with other edits; only then all edits are applied together.
 * A failed `commit()` or a `rollback()` leaves parent pointers, raws
 * and traversal indexes untouched.
 */
declare class Transaction_ {
  /**
   * Edits recorded so far, in recording order.
   */
  ops: Transaction.EditOp[]

  /**
   * Root the transaction is bound to.
   */
  root: Root

  /**
   * Transaction state: `'active'`, `'committed'` or `'rolled back'`.
   */
  status: 'active' | 'committed' | 'rolled back'

  constructor(root: Root)

  /**
   * Validates all recorded edits and applies them to the tree at once.
   *
   * @return The transaction’s root.
   */
  commit(): Root

  /**
   * Records an insertion right after the anchor node.
   *
   * @param anchor Node to insert after.
   * @param add New child to insert.
   * @return Transaction for chaining.
   */
  insertAfter(anchor: Node, add: Container.NewChild): this

  /**
   * Records an insertion right before the anchor node.
   *
   * @param anchor Node to insert before.
   * @param add New child to insert.
   * @return Transaction for chaining.
   */
  insertBefore(anchor: Node, add: Container.NewChild): this

  /**
   * Records a removal of the node from the tree.
   *
   * @param target Node to remove.
   * @return Transaction for chaining.
   */
  remove(target: Node): this

  /**
   * Records a replacement of the node by new nodes.
   *
   * @param target Node to replace.
   * @param adds New children to put instead of the node.
   * @return Transaction for chaining.
   */
  replace(target: Node, ...adds: Container.NewChild[]): this

  /**
   * Discards all recorded edits without touching the tree.
   *
   * @return Transaction for chaining.
   */
  rollback(): this
}

declare class Transaction extends Transaction_ {}

export = Transaction
