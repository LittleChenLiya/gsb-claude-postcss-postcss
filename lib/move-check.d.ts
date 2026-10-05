import Container from './container.js'
import Node from './node.js'

declare namespace moveCheck {
  /**
   * Describes the cascading context carried by a single at-rule in the
   * parent chain. Named contexts compare by their condition/name;
   * anonymous layers compare by node identity.
   */
  export interface ContextDescriptor {
    /**
     * The at-rule that carries this context.
     */
    node: Node

    /**
     * The context kind.
     */
    kind: 'media' | 'supports' | 'layer'

    /**
     * The media/supports condition. Present for media and supports.
     */
    condition?: string

    /**
     * The layer name. Present for named layers; `null` for anonymous
     * layers, whose identity is the node itself.
     */
    name?: string | null

    /**
     * `true` for anonymous `@layer` blocks (no name). Two anonymous
     * layers with identical params are never equal.
     */
    anonymous?: boolean
  }

  /**
   * A single context change detected by the precheck.
   */
  export interface Risk {
    /**
     * The changed context kind.
     */
    type: 'media' | 'supports' | 'layer' | 'cycle'

    /**
     * Human-readable description of the change.
     */
    message: string

    /**
     * The old context descriptor, or `null` if the context was added.
     */
    old: ContextDescriptor | null

    /**
     * The new context descriptor, or `null` if the context was removed.
     */
    new: ContextDescriptor | null

    /**
     * The node being moved (for source traceability).
     */
    node: Node

    /**
     * Source position of the moved node.
     */
    source: Node.Source | null

    /**
     * Layer order explanation. Present only for layer risks.
     */
    layerOrder?: string
  }

  /**
   * A location in the tree: the parent, the index within it, and the
   * source position of the node.
   */
  export interface Location {
    parent: Container | undefined
    index: number
    source: Node.Source | null
  }

  /**
   * The move plan: which node would move and from/to where.
   */
  export interface Plan {
    /**
     * The node that would be moved.
     */
    node: Node

    /**
     * The current location.
     */
    from: Location

    /**
     * The proposed location.
     */
    to: Location
  }

  /**
   * The result of a move precheck.
   */
  export interface Report {
    /**
     * `true` if no context changes were detected.
     */
    safe: boolean

    /**
     * The list of context changes (and other risks, such as cycles).
     */
    risks: Risk[]

    /**
     * The move plan.
     */
    plan: Plan
  }

  /**
   * Options for positioning the moved node.
   */
  export interface Options {
    /**
     * Insert before the target node (when target is a child).
     */
    before?: boolean

    /**
     * Insert after the target node (when target is a child).
     */
    after?: boolean

    /**
     * Insert at this index within the target container.
     */
    index?: number
  }
}

/**
 * Precheck a rule move without performing it. Compares the old and new
 * parent at-rule chains and reports whether the move changes the media,
 * supports, or layer context. Returns a plan plus risks; the node is
 * never modified.
 *
 * ```js
 * const report = postcss.moveCheck(rule, mediaB)
 * if (!report.safe) {
 *   console.log(report.risks)
 * }
 * ```
 *
 * @param node The node to move.
 * @param target The new parent container, or a child node to insert
 *   before/after.
 * @param opts Positioning options.
 * @return The move report.
 */
declare function moveCheck(
  node: Node,
  target: Node,
  opts?: moveCheck.Options
): moveCheck.Report

export = moveCheck
