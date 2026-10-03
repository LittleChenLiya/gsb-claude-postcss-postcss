import { Plugin } from './postcss.js'

/**
 * Optional cleanup plugin that removes only truly duplicate declarations
 * within the same rule.
 *
 * The property name is compared by CSS rules (custom properties keep their
 * case), the value string and the `!important` flag both take part in the
 * identity, and each rule gets its own set of identities, so entering
 * another rule (including rules nested inside `@supports`) re-groups the
 * declarations. Comments and remaining nodes' raws are preserved.
 *
 * This plugin is not enabled by the default processing flow.
 *
 * ```js
 * const postcss = require('postcss')
 * const dedupe = require('postcss/lib/dedupe')
 *
 * postcss([dedupe()]).process(css).then(result => result.css)
 * ```
 */
declare function dedupe(opts?: dedupe.Options): Plugin

declare namespace dedupe {
  export type Options = object

  export const postcss: true

  export { dedupe as default }
}

export = dedupe
