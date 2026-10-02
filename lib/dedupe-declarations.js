'use strict'

/**
 * Creates an optional PostCSS plugin which removes truly duplicated
 * declarations inside the same rule.
 *
 * CSS often contains intentional fallback pairs like
 * `display: -webkit-box; display: flex`, so this plugin never merges
 * declarations with different values. A declaration is dropped only when
 * the same rule already contains a later declaration with the same
 * property (compared by CSS rules: case-insensitive for standard
 * properties, case-sensitive for custom properties), the same value
 * string (including functions) and the same `!important` state.
 *
 * Grouping is scoped to the declaration's parent: entering `@supports`
 * or another rule starts a fresh group. Comments and the raws of the
 * remaining nodes are left untouched.
 *
 * The plugin is not enabled by default; add it explicitly:
 *
 * ```js
 * postcss([postcss.dedupeDeclarations()]).process(css)
 * ```
 *
 * @return {import('./postcss.js').Plugin} Plugin instance.
 */
function dedupeDeclarations() {
  return {
    Once(root) {
      let groups = new Map()
      root.walkDecls(decl => {
        let parent = decl.parent
        let group = groups.get(parent)
        if (!group) {
          group = new Map()
          groups.set(parent, group)
        }
        let prop = decl.prop.startsWith('--')
          ? decl.prop
          : decl.prop.toLowerCase()
        let key = prop + '\n' + decl.value + '\n' + String(decl.important)
        let previous = group.get(key)
        if (previous) {
          // The later identical declaration wins in CSS, so removing
          // the earlier copy never changes the computed styles.
          previous.remove()
        }
        group.set(key, decl)
      })
      groups.clear()
    },
    postcssPlugin: 'postcss-dedupe-declarations'
  }
}

dedupeDeclarations.postcss = true

module.exports = dedupeDeclarations
module.exports.default = dedupeDeclarations
