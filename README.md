# openmos

A graphing calculator that runs in the browser. Type an expression on the left,
watch it draw on the right.

Everything is client-side: there is no account, no server, and no request leaves
the page. The whole document — expressions, sliders, points, tables and the
current view — is encoded into the URL when you share it.

## What it does

**Expressions**

| You type | You get |
| --- | --- |
| `y = x^2 - 2` | a function of x |
| `x^2` | the same thing, `y =` is optional |
| `(2t, t^2 - 4)` | a parametric curve |
| `r(1 + 0.5cos(t))` | a polar curve |
| `x^2 + y^2 = 25` | an implicit curve |
| `x = 3` | a vertical line |
| `y >= x^2 - 9` | a shaded region with its boundary |
| `0 < x < 4 and y > 2` | the intersection, shaded |
| `x < 0 { -x }, x >= 0 { x^2 }` | a piecewise curve |
| `f(x) = x^2 + 1` | a function you can then call as `f(x)` |
| `x^{1/3}`, `\frac{a}{b}`, `\|x\|` | LaTeX input is accepted too |

Implicit multiplication works where you would expect it: `2x`, `xy`, `3sin(x)`,
`(x+1)(x-1)`, `3|x|`.

**Sliders, points and tables**

Sliders bind a name to a value and every expression that uses it redraws. Points
can be dragged on the graph or typed in. Tables hold one column per list, and
offer linear, quadratic, cubic, exponential, power and logarithmic fits with the
R² of each; clicking one adds it to the graph.

**Reading the graph**

Scroll to zoom toward the pointer, drag to pan, shift-scroll to pan sideways,
two fingers to pinch. Dragging a point picks it up. The coordinate readout shows
x under the pointer and the value of the focused expression there.

**Keeping work**

The document is saved to `localStorage` as you type. Undo and redo cover every
edit, with a burst of typing collapsed into a single step. Share puts the whole
document in the link; the share panel can also export and import JSON.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck, then a production bundle in dist/
npm run preview    # serve the built bundle
npm test           # parser, evaluator, geometry and share-link checks
```

## Deploying

`vercel.json` is already set up, so the zero-config path is to import the
repository on Vercel and accept the detected settings (framework: Vite, build
command `npm run build`, output `dist`). Any other static host works too: the
build output is a plain directory of files.

## How it is put together

```
src/
  math/       tokenizer -> parser -> compiler -> latex printer
  document/   document model, item kinds, regression
  graph/      canvas renderer, axis ticks, marching squares
  state/      store with undo, localStorage and share links
  ui/         React components
```

Two decisions carry most of the weight:

*The parser produces a tree, and the tree is compiled to a closure.* A redraw
can evaluate one expression thousands of times, so walking a tree each time
shows up. Compiling once means the hot loop is a few property lookups.

*Implicit curves and shaded regions are the same problem.* Both are a scalar
field over the plane, and both are drawn by sampling it on a grid. Curves come
from marching squares over the zero contour; regions are filled per pixel into
a half-resolution buffer and scaled up, which is both cheaper and smoother than
filling thousands of little polygons.

## Licence

MIT.