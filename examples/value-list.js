'use strict'

/**
 * Local Node demo for the declaration value list reader.
 *
 * Run it directly with Node:
 *
 *   node examples/value-list.js
 *
 * It shows the three acceptance cases:
 *
 *   1. `linear-gradient(a,b),url("x,y"),red` is split into three items.
 *   2. Replacing the third item keeps the original bytes of the first two.
 *   3. An unclosed quote reports the position of its opening quote.
 *   4. Escaped commas are preserved.
 */

let postcss = require('../lib/postcss.js')
let valueList = require('../lib/value-list.js')

function show(label, value) {
  process.stdout.write(label + ': ' + JSON.stringify(value) + '\n')
}

let value = 'linear-gradient(a,b),url("x,y"),red'

// 1. Split into three items, each with its original byte range.
let items = valueList.parse(value)
show('items', items.map(i => i.text))
show('ranges', items.map(i => [i.start, i.end]))

// 2. Replace the third item; the first two items keep their bytes.
let replaced = valueList.replace(value, 2, 'blue')
show('replaced', replaced)
let before = valueList.parse(value)
let identical =
  replaced.slice(0, before[0].end) === value.slice(0, before[0].end) &&
  replaced.slice(before[1].start, before[1].end) ===
    value.slice(before[1].start, before[1].end)
show('first two items bytes identical', identical)

// 3. An unclosed quote points at the opening quote.
try {
  valueList.parse('a,"bc')
} catch (error) {
  show('unclosed quote', {
    column: error.column,
    line: error.line,
    offset: error.offset,
    reason: error.reason
  })
}

// 4. Escaped commas are preserved.
show(
  'escaped comma',
  valueList.parse('a\\, b, c').map(i => i.text)
)

// 5. Reading a declaration does not touch its source metadata.
let root = postcss.parse('a { background: ' + value + ' }')
let decl = root.first.first
let sourceBefore = decl.source
let readItems = valueList.read(decl)
show('read from decl', readItems.map(i => i.text))
show('source untouched', decl.source === sourceBefore)
