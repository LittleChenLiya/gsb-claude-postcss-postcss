import extract = require('../lib/extract-declarations.js')
import postcss, { Document, PluginCreator } from '../lib/postcss.js'
import { RootRaws } from '../lib/root.js'

const plugin: PluginCreator<string> = prop => {
  return {
    Declaration: (decl, { Comment, result }) => {
      if (decl.prop === prop) {
        decl.warn(result, `${decl.prop} found in ${decl.parent?.nodes.length}`)
        decl.replaceWith(new Comment({ text: `${decl.prop} removed` }))
      }
    },
    postcssPlugin: 'remover'
  }
}

plugin.postcss = true

postcss([plugin])
  .process('h1{color: black;}', {
    from: undefined
  })
  .then(result => {
    console.log(result.root.parent)
    console.log(result.css)
  })

function parseMarkdown(): Document {
  return new Document()
}

let doc = postcss().process('a{}', { parser: parseMarkdown }).root
console.log(doc.toString())

function parentCanNarrowType(): never | void {
  let atRule = postcss.parse('@a{b{}}').first
  if (atRule?.type !== 'atrule') return
  let rule = atRule.first
  if (rule?.type !== 'rule') return
  let parent = rule.parent
  switch (parent?.type) {
    case undefined:
      console.log('ok')
      break
    case 'atrule':
      console.log(parent.params)
      break
    case 'root':
      {
        let raws: RootRaws = parent.raws
        console.log(raws)
      }
      break
    case 'rule':
      console.log(rule.selector)
      break
    default: {
      let exhaustiveCheck: never = parent
      return exhaustiveCheck
    }
  }
}
parentCanNarrowType()

function extractionHasTypes(): void {
  let root = postcss.parse('a { color: red; width: 1px }')
  let rule = root.first
  if (rule?.type !== 'rule') return
  let color = rule.nodes.find((i): i is import('../lib/declaration.js').default =>
    i.type === 'decl' && i.prop === 'color'
  )
  if (!color) return
  let plan = extract.planExtraction(rule, [color], { selector: 'b' })
  let result = extract.applyExtraction(plan)
  console.log(plan.groups.length, plan.selector, result.from.type, result.to.type)
}
extractionHasTypes()

export default plugin
