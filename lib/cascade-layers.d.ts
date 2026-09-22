import AtRule from './at-rule.js'
import Container from './container.js'
import Root from './root.js'

declare namespace analyzeCascadeLayers {
  interface CascadeLayerPosition {
    column: number
    line: number
    offset?: number
    source?: string
  }

  interface CascadeLayerCondition {
    /**
     * True when the condition depends on runtime values
     * like var(), env() or attr() and cannot be decided at build time.
     */
    dynamic: boolean
    node: AtRule
    params: string
    position?: CascadeLayerPosition
    type: string

    /**
     * Always 'unknown': media/supports conditions are not
     * evaluated during analysis.
     */
    value: 'unknown'
  }

  interface CascadeLayer {
    anonymous: boolean
    conditions: CascadeLayerCondition[]
    firstPosition?: CascadeLayerPosition

    /**
     * Dotted full name like 'theme.base', '#anonymous-1'
     * or null for the unlayered entry in order lists.
     */
    id: null | string
    name: null | string

    /**
     * Index of first appearance; re-declarations never change it.
     */
    order: number
    parent: null | string
    path: string[]

    /**
     * Set only on the synthetic unlayered entry in order lists.
     */
    unlayered?: boolean
  }

  interface CascadeLayerImportFrame {
    from?: string
    position?: CascadeLayerPosition
    url: string
  }

  interface CascadeLayerDiagnostic {
    /**
     * Import chain that led to the problem, including the
     * failing url as the last frame.
     */
    chain: CascadeLayerImportFrame[]
    message: string
    position?: CascadeLayerPosition
    type: 'import-cycle' | 'import-failed' | 'import-unresolved'
    url: string
  }

  interface CascadeLayerAnalysis {
    conditions: CascadeLayerCondition[]
    diagnostics: CascadeLayerDiagnostic[]

    /**
     * Layers from lowest to highest !important priority
     * (reverse of normalOrder).
     */
    importantOrder: CascadeLayer[]
    layers: CascadeLayer[]

    /**
     * Layers from lowest to highest normal priority;
     * unlayered styles come last.
     */
    normalOrder: CascadeLayer[]
    unlayered: {
      firstPosition?: CascadeLayerPosition
      present: boolean
    }
  }

  interface CascadeLayerResolvedImport {
    css?: string
    id?: string
    root?: Root
  }

  interface CascadeLayerOptions {
    resolveImport?: (
      url: string,
      context: {
        chain: CascadeLayerImportFrame[]
        from?: string
      }
    ) => CascadeLayerResolvedImport | null | undefined
  }
}

/**
 * Analyzes cascade layers of an already parsed PostCSS root
 * without mutating it. Purely syntactic: no selector
 * specificity and no computed styles are involved.
 */
declare function analyzeCascadeLayers(
  root: Container<any>,
  options?: analyzeCascadeLayers.CascadeLayerOptions
): analyzeCascadeLayers.CascadeLayerAnalysis

export = analyzeCascadeLayers
