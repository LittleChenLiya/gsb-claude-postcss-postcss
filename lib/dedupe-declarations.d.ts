import { PluginCreator } from './postcss.js'

/**
 * Optional cleanup plugin which removes truly duplicated declarations
 * inside the same rule. It keeps intentional fallback pairs (different
 * values), custom properties with different casing, and declarations
 * with different `!important` state. It is not enabled by default.
 *
 * ```js
 * import postcss, { dedupeDeclarations } from 'postcss'
 * postcss([dedupeDeclarations()]).process(css)
 * ```
 *
 * @return Plugin instance.
 */
declare let dedupeDeclarations: PluginCreator<Record<string, never>>

export = dedupeDeclarations
