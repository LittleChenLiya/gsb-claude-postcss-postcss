declare namespace CustomPropertyAnalyzer {
  /**
   * A declaration-like input object. PostCSS `Declaration` nodes
   * satisfy this interface.
   */
  interface DeclarationInput {
    prop: string
    value: string
  }

  /**
   * Resolution report for a single custom property.
   */
  interface VariableAnalysis {
    /**
     * Names of the other custom properties forming the reference cycle
     * this variable takes part in (including itself), sorted.
     * `null` when the variable is not part of a cycle.
     */
    cycle: null | string[]

    /**
     * Whether the variable was declared in the analyzed declaration set.
     */
    defined: boolean

    /**
     * Names of custom properties actually consulted while resolving
     * this variable (including transitive and used fallback references),
     * sorted. For variables inside a cycle it lists the direct
     * references forming the cycle.
     */
    dependencies: string[]

    /**
     * Custom property name, for example `--main-color`.
     * Names are case-sensitive.
     */
    name: string

    /**
     * Why the variable could not be resolved:
     * `undefined` (not declared), `cycle` (part of a reference cycle)
     * or `invalid` (invalid at computed-value time).
     * `null` when the variable resolved successfully.
     */
    reason: 'cycle' | 'invalid' | 'undefined' | null

    /**
     * Whether the variable resolves to a concrete value.
     */
    valid: boolean

    /**
     * The resolved value with all `var()` references substituted,
     * or `null` when the variable is invalid at computed-value time.
     */
    value: null | string
  }

  /**
   * Resolution report for a regular (non-custom) declaration.
   */
  interface DeclarationAnalysis {
    /**
     * Names of custom properties actually consulted while resolving
     * this declaration, sorted.
     */
    dependencies: string[]

    /**
     * Property name.
     */
    prop: string

    /**
     * The value with all `var()` references substituted,
     * or `null` when the declaration is invalid at computed-value time.
     */
    resolvedValue: null | string

    /**
     * Whether all `var()` references in the value could be resolved.
     */
    valid: boolean

    /**
     * The original declaration value.
     */
    value: string
  }

  /**
   * Result of {@link CustomPropertyAnalyzer#analyze}.
   */
  interface AnalysisResult {
    /**
     * Reference cycles found between custom properties. Each entry
     * lists the sorted names of one cyclic component.
     */
    cycles: string[][]

    /**
     * Resolution reports for regular (non-custom) declarations,
     * in the order they were passed to the analyzer.
     */
    declarations: DeclarationAnalysis[]

    /**
     * Resolution reports for custom properties, keyed by name.
     * Includes referenced but undefined variables.
     */
    variables: Map<string, VariableAnalysis>
  }
}

/**
 * Analyzes CSS custom properties (`--*`) of a single, already cascaded
 * set of declarations. It does not implement the CSS cascade: pass the
 * final declarations of one element.
 *
 * ```js
 * let analyzer = new CustomPropertyAnalyzer([
 *   { prop: '--a', value: 'var(--b, red)' },
 *   { prop: 'color', value: 'var(--a)' }
 * ])
 * let { variables, declarations, cycles } = analyzer.analyze()
 * variables.get('--a').value //=> 'red'
 * ```
 *
 * Resolution follows the CSS Custom Properties Level 1 rules:
 *
 * * An undefined variable is recovered by its fallback, if a valid
 *   (possibly empty) fallback is present.
 * * All custom properties taking part in a reference cycle compute to
 *   the guaranteed-invalid value. Referencing such a variable makes the
 *   referrer invalid at computed-value time too, and fallbacks are not
 *   consulted in this case.
 */
declare class CustomPropertyAnalyzer {
  /**
   * @param declarations Final declarations of one element. Accepts
   *                     plain objects or PostCSS `Declaration` nodes.
   */
  constructor(declarations: Iterable<CustomPropertyAnalyzer.DeclarationInput>)

  /**
   * Parses `var()` references, builds the dependency graph and resolves
   * every custom property and regular declaration.
   *
   * @return Resolution report for variables, declarations and cycles.
   */
  analyze(): CustomPropertyAnalyzer.AnalysisResult
}

export = CustomPropertyAnalyzer
