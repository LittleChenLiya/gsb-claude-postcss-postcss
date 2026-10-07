import Container from './container.js'
import Declaration from './declaration.js'

declare namespace customProperties {
  export interface VariableAnalysis {
    /**
     * Names of other custom properties in the same dependency cycle,
     * or `null` if the variable is not part of a cycle.
     */
    cycle: null | string[]

    /**
     * Whether the variable takes part in a dependency cycle.
     * Cyclic variables are invalid at computed-value time
     * regardless of fallbacks.
     */
    cyclic: boolean

    /**
     * Names of custom properties actually used to resolve the value
     * (transitively). References skipped because of a fallback
     * are not included.
     */
    dependencies: string[]

    /**
     * Custom property name, for example `--main-color`.
     */
    name: string

    /**
     * Names of all custom properties mentioned in `var()` of the raw
     * value, including references inside fallbacks.
     */
    references: string[]

    /**
     * Whether the variable can be resolved to a concrete value.
     */
    valid: boolean

    /**
     * Resolved value with all `var()` functions substituted,
     * or `null` if the variable is invalid.
     */
    value: null | string
  }

  export interface DeclarationAnalysis {
    /**
     * Names of custom properties in the same dependency cycle,
     * or `null`. Always `null` for regular declarations.
     */
    cycle: null | string[]

    /**
     * Whether the declaration is a custom property taking part
     * in a dependency cycle.
     */
    cyclic: boolean

    /**
     * Names of custom properties actually used to resolve the value
     * (transitively).
     */
    dependencies: string[]

    /**
     * Property name of the declaration.
     */
    prop: string

    /**
     * Names of all custom properties mentioned in `var()` of the raw
     * value, including references inside fallbacks.
     */
    references: string[]

    /**
     * Whether the declaration value can be resolved.
     */
    valid: boolean

    /**
     * Resolved value with all `var()` functions substituted,
     * or `null` if the value is invalid.
     */
    value: null | string
  }

  export interface Analysis {
    /**
     * Dependency cycles between custom properties. Every cycle
     * is a sorted list of custom property names forming a strongly
     * connected component of the dependency graph.
     */
    cycles: string[][]

    /**
     * Analysis of every passed declaration in the input order.
     */
    declarations: DeclarationAnalysis[]

    /**
     * Analysis of every custom property by its name.
     */
    variables: { [name: string]: VariableAnalysis }
  }

  export type CustomProperties = (
    /**
     * Final declarations of a single element: an array of declarations
     * (or `Declaration` nodes), a PostCSS container, or a plain object
     * like `{ '--a': 'var(--b, red)', color: 'var(--a)' }`.
     */
    declarations:
      | ({ prop: string; value: string } | Declaration)[]
      | { [prop: string]: string }
      | Container
  ) => Analysis
}

declare let analyzeCustomProperties: {
  default: customProperties.CustomProperties
} & customProperties.CustomProperties

export = analyzeCustomProperties
