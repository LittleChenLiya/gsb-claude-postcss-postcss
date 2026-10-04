# 注释归属与声明抽取

从一条 CSS 规则里抽取部分声明生成新规则时，注释不能简单地全部搬走。
本仓库提供了一个保留注释归属的抽取计划：`lib/extract.js`。

## 归属规则

注释是否跟随声明，以**空行**为界：

- **紧邻声明之前的连续注释跟随该声明**。注释与声明之间、以及连续注释
  彼此之间没有空行时，这条注释链与声明一起搬走。
- **规则开头的独立说明留在原规则**。说明与声明之间隔着空行时，它属于
  原规则，不随声明搬走。
- **夹在空行两侧的注释留在原处**。注释前后都有空行时，它与前后声明
  都没有归属关系，留在原规则。

判断依据是节点 `raws.before` 中是否出现空行（`\n` 后仅跟空白再出现
`\n`）。空行把注释链断开：断开之前的注释不跟随之后的声明。

```css
.card {
  /* 规则说明 */          /* 与 color 之间有空行，留下 */

  /* 文字颜色 */          /* 紧邻 color，搬走 */
  color: red;

  /* 背景颜色 */          /* 两侧都有空行，留下 */
  background: white;
}
```

抽取 `color` 后：

```css
.card {
  /* 规则说明 */

  /* 背景颜色 */
  background: white;
}
.card-text {
  /* 文字颜色 */
  color: red;
}
```

## 用法

```js
let postcss = require('postcss')
let extract = require('./lib/extract')

let root = postcss.parse(css, { from: 'source.css' })
let rule = root.first

// 先做计划：校验归属，不改动任何节点
let plan = extract(rule, '.card-text', ['color'])

// 校验通过后再移动，返回新规则
let extracted = plan.apply()
```

`extract(rule, selector, props)` 返回一个计划对象：

- `rule`：原规则；
- `selector`：新规则选择器；
- `declarations`：将要移动的声明；
- `apply()`：执行移动，把新规则插入到原规则之后，并返回新规则。

`props` 是一个数组，成员可以是声明的属性名（字符串），也可以是声明
节点。重复的属性名会去重。

## 归属校验：先检查，后移动

移动之前会校验每个声明的归属：

- 目标必须是一条规则节点；
- 选择器必须是非空字符串；
- 声明数组不能为空；
- 属性名必须在该规则中能找到对应声明；
- 传入的声明节点必须是指定规则的直接子节点。

任一节点不属于指定规则（例如混入了另一条规则的节点），整个计划立即
失败并抛出 `ExtractionError`，**不改动树中任何节点**。

```js
let other = root.nodes[1].nodes[0] // 另一条规则里的声明
extract(rule, '.x', [other]) // 抛出错误，rule 保持不变
```

## raws 与 source 保留

- 被移动的节点保留各自的 `raws`（`before`、`between` 等）和 `source`
  位置，生成 source map 时仍能定位到原始源码行。
- 新规则复制原规则的 `raws`（`between`、`after`、`semicolon`），并把
  `source` 指向原规则的起始位置，因此新规则也能追溯到原源码行。
- 移动链中第一个节点若带有仅在旧位置有意义的前导空行，会被折叠为一个
  换行，避免新规则以空行开头；其余 raws 原样保留。

## 本地 Node 命令

仓库内自带一个可直接运行的示例脚本：

```sh
node docs/extract-with-comments.js
```

脚本解析一条带空行的规则，抽取 `color`，打印两条规则以及每个节点
追溯到的源码行。
