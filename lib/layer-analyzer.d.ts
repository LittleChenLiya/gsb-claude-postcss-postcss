declare namespace LayerAnalyzer {
  export interface Position {
    column: number
    file?: string
    line: number
  }

  export interface Condition {
    /**
     * The raw media query or supports condition text.
     */
    query: string

    /**
     * The resolved state, or 'unknown' when the analyzer could not
     * resolve the condition statically.
     */
    state: 'unknown' | boolean

    type: 'media' | 'supports'
  }

  export interface Layer {
    /**
     * True for anonymous layers. Every anonymous layer block or
     * anonymous import layer creates a new identity.
     */
    anonymous: boolean

    /**
     * Nested sublayers in order of first appearance.
     */
    children: Layer[]

    /**
     * Conditional context (media/supports) of the first appearance.
     */
    conditions: Condition[]

    /**
     * Number of declarations directly inside this layer
     * (declarations of nested sublayers are not included).
     */
    directDeclarations: number

    /**
     * Where the layer appeared for the first time.
     */
    firstPosition?: Position

    /**
     * Dot-separated full name, or null for anonymous layers.
     */
    fullName: null | string

    /**
     * Unique identity: the full name for named layers
     * or anonymous-N for anonymous ones.
     */
    id: string

    /**
     * The last segment of the layer name, or null for anonymous layers.
     */
    name: null | string

    /**
     * How many times the layer was declared. Re-declarations do not
     * change the order established by the first appearance.
     */
    occurrences: number

    /**
     * Index in the normal (non-important) layer order.
     */
    order: number

    /**
     * The id of the parent layer, or null for top-level layers.
     */
    parent: null | string
  }

  export interface Unlayered {
    conditions: Condition[]
    declarations: number
    firstPosition?: Position
  }

  export type OrderEntry =
    | { layer: Layer; type: 'layer' }
    | { type: 'unlayered'; unlayered: Unlayered }

  export interface Diagnostic {
    /**
     * Chain of sources leading to the failed import, starting with
     * the root file and ending with the source that could not be loaded.
     */
    chain: string[]

    /**
     * The URL of the import that failed.
     */
    import: string

    reason: string

    type: 'import-cycle' | 'import-failed'
  }

  export interface ImportInfo {
    /**
     * The file containing the import at-rule.
     */
    from?: string

    /**
     * The layer of the import: a name, null for anonymous,
     * or undefined when the import has no layer.
     */
    layer?: null | string

    media?: string

    supports?: string
  }

  export type ImportedContent =
    | { css: string; file?: string }
    | { type: 'root' }
    | null
    | string
    | undefined

  export interface Options {
    /**
     * Statically resolves media/supports conditions. Either a map
     * from query text (or "<type> <query>") to a boolean, or a function
     * returning a boolean. Unresolved conditions are kept as 'unknown'.
     */
    conditions?:
      | ((type: 'media' | 'supports', query: string) => boolean | undefined)
      | Record<string, boolean>

    /**
     * Resolves an import URL to CSS text, a parsed Root, or an object
     * with css and optional file. Return null/undefined or throw
     * to report a failed import.
     */
    resolveImport?(url: string, info: ImportInfo): ImportedContent
  }

  export interface Result {
    /**
     * All unique media/supports conditions encountered.
     */
    conditions: Condition[]

    /**
     * Import cycles and loading failures with their source chains.
     */
    diagnostics: Diagnostic[]

    /**
     * Layer priority for important declarations, from lowest to
     * highest: unlayered first, then layers in reverse order.
     */
    important: OrderEntry[]

    /**
     * All layers in normal priority order (flattened, parents before
     * their nested sublayers).
     */
    layers: Layer[]

    /**
     * Layer priority for normal declarations, from lowest to highest:
     * layers in order of first appearance, unlayered last.
     */
    normal: OrderEntry[]

    /**
     * Information about declarations outside of any layer.
     */
    unlayered?: Unlayered
  }
}

declare namespace LayerAnalyzer {
  export interface Exports {
    analyzeLayers(root: object, options?: LayerAnalyzer.Options): LayerAnalyzer.Result
  }
}

declare let LayerAnalyzer: LayerAnalyzer.Exports

export = LayerAnalyzer
