module.exports = root => ({
  node: root.first.first,
  target: root.first.nodes[1],
  opts: { before: true }
})
