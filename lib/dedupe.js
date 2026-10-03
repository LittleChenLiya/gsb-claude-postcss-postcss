'use strict'

/**
 * Build the identity key of a declaration.
 *
 * The property name is compared by CSS rules: custom properties (names
 * starting with `--`) keep their case, every other name is lowercased.
 * The value string and the `!important` flag both take part in the
 * identity, so different fallback values are never merged.
 *
 * @param {import('./declaration.js').default} decl
 * @returns {string}
 */
function declKey(decl) {
  let prop = decl.prop
  if (!prop.startsWith('--')) prop = prop.toLowerCase()
  return prop + '\0' + decl.value + '\0' + (decl.important ? '1' : '0')
}

/**
 * Remove duplicate declarations inside a single rule.
 *
 * Only declarations that are direct children of the same rule and share
 * the same identity are considered duplicates. The first occurrence is
 * kept; every later copy is removed. Comments and other nodes are never
 * touched, so associated comments and the raws of the remaining nodes are
 * preserved. Each rule gets its own set of identities, so entering
 * another rule (including rules nested inside `@supports`) re-groups the
 * declarations.
 *
 * @param {object} [opts]
 * @returns {import('./postcss.js').Plugin}
 */
function dedupe() {
  return {
    postcssPlugin: 'postcss-dedupe',
    Rule(rule) {
      let seen = new Set()
      let i = 0
      while (i < rule.nodes.length) {
        let node = rule.nodes[i]
        if (node.type === 'decl') {
          let key = declKey(node)
          if (seen.has(key)) {
            rule.removeChild(node)
            continue
          }
          seen.add(key)
        }
        i += 1
      }
    }
  }
}

module.exports = dedupe
dedupe.default = dedupe
dedupe.postcss = true
