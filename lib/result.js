'use strict'

let Warning = require('./warning')

function snapshotWarnings(messages) {
  let warnings = []
  for (let message of messages) {
    if (message.type === 'warning') {
      warnings.push({
        column: typeof message.column === 'number' ? message.column : null,
        endColumn:
          typeof message.endColumn === 'number' ? message.endColumn : null,
        endLine: typeof message.endLine === 'number' ? message.endLine : null,
        line: typeof message.line === 'number' ? message.line : null,
        plugin: message.plugin === undefined ? null : String(message.plugin),
        text: String(message.text)
      })
    }
  }
  return warnings
}

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
  }

  snapshot() {
    return {
      error: null,
      state: 'succeeded',
      warnings: snapshotWarnings(this.messages)
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
