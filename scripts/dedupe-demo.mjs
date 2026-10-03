/* eslint-disable no-console */

/**
 * Short entry point: print the CSS before and after running the optional
 * `postcss-dedupe` cleanup plugin, and confirm a second run is unchanged.
 *
 * Run with:
 *   node scripts/dedupe-demo.mjs
 */

import dedupe from '../lib/dedupe.js'
import postcss from '../lib/postcss.mjs'

let css = `@supports (display: grid) {
  @supports (color: red) {
    .a {
      /* older fallback kept */
      display: -webkit-box;
      display: flex;
      display: flex;
      --Tone: red;
      --tone: blue;
      color: red !important;
      color: red;
      color: red; /* duplicate, removed */
    }
  }
}
`

function run() {
  let before = css
  return postcss([dedupe()])
    .process(css, { from: undefined })
    .then(result => {
      let after = result.css
      return postcss([dedupe()])
        .process(after, { from: undefined })
        .then(again => {
          console.log('--- before ---')
          console.log(before)
          console.log('--- after ---')
          console.log(after)
          console.log('--- second run unchanged:', again.css === after, '---')
        })
    })
}

run()
