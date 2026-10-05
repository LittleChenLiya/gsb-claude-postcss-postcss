# Value List Reader

`postcss/lib/value-list` reads a declaration value as a list of top-level
comma-separated items while keeping the exact source range of every item.

- Commas inside functions `(...)`, strings (`"..."`, `'...'`) and comments
  (`/* ... */`) never split the list; brackets nest by lexical rules.
- `\` escapes the next character, so `a\,b` stays a single item and the
  escape bytes are preserved in the item text.
- An unclosed string, comment or bracket throws `ValueListSyntaxError`
  with `pos` pointing at the start of the unclosed structure; no partial
  list is delivered.
- `replace()` / `replaceInDecl()` rewrite one item and keep every other
  byte untouched; `replaceInDecl()` only reassigns `decl.value` and never
  modifies `decl.source` or other source meta information.

## Three-item example

```js
const valueList = require('postcss/lib/value-list')

let value = 'linear-gradient(a,b),url("x,y"),red'
let items = valueList.parse(value)
//=> [
//     { value: 'linear-gradient(a,b)', start: 0,  end: 20 },
//     { value: 'url("x,y")',           start: 21, end: 31 },
//     { value: 'red',                  start: 32, end: 35 }
//   ]

valueList.replace(value, 2, 'blue')
//=> 'linear-gradient(a,b),url("x,y"),blue'
//   the bytes of the first two items are identical to the original
```

## Local Node command

Run the three-item example directly from the repository root:

```sh
node -e "const vl=require('./lib/value-list');console.log(vl.parse('linear-gradient(a,b),url(\"x,y\"),red'))"
```

Run the component tests only:

```sh
npx uvu -r ts-node/register/transpile-only test "value-list\.test\.ts$"
```

## API

### `parse(value)`

Returns an array of `{ value, start, end }` items. `value` is the raw
(untrimmed) item text and `[start, end)` are its offsets in the original
string, so `value === original.slice(start, end)`. Throws
`ValueListSyntaxError` on unclosed structures.

### `replace(value, index, text)`

Returns a new string with the item at `index` replaced by `text`. Bytes
outside the item range (other items, commas, whitespace, comments) are
preserved exactly. Throws `RangeError` for an out-of-range index.

### `replaceInDecl(decl, index, text)`

Sets `decl.value` to the replaced value and returns the same declaration.
Only `decl.value` changes; `decl.source`, `decl.raws` and all other meta
information stay untouched.

### `ValueListSyntaxError`

Error class with `reason` (e.g. `"Unclosed quote"`), `pos` (offset of the
unclosed structure start) and `source` (the original value string).
