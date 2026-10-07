import { NewChild } from './container.js'
import { ChildNode } from './node.js'
import Root from './root.js'

declare namespace Transaction {
  export interface Operation {
    /**
     * Nodes to insert or to use as a replacement
     * (empty for `remove` operations).
     */
    nodes: NewChild[]

    /**
     * The node this operation will be applied to on `commit()`.
     */
    target: ChildNode

    /**
     * Operation kind.
     */
    type: 'insertAfter' | 'insertBefore' | 'remove' | 'replace'
  }

  export type State = 'committed' | 'open' | 'rolled back'

  export { Transaction_ as default }
}

/**
 * An explicit edit transaction for a `Root` node.
 *
 * The transaction records `replace`, `insertBefore`, `insertAfter`
 * and `remove` operations without touching the tree. On `commit()`
 * it validates that every target still belongs to the root and that
 * operations do not conflict with each other, and only then applies
 * all operations at once. On any validation error the tree is left
 * untouched: parent pointers, `raws` and traversal indexes keep
 * their original values.
 *
 * ```js
 * const tx = root.transaction()
 * tx.replace(decl, decl.clone({ value: 'rgba(0, 0, 0, 0.5)' }))
 * tx.insertBefore(decl, fallback)
 * tx.commit()
 * ```
 */
declare class Transaction_ {
  /**
   * `true` while the transaction accepts new operations.
   */
  readonly active: boolean

  /**
   * Recorded operations in the order they were added.
   */
  readonly ops: Transaction.Operation[]

  /**
   * The root node this transaction was started on.
   */
  readonly root: Root

  /**
   * Transaction state: `open`, `committed` or `rolled back`.
   */
  readonly state: Transaction.State

  /**
   * Creates a transaction bound to the given root.
   *
   * @param root Root node to edit.
   */
  constructor(root: Root)

  /**
   * Validates all recorded operations and applies them to the tree.
   *
   * Throws a locatable `CssSyntaxError` (with `postcssNode` set)
   * if a target was detached from the root, if two operations edit
   * the same node, if an operation edits a descendant of a removed
   * subtree, or if an inserted node belongs to another root.
   * On error the tree is left untouched.
   *
   * @return The transaction root.
   */
  commit(): Root

  /**
   * Records an insertion after the target node.
   *
   * @param target Node to insert after.
   * @param nodes  Nodes to insert.
   * @return Transaction to chain operation recording.
   */
  insertAfter(target: ChildNode, ...nodes: NewChild[]): this

  /**
   * Records an insertion before the target node.
   *
   * @param target Node to insert before.
   * @param nodes  Nodes to insert.
   * @return Transaction to chain operation recording.
   */
  insertBefore(target: ChildNode, ...nodes: NewChild[]): this

  /**
   * Records a removal of the target node.
   *
   * @param target Node to remove.
   * @return Transaction to chain operation recording.
   */
  remove(target: ChildNode): this

  /**
   * Records a replacement of the target node.
   *
   * @param target Node to replace.
   * @param nodes  Nodes to put instead of the target.
   * @return Transaction to chain operation recording.
   */
  replace(target: ChildNode, ...nodes: NewChild[]): this

  /**
   * Discards all recorded operations without changing the tree.
   *
   * @return The transaction root.
   */
  rollback(): Root
}

declare class Transaction extends Transaction_ {}

export = Transaction
