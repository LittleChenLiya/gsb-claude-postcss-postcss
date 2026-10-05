import AtRule from './at-rule.js'
import Container from './container.js'
import Node from './node.js'

declare namespace movePreflight {
  export interface LayerIdentity {
    /**
     * Layer name for named layers, `null` for anonymous ones.
     */
    name: null | string

    /**
     * The `@layer` at-rule node this identity belongs to.
     * For anonymous layers this node _is_ the identity:
     * two anonymous layers are never equal.
     */
    node: AtRule

    /**
     * Anonymous layers keep their AST node identity.
     */
    type: 'anonymous' | 'named'
  }

  export interface ChainEntry {
    /**
     * Context group this at-rule belongs to.
     */
    kind: 'layer' | 'media' | 'other' | 'supports'

    /**
     * Layer identity, present only when `kind` is `'layer'`.
     */
    layer?: LayerIdentity

    /**
     * At-rule name as written, for example `media`.
     */
    name: string

    /**
     * The at-rule node itself, so `node.source` stays queryable.
     */
    node: AtRule

    /**
     * At-rule parameters as written.
     */
    params: string

    /**
     * Source start position of the at-rule, if known.
     */
    position: {
      column: number
      line: number
      offset?: number
    } | null
  }

  export interface ContextChange {
    /**
     * Context descriptors before the move
     * (params, layer labels, or at-rule descriptions).
     */
    from: string[]

    /**
     * Human-readable risk description.
     */
    message: string

    /**
     * Context descriptors after the move.
     */
    to: string[]

    /**
     * Which context changes.
     */
    type: 'atrule' | 'layer' | 'media' | 'supports'
  }

  export interface LayerSlot {
    /**
     * Index in the cascade layer order, `-1` for unlayered or unknown.
     */
    index: number

    /**
     * Dotted layer path, `(anonymous)` segments, or `(unlayered)`.
     */
    label: string
  }

  export interface LayerOrderInfo {
    /**
     * Whether the move changes the node’s position in the layer order.
     */
    changed: boolean

    /**
     * Layer slot of the current parent chain.
     */
    from: LayerSlot

    /**
     * Human-readable explanation, `null` when nothing changes.
     */
    message: null | string

    /**
     * Cascade layer order of the current root.
     */
    order: string[]

    /**
     * Layer slot of the target parent chain.
     */
    to: LayerSlot

    /**
     * Cascade layer order of the target root,
     * present only when moving across roots.
     */
    toOrder?: string[]
  }

  export interface MovePlan {
    /**
     * Context changes the move would cause, empty when safe.
     */
    changes: ContextChange[]

    /**
     * Current parent and its real AST at-rule chain (root-first).
     */
    from: {
      chain: ChainEntry[]
      parent: Container | undefined
    }

    /**
     * Cascade layer order comparison.
     */
    layerOrder: LayerOrderInfo

    /**
     * The node that was inspected. It is never moved by the preflight.
     */
    node: Node

    /**
     * Human-readable risks, empty when the move is context-neutral.
     */
    risks: string[]

    /**
     * `true` when the move keeps media, supports, and layer contexts.
     */
    safe: boolean

    /**
     * Target parent and its real AST at-rule chain (root-first).
     */
    to: {
      chain: ChainEntry[]
      parent: Container
    }
  }

  type MovePreflight = {
    /**
     * Explicit preflight for moving a node (usually a `Rule`)
     * to a new parent.
     *
     * Compares the real AST ancestor at-rule chains of the current and
     * the target parent and reports whether the move would change
     * the `@media`, `@supports`, or `@layer` context. It only returns
     * a plan with risks: it never moves any node, so all source
     * positions stay queryable.
     *
     * ```js
     * let plan = postcss.movePreflight(rule, anotherMedia)
     * if (!plan.safe) console.warn(plan.risks)
     * ```
     *
     * @param node Node (usually a rule) to move.
     * @param newParent Target parent container.
     * @return Move plan with `changes`, `risks`, and `layerOrder`.
     */
    (node: Node, newParent: Container): MovePlan

    default: MovePreflight
  }
}

declare let movePreflight: movePreflight.MovePreflight

export = movePreflight
