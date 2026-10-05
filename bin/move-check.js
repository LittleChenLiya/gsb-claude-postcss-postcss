#!/usr/bin/env node
'use strict'

// Command-line precheck for PostCSS rule moves.
//
// Usage:
//   move-check <css-file> <spec-file>
//
// The spec file is a CommonJS module that exports a function receiving the
// parsed Root and returning { node, target, opts }:
//
//   module.exports = root => ({
//     node: root.first.first,
//     target: root.nodes[1]
//   })
//
// The command prints the move report as JSON. It never modifies the CSS.

let fs = require('fs')
let path = require('path')

let postcss = require('../lib/postcss')

function fail(message) {
  process.stderr.write('move-check: ' + message + '\n')
  process.exit(1)
}

let cssFile = process.argv[2]
let specFile = process.argv[3]

if (!cssFile || !specFile) {
  fail('Usage: move-check <css-file> <spec-file>')
}

let css
try {
  css = fs.readFileSync(cssFile, 'utf8')
} catch {
  fail('cannot read CSS file: ' + cssFile)
}

let root = postcss.parse(css, { from: path.resolve(cssFile) })

let specFn
try {
  // eslint-disable-next-line n/global-require
  specFn = require(path.resolve(specFile))
} catch {
  fail('cannot load spec file: ' + specFile)
}

if (typeof specFn !== 'function') {
  fail('spec file must export a function')
}

let spec = specFn(root)
if (!spec || !spec.node || !spec.target) {
  fail('spec function must return { node, target, opts }')
}

let report = postcss.moveCheck(spec.node, spec.target, spec.opts || {})

process.stdout.write(JSON.stringify(report, null, 2) + '\n')
