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

export default plugin

// Snapshot API keeps a detached, typed view of a run
let lazySnapshot = postcss([plugin('color')]).process('a{}', {
  from: undefined
})
let processing = lazySnapshot.snapshot()
if (processing.state === 'failed') {
  console.log(processing.error?.name, processing.error?.message)
}
console.log(processing.pluginsRun, processing.pluginsTotal)
for (let warning of processing.warnings) {
  let line: number | null = warning.line
  let pluginName: string | null = warning.plugin
  console.log(line, pluginName, warning.text)
}

postcss()
  .process('a{}', { from: undefined })
  .then(result => {
    let resultSnapshot = result.snapshot()
    if (resultSnapshot.state === 'succeeded') {
      console.log(resultSnapshot.warnings.length)
    }
  })
