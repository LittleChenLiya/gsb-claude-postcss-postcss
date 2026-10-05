declare namespace valueList {
  /**
   * One top-level comma-separated item of a declaration value,
   * keeping its exact source range.
   */
  interface ValueListItem {
    /**
     * Offset (exclusive) of the item end in the original value.
     */
    end: number

    /**
     * Offset of the item start in the original value.
     */
    start: number

    /**
     * Raw (untrimmed) item text: `value.slice(start, end)`.
     */
    value: string
  }

  /**
   * Error thrown on unclosed string, comment or function bracket.
   * `pos` points at the start of the unclosed structure and no
   * partial list is delivered.
   */
  class ValueListSyntaxError extends Error {
    name: 'ValueListSyntaxError'

    /**
     * Offset of the unclosed structure start.
     */
    pos: number

    /**
     * Human-readable reason, e.g. `"Unclosed quote"`.
     */
    reason: string

    /**
     * The original value string.
     */
    source: string
  }

  interface ValueList {
    default: ValueList

    /**
     * Splits a declaration value by top-level commas, keeping the exact
     * source range of every item. Commas inside strings, comments and
     * nested brackets never split; `\` escapes the next character.
     *
     * ```js
     * const valueList = require('postcss/lib/value-list')
     * valueList.parse('linear-gradient(a,b),url("x,y"),red')
     * //=> three items with { value, start, end }
     * ```
     *
     * @param value Declaration value to read.
     * @return Items with raw text and source offsets.
     */
    parse(value: string): ValueListItem[]

    /**
     * Replaces the item at `index` with `text`, keeping every other
     * byte of the original value untouched.
     *
     * @param value Original declaration value.
     * @param index Zero-based item index.
     * @param text Replacement text.
     * @return New value string.
     */
    replace(value: string, index: number, text: string): string

    /**
     * Replaces the item at `index` inside a PostCSS declaration.
     * Only `decl.value` changes; `decl.source` and `decl.raws`
     * meta information is left untouched.
     *
     * @param decl PostCSS declaration (or any object with a string `value`).
     * @param index Zero-based item index.
     * @param text Replacement text.
     * @return The same declaration node.
     */
    replaceInDecl<D extends { value: string }>(
      decl: D,
      index: number,
      text: string
    ): D

    ValueListSyntaxError: typeof ValueListSyntaxError
  }
}

declare let valueList: valueList.ValueList

export = valueList
