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

Scroll to zoom toward the pointer. Drag to pan — right takes the graph left,
which reads as pushing the window along rather than pulling the paper. Shift-scroll
pans sideways with the picture, and two fingers pinch to zoom and slide at once;
the zoom half is not reversed, so spreading zooms in and pinching zooms out.
Arrow keys and the on-screen buttons name a direction for the *view*, so they are
not reversed. Dragging a point picks it up. The coordinate readout shows x under
the pointer and the value of the focused expression there.

**Keeping work**

The document is saved to `localStorage` as you type. Undo and redo cover every
edit, with a burst of typing collapsed into a single step. Share puts the whole
document in the link; the share panel can also export and import JSON.

## Notes on a few decisions

**A drag is the negation of a view shift.** Two primitives sit under every
gesture: `shiftView` slides the centre of the window, and `dragBy` is its
negation, so the picture travels the opposite way to the pointer. Keeping them as
one function and its mirror rather than two directions with their own signs is
what stops the vertical and horizontal halves from drifting apart — the arrow keys
were transposed for a while before this made them checkable.

**Zoom and pan do not go through React.** A gesture mutates a ref and schedules
one canvas repaint; the value is written to the store once the gesture settles.
Going through the store on every pointer event meant rebuilding the document and
re-rendering the list for each one, and because those renders re-read the
viewport from props, a drag snapped back to where it started.

**Pinch applies only the change since the previous move.** Scaling by the ratio
of the current distance to the distance at the start of the gesture compounds
once per event, which is how a two-finger drag turns into a runaway zoom.
Separately, `touch-action: none` has to be set on the canvas and not just its
container — it does not inherit, and without it the browser's own page zoom
runs on top of ours.

**Implicit curves and shaded regions are both sampled fields.** One contour
tracer serves both. It starts from a coarse grid and refines only into blocks
whose corners disagree about the sign, which keeps the work proportional to the
length of the boundary rather than the area of the window — a window full of
implicit curves went from about two seconds a frame to under fifty milliseconds.

**Filling a region is a pixel loop, not polygons.** Marching squares produces
lovely boundary segments, but tens of thousands of overlapping sub-paths are
quadratic for the rasteriser. The fill classifies blocks first, evaluates the
field only in the blocks that straddle the boundary, and paints at a third of
the canvas resolution. The boundary itself is drawn at full resolution by the
contour tracer, which is what keeps the edge reading as a curve rather than as a
staircase.

**A fresh visit starts empty.** There is no sample graph to dismiss. The empty
state says what the three shapes of input look like, which is the part people
actually need, and then gets out of the way.

## On a phone

The list and the graph share the screen, so the list folds away to a chevron in
the header and the graph takes the whole of the display. Dialogs go edge to edge
so their footer stays within reach of a thumb, hit targets are sized for fingers
rather than a cursor, and the canvas opts out of the browser's own pan and zoom
so a two-finger drag is handled here rather than by the page.

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
field over the plane, and both are drawn by sampling it. The reasoning behind
the sampler is in [Notes on a few decisions](#notes-on-a-few-decisions).

## Licence

MIT.