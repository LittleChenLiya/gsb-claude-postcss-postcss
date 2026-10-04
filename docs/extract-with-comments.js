'use strict'

// Local Node command: extract declarations from a rule while keeping comment
// ownership. Run it from the repository root:
//
//   node docs/extract-with-comments.js
//
// The script parses a rule with blank lines, extracts `color` into a new
// rule, and prints both rules together with the source line each node came
// from. The adjacent comment moves with `color`; the rule description and
// the blank-line-separated comment stay in the original rule.

let postcss = require('../lib/postcss')
let extract = require('../lib/extract')

let css = `.card {
  /* card description */

  /* text color */
  color: red;

  /* background color */
  background: white;
}
`

let root = postcss.parse(css, { from: 'source.css' })
let rule = root.first

// Plan first: ownership is validated before anything moves.
let plan = extract(rule, '.card-text', ['color'])
let extracted = plan.apply()

console.log('--- original rule ---')
console.log(rule.toString())
console.log('--- extracted rule ---')
console.log(extracted.toString())

console.log('--- source lines ---')
for (let node of extracted.nodes) {
  console.log(
    node.type,
    node.prop || node.text,
    '-> line',
    node.source.start.line
  )
}
console.log('new rule traces to line', extracted.source.start.line)
