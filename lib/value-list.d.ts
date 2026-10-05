import Declaration from './declaration.js'

/**
 * One top-level item of a declaration value with its byte range
 * in the original string.
 */
export interface Item {
  /**
   * End offset (exclusive) in the original string.
   */
  end: number

  /**
   * Start offset (inclusive) in the original string.
   */
  start: number

  /**
   * Trimmed item text.
   */
  text: string
}

/**
 * Splits a declaration value into top-level comma-separated items,
 * preserving the original byte range of every item.
 *
 * Commas inside strings, comments, functions and nested brackets are not
 * split. CSS escapes and nested parentheses/brackets follow explicit
 * lexical rules. An unclosed string, comment or bracket raises
 * a `CssSyntaxError` pointing at the start of the unclosed structure
 * instead of returning a partial list.
 *
 * ```js
 * valueList.parse('linear-gradient(a,b),url("x,y"),red')
 * //=> [
 * //   { text: 'linear-gradient(a,b)', start: 0, end: 20 },
 * //   { text: 'url("x,y")', start: 21, end: 31 },
 * //   { text: 'red', start: 32, end: 35 }
 * // ]
 * ```
 *
 * @param value Declaration value.
 * @return Items with `start`/`end` offsets into the original string.
 */
export function parse(value: string): Item[]

/**
 * Replaces one top-level item of a declaration value while keeping every
 * other byte of the original string intact.
 *
 * ```js
 * valueList.replace('linear-gradient(a,b),url("x,y"),red', 2, 'blue')
 * //=> 'linear-gradient(a,b),url("x,y"),blue'
 * ```
 *
 * @param value Declaration value.
 * @param index Zero-based item index.
 * @param replacement New item text.
 * @return The value with only the selected item replaced.
 */
export function replace(
  value: string,
  index: number,
  replacement: string
): string

/**
 * Reads the top-level items of a declaration node's value. It only
 * touches `decl.value` and never reads or modifies `decl.source`.
 *
 * @param decl PostCSS declaration node.
 * @return Items with `start`/`end` offsets into the original value.
 */
export function read(decl: Declaration): Item[]
