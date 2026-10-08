import Container from './container.js'
import Input from './input.js'
import Node from './node.js'

declare namespace PositionIndex {
  /**
   * The result of {@link PositionIndex#find}: the innermost node covering
   * a UTF-8 byte position, the chain of its parents and the exact
   * half-open UTF-8 byte range that contains the position.
   */
  export interface Match {
    /**
     * Exclusive end of the matched node range, in UTF-8 bytes.
     */
    end: number

    /**
     * The source input the matched node originated from. Useful when the
     * tree contains nodes coming from several inputs.
     */
    input: Input

    /**
     * The innermost node whose source range contains the queried
     * position.
     */
    node: Node

    /**
     * Parent nodes of {@link Match.node}, ordered from the root towards
     * the node’s immediate parent. Empty when the matched node is the
     * root itself.
     */
    parents: Container[]

    /**
     * Half-open UTF-8 byte range `[start, end)` of the matched node.
     */
    range: [number, number]

    /**
     * Inclusive start of the matched node range, in UTF-8 bytes.
     */
    start: number
  }
}

/**
 * Read-only snapshot index that maps a UTF-8 byte position in a CSS
 * source to the innermost AST node covering that position.
 *
 * Ranges are half-open intervals of UTF-8 bytes — not line/column pairs
 * and not UTF-16 code-unit offsets. Positions in whitespace and comments
 * resolve against the real source ranges of AST nodes; a position equal
 * to a node’s exclusive end still resolves to that node, so the position
 * at the end of file maps to the deepest node ending there.
 *
 * Build an index with `Root#createPositionIndex()` (or use the cached
 * `Root#positionIndex`) and query it with `find()`.
 *
 * Any structural change made through the Container API
 * (`append()`, `prepend()`, `insertBefore()`, `insertAfter()`,
 * `removeChild()`, `removeAll()`, …) marks the index stale; call
 * `rebuild()` before querying it again. The cached `Root#positionIndex`
 * rebuilds itself automatically.
 *
 * ```js
 * const root = postcss.parse(css)
 * const index = root.createPositionIndex()
 * const { node, parents, range } = index.find(utf8ByteOffset)
 * ```
 */
declare class PositionIndex {
  /**
   * Root node the index was built from.
   */
  root: import('./root.js')

  /**
   * Is `true` after the tree was modified through the Container API
   * since the index was built or rebuilt.
   */
  stale: boolean

  /**
   * @param root Parsed root node to index.
   */
  constructor(root: import('./root.js'))

  /**
   * Finds the innermost node covering a UTF-8 byte position.
   *
   * @param position UTF-8 byte offset in the source CSS.
   * @param input Source to query. Required when the tree contains nodes
   *   from more than one input; accepts the `Input` instance or its
   *   `from`/`file`/`id`.
   * @return Match, or `null` when the position is outside every indexed
   *   node.
   * @throws When the index is stale, when `position` is negative or
   *   beyond the input byte length, or when an `input` is required but
   *   not provided.
   */
  find(position: number, input?: Input | string): null | PositionIndex.Match

  /**
   * Rebuilds the index from the current tree and clears the stale flag.
   *
   * Nodes parsed from CSS receive real sources and are indexed; nodes
   * built manually without a `source` are not indexed.
   *
   * @return The index itself.
   */
  rebuild(): this

  /**
   * Stops tracking tree mutations for this index. Afterwards the index
   * is not marked stale; use `rebuild()` explicitly.
   */
  release(): void
}

export = PositionIndex
