'use strict'

let { warningSnapshot } = require('./snapshot')
let Warning = require('./warning')

class Result {
  get content() {
    return this.css
  }

  constructor(processor, root, opts) {
    this.processor = processor
    this.messages = []
    this.root = root
    this.opts = opts
    this.css = ''
    this.map = undefined
    this.plugin = 0
  }

  /**
   * Returns a plain, detached snapshot of the current processing state.
   *
   * The snapshot never triggers or awaits processing: it only reports what
   * is already known. It contains no AST references and no containers
   * shared with PostCSS internals, so mutating the returned object is safe.
   *
   * @return {object} Snapshot with `state`, `plugins`, `warnings` and
   *                  `error` fields.
   */
  snapshot() {
    return {
      error: null,
      plugins: this.plugin,
      state: 'succeeded',
      warnings: this.warnings().map(warningSnapshot)
    }
  }

  toString() {
    return this.css
  }

  warn(text, opts = {}) {
    if (!opts.plugin) {
      if (this.lastPlugin && this.lastPlugin.postcssPlugin) {
        opts.plugin = this.lastPlugin.postcssPlugin
      }
    }

    let warning = new Warning(text, opts)
    this.messages.push(warning)

    return warning
  }

  warnings() {
    return this.messages.filter(i => i.type === 'warning')
  }
}

module.exports = Result
Result.default = Result
