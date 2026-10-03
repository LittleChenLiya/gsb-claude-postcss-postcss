'use strict'

/**
 * Serializes a plugin warning into a plain, detached object.
 *
 * The snapshot keeps the warning's source (plugin), position and order,
 * but drops the link to the AST (`node`) and any other object references,
 * so the returned object can be freely mutated by the caller without
 * affecting PostCSS internals or another snapshot.
 *
 * Missing positions and source are reported explicitly as `null`.
 *
 * @param {import('./warning')} warning Warning produced by `Result#warn`.
 * @return {object} Plain warning snapshot.
 */
function warningSnapshot(warning) {
  let snapshot = {
    column: warning.column || null,
    endColumn: warning.endColumn || null,
    endLine: warning.endLine || null,
    line: warning.line || null,
    plugin: warning.plugin || null,
    text: warning.text,
    type: 'warning'
  }

  for (let key in warning) {
    if (key === 'node') continue
    let value = warning[key]
    if (value !== null && typeof value === 'object') continue
    if (!(key in snapshot)) snapshot[key] = value
  }

  return snapshot
}

/**
 * Serializes an error into a plain, detached object with only safe fields.
 *
 * The snapshot never carries the AST or the CSS input object, so it is
 * safe to keep around after the processing has finished.
 *
 * @param {Error} error Error thrown by a plugin.
 * @return {object} Plain error snapshot.
 */
function errorSnapshot(error) {
  let snapshot = {
    column: error.column || null,
    endColumn: error.endColumn || null,
    endLine: error.endLine || null,
    file: error.file || null,
    line: error.line || null,
    message: error.message,
    name: error.name,
    plugin: error.plugin || null,
    stack: error.stack || null
  }

  return snapshot
}

module.exports = { errorSnapshot, warningSnapshot }
