import {
  Document,
  Node,
  Plugin,
  ProcessOptions,
  Root,
  SourceMap,
  TransformCallback,
  Warning,
  WarningOptions
} from './postcss.js'
import Processor from './processor.js'

declare namespace Result {
  export interface Message {
    [others: string]: any

    /**
     * Source PostCSS plugin name.
     */
    plugin?: string

    /**
     * Message type.
     */
    type: string
  }

  export interface ResultOptions extends ProcessOptions {
    /**
     * The CSS node that was the source of the warning.
     */
    node?: Node

    /**
     * Name of plugin that created this warning. `Result#warn` will fill it
     * automatically with `Plugin#postcssPlugin` value.
     */
    plugin?: string
  }

  /**
   * A detached, plain-object copy of a single warning
   * inside a `Result#snapshot()` or `LazyResult#snapshot()` snapshot.
   *
   * Position fields are `null` when the warning has no source position,
   * so an absent position is explicit rather than `undefined`.
   */
  export interface WarningSnapshot {
    /**
     * Column in the source file where the warning was raised,
     * or `null` if the warning has no position.
     */
    column: number | null

    /**
     * Column where the warning range ends, or `null` if unknown.
     */
    endColumn: number | null

    /**
     * Line where the warning range ends, or `null` if unknown.
     */
    endLine: number | null

    /**
     * Line in the source file where the warning was raised,
     * or `null` if the warning has no position.
     */
    line: number | null

    /**
     * Name of the plugin that created the warning,
     * or `null` if it is not known.
     */
    plugin: string | null

    /**
     * Warning message.
     */
    text: string
  }

  /**
   * A point-in-time view of a finished `Result`. The object and all nested
   * containers are fresh copies: mutating them does not affect the `Result`.
   */
  export interface ResultSnapshot {
    /**
     * Always `null` on a `Result` snapshot, since a `Result`
     * represents a completed transformation.
     */
    error: null

    /**
     * A standalone `Result` is always a completed one.
     */
    state: 'succeeded'

    /**
     * Warnings produced by plugins, in the order they were added.
     */
    warnings: WarningSnapshot[]
  }

  export { Result_ as default }
}

/**
 * Provides the result of the PostCSS transformations.
 *
 * A Result instance is returned by `LazyResult#then`
 * or `Root#toResult` methods.
 *
 * ```js
 * postcss([autoprefixer]).process(css).then(result => {
 *  console.log(result.css)
 * })
 * ```
 *
 * ```js
 * const result2 = postcss.parse(css).toResult()
 * ```
 */
declare class Result_<RootNode = Document | Root> {
  /**
   * A CSS string representing of `Result#root`.
   *
   * ```js
   * postcss.parse('a{}').toResult().css //=> "a{}"
   * ```
   */
  css: string

  /**
   * Last runned PostCSS plugin.
   */
  lastPlugin: Plugin | TransformCallback

  /**
   * An instance of `SourceMapGenerator` class from the `source-map` library,
   * representing changes to the `Result#root` instance.
   *
   * ```js
   * result.map.toJSON() //=> { version: 3, file: 'a.css', … }
   * ```
   *
   * ```js
   * if (result.map) {
   *   fs.writeFileSync(result.opts.to + '.map', result.map.toString())
   * }
   * ```
   */
  map: SourceMap

  /**
   * Contains messages from plugins (e.g., warnings or custom messages).
   * Each message should have type and plugin properties.
   *
   * ```js
   * AtRule: {
   *   import: (atRule, { result }) {
   *     const importedFile = parseImport(atRule)
   *     result.messages.push({
   *       type: 'dependency',
   *       plugin: 'postcss-import',
   *       file: importedFile,
   *       parent: result.opts.from
   *     })
   *   }
   * }
   * ```
   */
  messages: Result.Message[]

  /**
   * Options from the `Processor#process` or `Root#toResult` call
   * that produced this Result instance.]
   *
   * ```js
   * root.toResult(opts).opts === opts
   * ```
   */
  opts: Result.ResultOptions

  /**
   * The Processor instance used for this transformation.
   *
   * ```js
   * for (const plugin of result.processor.plugins) {
   *   if (plugin.postcssPlugin === 'postcss-bad') {
   *     throw 'postcss-good is incompatible with postcss-bad'
   *   }
   * })
   * ```
   */
  processor: Processor

  /**
   * Root node after all transformations.
   *
   * ```js
   * root.toResult().root === root
   * ```
   */
  root: RootNode

  /**
   * An alias for the `Result#css` property.
   * Use it with syntaxes that generate non-CSS output.
   *
   * ```js
   * result.css === result.content
   * ```
   */
  get content(): string

  /**
   * @param processor Processor used for this transformation.
   * @param root      Root node after all transformations.
   * @param opts      Options from the `Processor#process` or `Root#toResult`.
   */
  constructor(processor: Processor, root: RootNode, opts: Result.ResultOptions)

  /**
   * Returns a detached snapshot of this result: its state (`'succeeded'`),
   * and the warnings produced so far with plugin source, position,
   * and original order preserved.
   *
   * The returned object contains only plain data. It never exposes
   * the AST, and mutating it does not affect this `Result`.
   *
   * ```js
   * result.snapshot().warnings.forEach(warning => {
   *   console.log(warning.plugin, warning.line, warning.text)
   * })
   * ```
   *
   * @return Snapshot with state and warnings.
   */
  snapshot(): Result.ResultSnapshot

  /**
   * Returns for `Result#css` content.
   *
   * ```js
   * result + '' === result.css
   * ```
   *
   * @return String representing of `Result#root`.
   */
  toString(): string

  /**
   * Creates an instance of `Warning` and adds it to `Result#messages`.
   *
   * ```js
   * if (decl.important) {
   *   result.warn('Avoid !important', { node: decl, word: '!important' })
   * }
   * ```
   *
   * @param text Warning message.
   * @param opts Warning options.
   * @return Created warning.
   */
  warn(message: string, options?: WarningOptions): Warning

  /**
   * Returns warnings from plugins. Filters `Warning` instances
   * from `Result#messages`.
   *
   * ```js
   * result.warnings().forEach(warn => {
   *   console.warn(warn.toString())
   * })
   * ```
   *
   * @return Warnings from plugins.
   */
  warnings(): Warning[]
}

declare class Result<RootNode = Document | Root> extends Result_<RootNode> {}

export = Result
