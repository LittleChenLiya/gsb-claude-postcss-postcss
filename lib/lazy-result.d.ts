import Document from './document.js'
import { SourceMap } from './postcss.js'
import Processor from './processor.js'
import Result, { Message, ResultOptions, WarningSnapshot } from './result.js'
import Root from './root.js'
import Warning from './warning.js'

declare namespace LazyResult {
  /**
   * Safe, serializable fields of an error that failed a processing run.
   * Never contains the AST node the error was raised on.
   */
  export interface ErrorSnapshot {
    /**
     * Error message.
     */
    message: string

    /**
     * Error class name (e.g., `CssSyntaxError`).
     */
    name: string

    /**
     * Name of the plugin that threw the error, or `null` if unknown.
     */
    plugin: string | null
  }

  /**
   * A point-in-time, detached view of a `LazyResult` processing run.
   *
   * Reading a snapshot never starts processing, never awaits in-flight
   * plugins, and never calls plugin code. The object and all nested
   * containers are fresh copies: mutating them does not affect the run.
   */
  export interface ProcessingSnapshot {
    /**
     * Safe error fields when `state` is `'failed'`, otherwise `null`.
     */
    error: ErrorSnapshot | null

    /**
     * Number of plugins that have already finished.
     */
    pluginsRun: number

    /**
     * Total number of plugins in the processor for this run.
     */
    pluginsTotal: number

    /**
     * Current stage of the run:
     *
     * * `'pending'` — processing has not started yet.
     * * `'running'` — processing started and is waiting for async plugins.
     * * `'succeeded'` — all plugins finished without an error.
     * * `'failed'` — a plugin or the parser threw an error.
     */
    state: 'failed' | 'pending' | 'running' | 'succeeded'

    /**
     * Warnings produced so far, in the order they were added.
     * Kept even when the run failed.
     */
    warnings: WarningSnapshot[]
  }

  export { LazyResult_ as default }
}

/**
 * A Promise proxy for the result of PostCSS transformations.
 *
 * A `LazyResult` instance is returned by `Processor#process`.
 *
 * ```js
 * const lazy = postcss([autoprefixer]).process(css)
 * ```
 */
declare class LazyResult_<RootNode = Document | Root> implements PromiseLike<
  Result<RootNode>
> {
  /**
   * Processes input CSS through synchronous and asynchronous plugins
   * and calls onRejected for each error thrown in any plugin.
   *
   * It implements standard Promise API.
   *
   * ```js
   * postcss([autoprefixer]).process(css).then(result => {
   *   console.log(result.css)
   * }).catch(error => {
   *   console.error(error)
   * })
   * ```
   */
  catch: Promise<Result<RootNode>>['catch']

  /**
   * Processes input CSS through synchronous and asynchronous plugins
   * and calls onFinally on any error or when all plugins will finish work.
   *
   * It implements standard Promise API.
   *
   * ```js
   * postcss([autoprefixer]).process(css).finally(() => {
   *   console.log('processing ended')
   * })
   * ```
   */
  finally: Promise<Result<RootNode>>['finally']

  /**
   * Processes input CSS through synchronous and asynchronous plugins
   * and calls `onFulfilled` with a Result instance. If a plugin throws
   * an error, the `onRejected` callback will be executed.
   *
   * It implements standard Promise API.
   *
   * ```js
   * postcss([autoprefixer]).process(css, { from: cssPath }).then(result => {
   *   console.log(result.css)
   * })
   * ```
   */
  then: Promise<Result<RootNode>>['then']

  /**
   * An alias for the `css` property. Use it with syntaxes
   * that generate non-CSS output.
   *
   * This property will only work with synchronous plugins.
   * If the processor contains any asynchronous plugins
   * it will throw an error.
   *
   * PostCSS runners should always use `LazyResult#then`.
   */
  get content(): string

  /**
   * Processes input CSS through synchronous plugins, converts `Root`
   * to a CSS string and returns `Result#css`.
   *
   * This property will only work with synchronous plugins.
   * If the processor contains any asynchronous plugins
   * it will throw an error.
   *
   * PostCSS runners should always use `LazyResult#then`.
   */
  get css(): string

  /**
   * Processes input CSS through synchronous plugins
   * and returns `Result#map`.
   *
   * This property will only work with synchronous plugins.
   * If the processor contains any asynchronous plugins
   * it will throw an error.
   *
   * PostCSS runners should always use `LazyResult#then`.
   */
  get map(): SourceMap

  /**
   * Processes input CSS through synchronous plugins
   * and returns `Result#messages`.
   *
   * This property will only work with synchronous plugins. If the processor
   * contains any asynchronous plugins it will throw an error.
   *
   * PostCSS runners should always use `LazyResult#then`.
   */
  get messages(): Message[]

  /**
   * Options from the `Processor#process` call.
   */
  get opts(): ResultOptions

  /**
   * Returns a `Processor` instance, which will be used
   * for CSS transformations.
   */
  get processor(): Processor

  /**
   * Processes input CSS through synchronous plugins
   * and returns `Result#root`.
   *
   * This property will only work with synchronous plugins. If the processor
   * contains any asynchronous plugins it will throw an error.
   *
   * PostCSS runners should always use `LazyResult#then`.
   */
  get root(): RootNode

  /**
   * Returns the default string description of an object.
   * Required to implement the Promise interface.
   */
  get [Symbol.toStringTag](): string

  /**
   * @param processor Processor used for this transformation.
   * @param css       CSS to parse and transform.
   * @param opts      Options from the `Processor#process` or `Root#toResult`.
   */
  constructor(processor: Processor, css: string, opts: ResultOptions)

  /**
   * Run plugin in async way and return `Result`.
   *
   * @return Result with output content.
   */
  async(): Promise<Result<RootNode>>

  /**
   * Returns a detached snapshot of the current processing stage without
   * starting processing, awaiting in-flight plugins, or calling any plugin.
   *
   * ```js
   * const lazy = postcss(plugins).process(css, { from: cssPath })
   * lazy.snapshot().state //=> 'pending'
   * const promise = lazy.then(result => {
   *   result.snapshot().state //=> 'succeeded'
   * })
   * lazy.snapshot().state //=> 'running'
   * ```
   *
   * The snapshot contains the stage (`pending`/`running`/`succeeded`/`failed`),
   * the number of finished plugins, warnings produced so far (with plugin
   * source, position, and order preserved), and—on failure—safe error fields.
   * It never exposes the AST, and mutating it does not affect the run.
   *
   * @return Snapshot of the current processing stage.
   */
  snapshot(): LazyResult.ProcessingSnapshot

  /**
   * Run plugin in sync way and return `Result`.
   *
   * @return Result with output content.
   */
  sync(): Result<RootNode>

  /**
   * Alias for the `LazyResult#css` property.
   *
   * ```js
   * lazy + '' === lazy.css
   * ```
   *
   * @return Output CSS.
   */
  toString(): string

  /**
   * Processes input CSS through synchronous plugins
   * and calls `Result#warnings`.
   *
   * @return Warnings from plugins.
   */
  warnings(): Warning[]
}

declare class LazyResult<
  RootNode = Document | Root
> extends LazyResult_<RootNode> {}

export = LazyResult
