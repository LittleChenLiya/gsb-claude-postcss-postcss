import Comment from './comment.js'
import Declaration from './declaration.js'
import Rule from './rule.js'

declare namespace extractDeclarations {
  /** Nodes that can be extracted: declarations and their comments. */
  export type ExtractedNode = Comment | Declaration

  /**
   * A validated, side-effect-free plan for moving declarations
   * into a new rule. Pass it to {@link extractDeclarations.applyExtraction}.
   */
  export interface ExtractionPlan {
    /**
     * Contiguous source-ordered runs of nodes (attached comments followed
     * by their declaration) that will move into the new rule.
     */
    groups: ExtractedNode[][]
    /** The rule the declarations are extracted from. */
    rule: Rule
    /** Selector of the rule that will be created by the extraction. */
    selector: string
  }

  export interface PlanOptions {
    /**
     * Selector of the new rule. Defaults to the source rule’s selector.
     */
    selector?: string
  }

  export interface ExtractionResult {
    /** The source rule, with the extracted nodes removed. */
    from: Rule
    /** The newly created rule containing the extracted nodes. */
    to: Rule
  }

  export interface ExtractDeclarations {
    /**
     * Applies a plan: removes the planned nodes from the source rule and
     * inserts a new rule (with preserved `source`/`raws` information) after
     * it. Moved nodes keep their original source positions for source maps.
     */
    applyExtraction(plan: ExtractionPlan): ExtractionResult

    /**
     * Builds an extraction plan without mutating the AST. Throws if any of
     * the passed nodes is not a declaration belonging to `rule`; in that
     * case nothing in the tree is changed.
     *
     * Comments immediately preceding a selected declaration move with it;
     * rule-introductory comments and comments separated from the
     * declaration by an empty line stay in the source rule.
     */
    planExtraction(
      rule: Rule,
      decls: readonly Declaration[],
      opts?: PlanOptions
    ): ExtractionPlan
  }
}

declare let extractDeclarations: extractDeclarations.ExtractDeclarations

export = extractDeclarations

