'use strict'

let Container = require('./container')
let PositionIndex = require('./position-index')

let LazyResult, Processor

class Root extends Container {
  // Cached position index, rebuilt automatically after the tree is
  // modified through the Container API.
  get positionIndex() {
    if (!this.positionIndexCache) {
      this.positionIndexCache = new PositionIndex(this)
    } else if (this.positionIndexCache.stale) {
      this.positionIndexCache.rebuild()
    }
    return this.positionIndexCache
  }

  constructor(defaults) {
    super(defaults)
    this.type = 'root'
    if (!this.nodes) this.nodes = []
  }

  // Creates a read-only position index mapping UTF-8 byte positions in
  // the source CSS to AST nodes.
  createPositionIndex() {
    return new PositionIndex(this)
  }

  normalize(child, sample, type) {
    let keepBefore = new Set()
    for (let node of Array.isArray(child) ? child : [child]) {
      if (
        node &&
        typeof node === 'object' &&
        !node.parent &&
        node.raws &&
        typeof node.raws.before !== 'undefined'
      ) {
        keepBefore.add(node.raws)
      }
    }

    let nodes = super.normalize(child)

    if (sample) {
      if (type === 'prepend') {
        if (this.nodes.length > 1) {
          sample.raws.before = this.nodes[1].raws.before
        } else {
          delete sample.raws.before
        }
      } else if (this.first !== sample) {
        for (let node of nodes) {
          if (!keepBefore.has(node.raws)) {
            node.raws.before = sample.raws.before
          }
        }
      }
    }

    return nodes
  }

  removeChild(child, ignore) {
    let index = this.index(child)

    if (!ignore && index === 0 && this.nodes.length > 1) {
      this.nodes[1].raws.before = this.nodes[index].raws.before
    }

    return super.removeChild(child)
  }

  toResult(opts = {}) {
    let lazy = new LazyResult(new Processor(), this, opts)
    return lazy.stringify()
  }
}

Root.registerLazyResult = dependant => {
  LazyResult = dependant
}

Root.registerProcessor = dependant => {
  Processor = dependant
}

module.exports = Root
Root.default = Root

Container.registerRoot(Root)
