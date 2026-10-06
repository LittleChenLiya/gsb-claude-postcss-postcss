import Input from './input.js'
import Node from './node.js'
import Root from './root.js'

declare namespace PositionIndex {
  export interface PositionMatch {
    /**
     * UTF-8 byte offset (exclusive) of the end of the found node
     * in its source input.
     */
    end: number

    /**
     * The innermost node containing the queried byte offset.
     */
    node: Node

    /**
     * Ancestors of `node`, starting from the `Root` down to the direct
     * parent of `node`. Empty when `node` is the root itself.
     */
    parents: Node[]

    /**
     * UTF-8 byte offset (inclusive) of the start of the found node
     * in its source input.
     */
    start: number
  }

  export interface ByteRange {
    /**
     * UTF-8 byte offset (exclusive) of the node end in its source input.
     */
    end: number

    /**
     * UTF-8 byte offset (inclusive) of the node start in its source input.
     */
    start: number
  }

  export { PositionIndex_ as default }
}

/**
 * A read-only index to find PostCSS nodes by UTF-8 byte offset
 * in the source file.
 *
 * ```js
 * const root = postcss.parse(css)
 * const match = root.positionIndex.find(byteOffset)
 * if (match) {
 *   console.log(match.node)     // innermost node at that byte
 *   console.log(match.parents)  // chain from Root to its parent
 * }
 * ```
 *
 * The index is cached on the `Root` and is rebuilt automatically
 * after the tree is changed through `Container` methods.
 */
declare class PositionIndex_ {
  /**
   * All source inputs used by nodes in the indexed tree.
   */
  readonly inputs: Input[]

  /**
   * The root this index was built for.
   */
  readonly root: Root

  /**
   * `true` if the tree was mutated after this index was built
   * and the index no longer reflects the current tree.
   */
  readonly stale: boolean

  constructor(root: Root)

  /**
   * Finds the innermost node containing the given UTF-8 byte offset.
   * Ranges are left-closed, right-open: a node contains offsets
   * `[start, end)` of its own byte range.
   *
   * Positions inside whitespace between nodes resolve to the closest
   * ancestor container; positions inside comments resolve to the
   * `Comment` node.
   *
   * @param byteOffset UTF-8 byte offset in the source input.
   * @param input Source input to search in. Optional when the tree
   *              uses a single input; defaults to the root’s input.
   * @return Match with the innermost node and its parent chain,
   *         or `undefined` if the offset is outside of the source.
   */
  find(byteOffset: number, input?: Input): PositionIndex.PositionMatch | undefined

  /**
   * Returns the UTF-8 byte range `[start, end)` of a node
   * in its source input.
   *
   * @param node Node from the indexed tree.
   * @return Byte range or `undefined` if the node has no source
   *         position information.
   */
  rangeOf(node: Node): PositionIndex.ByteRange | undefined
}

declare class PositionIndex extends PositionIndex_ {}

export = PositionIndex
