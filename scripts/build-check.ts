/**
 * Checks for the layer above the parser: turning a document into drawables,
 * tracing contours, fitting data and round-tripping a share link.
 */

import { buildDocument, splitTopLevel, stripOuterParens } from "../src/document/build.ts";
import { INSIDE, MIXED, OUTSIDE, contourSegments, partitionField } from "../src/graph/contour.ts";
import { fitModel } from "../src/document/regression.ts";
import { decodeDocument, encodeDocument, sanitize } from "../src/state/persist.ts";
import { niceStep, tickValues } from "../src/graph/ticks.ts";
import {
  DEFAULT_SETTINGS,
  DEFAULT_VIEWPORT,
  colorAt,
  type Document,
  type ExpressionItem,
  type SliderItem,
  type TableItem,
} from "../src/document/types.ts";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.log(`FAIL  ${label}\n        got  ${a}\n        want ${e}`);
  } else {
    console.log(`ok    ${label} = ${a}`);
  }
}

function checkThat(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok    ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ helpers */

function doc(items: Document["items"]): Document {
  return { items, viewport: { ...DEFAULT_VIEWPORT }, settings: { ...DEFAULT_SETTINGS }, seed: 1 };
}

let idSeed = 0;
function expression(source: string, extra: Partial<ExpressionItem> = {}): ExpressionItem {
  idSeed += 1;
  return { id: `e${idSeed}`, kind: "expression", color: colorAt(idSeed), source, ...extra };
}

function table(source: string): TableItem {
  idSeed += 1;
  return { id: `t${idSeed}`, kind: "table", color: colorAt(idSeed), source };
}

function slider(variable: string, value: number): SliderItem {
  idSeed += 1;
  return { id: `s${idSeed}`, kind: "slider", color: colorAt(idSeed), variable, min: -10, max: 10, step: 0.1, value };
}

function firstDrawable(items: Document["items"]) {
  return buildDocument(doc(items)).drawables[0];
}

/* --------------------------------------------------------------- expressions */

console.log("--- expression kinds ---");

{
  const d = firstDrawable([expression("y = x^2")]);
  check("y = x^2 is a curve", d.kind, "curve");
  if (d.kind === "curve") check("  value at 3", Math.round(d.fn(3, {})), 9);
}

{
  const d = firstDrawable([expression("x^3")]);
  check("bare x^3 is a curve", d.kind, "curve");
}

{
  const d = firstDrawable([expression("(2t, t^2 - 4)")]);
  check("(2t, t^2 - 4) is parametric", d.kind, "parametric");
  if (d.kind === "parametric") {
    const at0 = d.fn(0, {});
    const at1 = d.fn(1, {});
    check("  at t=0", at0.map((v) => Math.round(v * 1e6) / 1e6), [0, -4]);
    check("  at t=1", at1.map((v) => Math.round(v * 1e6) / 1e6), [2, -3]);
  }
}

{
  const d = firstDrawable([expression("r(1 + 0.5cos(t))")]);
  check("r(...) is parametric", d.kind, "parametric");
  if (d.kind === "parametric") {
    const at0 = d.fn(0, {});
    check("  radius 1.5 at t=0", [Math.round(at0[0] * 1e6) / 1e6, Math.round(at0[1] * 1e6) / 1e6], [1.5, 0]);
  }
}

{
  const d = firstDrawable([expression("x^2 + y^2 = 25")]);
  check("circle is implicit", d.kind, "implicit");
  if (d.kind === "implicit") {
    check("  field at (3,4)", d.field(3, 4, {}), 0);
    check("  field at (0,0)", d.field(0, 0, {}), -25);
  }
}

{
  const d = firstDrawable([expression("x = 3")]);
  check("x = 3 is implicit", d.kind, "implicit");
  if (d.kind === "implicit") check("  field at (3, 0)", d.field(3, 0, {}), 0);
}

{
  const d = firstDrawable([expression("y >= x^2 - 9")]);
  check("inequality is a region", d.kind, "region");
  if (d.kind === "region") {
    checkThat("  truth field is positive inside", d.field(0, 0, {}) > 0, `${d.field(0, 0, {})}`);
    checkThat("  truth field is negative outside", d.field(0, -100, {}) < 0, `${d.field(0, -100, {})}`);
  }
}

{
  const d = firstDrawable([expression("x^2 + y^2 <= 25")]);
  checkThat("<= uses the same field convention", d.kind === "region" && d.field(0, 0, {}) > 0);
}

{
  const d = firstDrawable([expression("y > x^2 and y < 4")]);
  checkThat("and combines both halves", d.kind === "region" && d.field(0, 1, {}) > 0 && d.field(0, 9, {}) < 0);
}

{
  const d = firstDrawable([expression("x < 0 { -x }, x >= 0 { x^2 }")]);
  check("piecewise is a curve", d.kind, "curve");
  if (d.kind === "curve") {
    check("  left branch", d.fn(-3, {}), 3);
    check("  right branch", d.fn(3, {}), 9);
  }
}

{
  const result = buildDocument(doc([expression("f(x) = x^2 + 1"), expression("y = f(x)")]));
  check("definition row is not drawn as a curve", result.drawables[0]!.kind, "definition");
  const curve = result.drawables[1]!;
  check("f(x) draws a curve", curve.kind, "curve");
  if (curve.kind === "curve") check("  f(4)", curve.fn(4, {}), 17);
}

{
  const result = buildDocument(doc([slider("a", 3), expression("y = a sin(x)")]));
  const curve = result.drawables[0]!;
  check("slider reaches the curve", curve.kind === "curve" ? Math.round(curve.fn(Math.PI / 2, result.scope) * 1e6) / 1e6 : null, 3);
}

{
  const d = firstDrawable([expression("y = x^2", { fill: "semi" })]);
  check("fill is carried through", d.kind === "implicit" ? d.fill : "curve", "curve");
}

console.log("\n--- error reporting ---");
for (const [source, needle] of [
  ["y = x^^2", "Unexpected"],
  ["y = nope(x)", "not a function"],
  ["sin(x, 2)", "takes 1"],
  ["", ""],
  ["y != 3", "no curve"],
  ["t", "pair"],
] as const) {
  const d = firstDrawable([expression(source)]);
  const message = d.kind === "bad" ? d.message : "";
  checkThat(`${JSON.stringify(source)} reports ${JSON.stringify(needle)}`, message.includes(needle), message || "(no message)");
}

console.log("\n--- top level splitting ---");
check("parametric pair splits once the wrapper is stripped", splitTopLevel(stripOuterParens("(2t, t^2 - 4)")), ["2t", "t^2 - 4"]);
check("splitTopLevel does not look inside brackets", splitTopLevel("[1, 2], [3, 4]"), ["[1, 2]", "[3, 4]"]);
check("splitTopLevel inside brackets", splitTopLevel("sum([1, 2])"), ["sum([1, 2])"]);
check("stripOuterParens wraps", stripOuterParens("(2t, t^2)"), "2t, t^2");
check("stripOuterParens leaves products", stripOuterParens("(x+1)(x-1)"), "(x+1)(x-1)");
check("stripOuterParens leaves lone group", stripOuterParens("(x+1) * 2"), "(x+1) * 2");

/* ------------------------------------------------------------------- tables */

console.log("\n--- tables ---");
{
  const built = buildDocument(doc([table("a = [1, 2, 3], b = [1, 4, 9]")])).tables[0]!;
  check("column headers", built.columns.map((c) => c.header), ["a", "b"]);
  check("column values", built.columns[1]!.values, [1, 4, 9]);
}
{
  const built = buildDocument(doc([table("[1, 2], [3]")])).tables[0]!;
  check("short columns are padded with gaps", built.columns.map((c) => c.values), [[1, 2], [3, null]]);
}
{
  const built = buildDocument(doc([table("not a list")])).tables[0]!;
  check("an expression that is not a list yields nothing", built.columns[0]!.values.length, 0);
}

/* --------------------------------------------------------------- regression */

console.log("\n--- regression ---");
{
  const linear = fitModel({ x: [0, 1, 2, 3], y: [1, 3, 5, 7] }, "linear");
  checkThat("linear recovers 2x+1", linear !== null && Math.abs(linear.coefficients[0]! - 2) < 1e-9 && Math.abs(linear.coefficients[1]! - 1) < 1e-9, JSON.stringify(linear?.coefficients));
  check("  latex", linear?.latex, "y=2x+1");
  checkThat("  R2 is 1", linear !== null && Math.abs(linear.r2 - 1) < 1e-9);
}
{
  const quad = fitModel({ x: [0, 1, 2, 3, 4], y: [0, 1, 4, 9, 16] }, "quadratic");
  checkThat("quadratic recovers x^2", quad !== null && Math.abs(quad.coefficients[0]! - 1) < 1e-8, JSON.stringify(quad?.coefficients));
}
{
  const exp = fitModel({ x: [0, 1, 2, 3], y: [2, 2 * Math.E, 2 * Math.E ** 2, 2 * Math.E ** 3] }, "exponential");
  check("exponential recovers 2e^x", exp?.latex, "y=2\\cdot e^{x}");
}
{
  const power = fitModel({ x: [1, 2, 3, 4], y: [1, 8, 27, 64] }, "power");
  check("power recovers x^3", power?.latex, "y=x^{3}");
}
check("too few points gives no fit", fitModel({ x: [1], y: [2] }, "linear"), null);
{
  // Regression scores have to stay finite on ordinary data; a fit scored in
  // the wrong space used to report -Infinity here.
  const data = { x: [1, 2, 3, 4, 5], y: [1.1, 3.9, 9.2, 15.8, 24.1] };
  for (const model of ["linear", "quadratic", "cubic", "exponential", "power", "logarithmic"] as const) {
    const fit = fitModel(data, model);
    checkThat(`${model} reports a finite score`, fit !== null && Number.isFinite(fit.r2), fit ? String(fit.r2) : "no fit");
  }
  const logarithmic = fitModel(data, "logarithmic");
  check("logarithmic latex", logarithmic?.latex, "y=13.43\\ln\\left(x\\right)-2.042");
  checkThat("logarithmic score is a real fraction", logarithmic !== null && logarithmic.r2 > 0.5 && logarithmic.r2 <= 1, `${logarithmic?.r2}`);
}
{
  const flat = fitModel({ x: [1, 2, 3], y: [5, 5, 5] }, "linear");
  check("flat data scores 1", flat?.r2, 1);
  const offset = fitModel({ x: [-2, -1, 1, 2], y: [4, 1, 1, 4] }, "linear");
  checkThat("a useless fit scores 0", offset !== null && Math.abs(offset.r2) < 1e-9, `${offset?.r2}`);
  checkThat("coefficients stay short", offset !== null && offset.latex.length < 12, offset?.latex);
}

/* ---------------------------------------------------------------- contours */

console.log("\n--- contour tracing ---");
{
  const circle = (x: number, y: number) => Math.hypot(x, y) - 10;
  const segments = contourSegments(circle, { minX: -15, maxX: 15, minY: -15, maxY: 15, minCell: 0.5, baseCells: 40 });
  checkThat("a circle yields segments", segments.length > 100, `${segments.length} segments`);
  const radii = segments.map((s) => (Math.hypot(s.x0, s.y0) + Math.hypot(s.x1, s.y1)) / 2);
  const worst = Math.max(...radii.map((r) => Math.abs(r - 10)));
  checkThat("segments sit on the circle", worst < 0.02, `worst radius error ${worst.toFixed(5)}`);

  // The whole point of refining adaptively: far fewer samples than a uniform
  // grid would need for the same accuracy.
  const naive = 60 * 60 * 4;
  checkThat(
    "adaptive tracing is far cheaper than a uniform grid",
    segments.length * 4 < naive / 8,
    `${segments.length} cells refined vs ${naive} uniform samples`,
  );

  const line = contourSegments((x) => x - 3, { minX: 0, maxX: 10, minY: -5, maxY: 5, minCell: 0.25, baseCells: 40 });
  checkThat("a vertical line yields segments", line.length >= 30, `${line.length}`);
  const xs = line.map((s) => (s.x0 + s.x1) / 2);
  checkThat("all crossings are at x=3", Math.max(...xs.map((x) => Math.abs(x - 3))) < 1e-9);

  // A curve tucked entirely inside one coarse block must still be found.
  const tiny = contourSegments((x, y) => Math.hypot(x - 3, y - 3) - 0.2, {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
    minCell: 0.2,
    baseCells: 40,
  });
  checkThat("a small closed curve inside a coarse block is still found", tiny.length > 6, `${tiny.length} segments`);
  const tinyRadii = tiny.map((s) => Math.hypot((s.x0 + s.x1) / 2 - 3, (s.y0 + s.y1) / 2 - 3));
  checkThat("  and it sits on the small circle", Math.max(...tinyRadii.map((r) => Math.abs(r - 0.2))) < 0.05);

  check("a field with no crossing returns nothing", contourSegments((x) => x + 100, { minX: -5, maxX: 5, minY: -5, maxY: 5, minCell: 0.5 }).length, 0);
  check("a field that is undefined everywhere returns nothing", contourSegments(() => NaN, { minX: -5, maxX: 5, minY: -5, maxY: 5, minCell: 0.5 }).length, 0);
}

console.log("\\n--- shaded regions ---");
{
  // The fill only consults the field where a block straddles the boundary, so
  // the painted map has to agree with a plain per-pixel evaluation. Getting the
  // pixel-to-graph mapping wrong shows up here and nowhere else.
  const checkFill = (
    label: string,
    field: (x: number, y: number) => number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    width: number,
    height: number,
    block: number,
  ) => {
    const partition = partitionField(field, bounds, width, height, block);
    const spanX = (bounds.maxX - bounds.minX) / width;
    const spanY = (bounds.maxY - bounds.minY) / height;
    let wrong = 0;
    for (let row = 0; row < height; row += 1) {
      const y = bounds.maxY - (row + 0.5) * spanY;
      for (let column = 0; column < width; column += 1) {
        const verdict = partition.state[Math.floor(row / partition.block) * partition.columns + Math.floor(column / partition.block)]!;
        const truth = field(bounds.minX + (column + 0.5) * spanX, y) > 0;
        const painted = verdict === MIXED ? truth : verdict === INSIDE;
        if (painted !== truth) wrong += 1;
      }
    }
    checkThat(`${label} fills exactly the truth`, wrong === 0, `${wrong} of ${width * height} pixels wrong`);
  };

  const wide = { minX: -10.3, maxX: 10.3, minY: -8.5, maxY: 8.5 };
  checkFill("a circle", (x, y) => x * x + y * y - 9, wide, 400, 330, 8);
  checkFill("a sideways parabola", (x, y) => y - x * x + 8, wide, 400, 330, 8);
  checkFill(
    "a steep parabola at high zoom",
    (x, y) => y - x * x + 8,
    { minX: -3.6, maxX: 3.6, minY: -3, maxY: 3 },
    400,
    330,
    8,
  );
  checkFill("a thin stripe", (x) => x - 0.2, wide, 400, 330, 8);
  checkFill("a stripe through a corner", (x, y) => x + y, wide, 400, 330, 8);

  // A boundary thinner than a block has to be found, not skipped over.
  const thin = partitionField((x) => Math.abs(x) - 0.3, wide, 400, 330, 8);
  let straddling = 0;
  for (const verdict of thin.state) if (verdict === MIXED) straddling += 1;
  checkThat("a boundary thinner than a block is still located", straddling > 0, `${straddling} straddling blocks`);
}

console.log("\\n--- sampling budget ---");
{
  // Every sample costs time on every frame, so the tracer has to skip the
  // parts of the window that clearly cannot contain a crossing. Counting the
  // evaluations catches a tracer that subdivides everywhere.
  const counting = (expression: (x: number, y: number) => number) => {
    let calls = 0;
    const field = (x: number, y: number) => {
      calls += 1;
      return expression(x, y);
    };
    return { field, calls: () => calls };
  };

  const bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 };
  const minCell = 0.1;
  const uniform = ((bounds.maxX - bounds.minX) / minCell) * ((bounds.maxY - bounds.minY) / minCell) * 4;

  const outside = counting((x, y) => x * x + y * y - 100);
  contourSegments(outside.field, { ...bounds, minCell, baseCells: 60 });
  checkThat(
    "a small circle costs a fraction of a uniform scan",
    outside.calls() < uniform / 10,
    `${outside.calls()} samples vs ${Math.round(uniform)} for a uniform grid at the same accuracy`,
  );

  const above = counting((x) => x + 1000);
  contourSegments(above.field, { minX: -50, maxX: 50, minY: -50, maxY: 50, minCell: 50 / 500, baseCells: 60 });
  checkThat(
    "a field that is positive everywhere is accepted immediately",
    above.calls() <= 60 * 60 * 5 + 60 * 60,
    `${above.calls()} samples`,
  );

  const below = counting((x) => x - 1000);
  contourSegments(below.field, { minX: -50, maxX: 50, minY: -50, maxY: 50, minCell: 50 / 500, baseCells: 60 });
  checkThat(
    "a field that is negative everywhere is accepted immediately",
    below.calls() <= 60 * 60 * 5 + 60 * 60,
    `${below.calls()} samples`,
  );
}

console.log("\n--- region partitioning ---");
{
  const circle = (x: number, y: number) => Math.hypot(x, y) - 10;
  const partition = partitionField(circle, { minX: -20, maxX: 20, minY: -20, maxY: 20 }, 200, 200, 8);
  let inside = 0;
  let mixed = 0;
  for (const value of partition.state) {
    if (value === INSIDE) inside += 1;
    else if (value === MIXED) mixed += 1;
  }
  const total = partition.state.length;
  checkThat("most blocks are uniform", (inside + total - inside - mixed) / total > 0.7, `${inside} inside, ${mixed} mixed, ${total} total`);
  checkThat("some blocks straddle the boundary", mixed > 8 && mixed < total / 3, `${mixed} mixed blocks`);
  checkThat("a block edge is honoured", partition.block, 8);

  const nothing = partitionField(() => -1, { minX: -1, maxX: 1, minY: -1, maxY: 1 }, 40, 40, 8);
  checkThat("a uniformly negative field is all outside", [...nothing.state].every((v) => v === OUTSIDE), true);
}

/* -------------------------------------------------------------------- ticks */

console.log("\n--- ticks ---");
check("niceStep(1)", niceStep(1), 1);
check("niceStep(3)", niceStep(3), 5);
check("niceStep(0.02)", niceStep(0.02), 0.02);
check("niceStep(7)", niceStep(7), 10);
check("ticks from -10 to 10", tickValues({ step: 5, min: -10, max: 10 }), [-10, -5, 0, 5, 10]);
check("ticks stay inside the span", tickValues({ step: 3, min: -10, max: 10 }), [-9, -6, -3, 0, 3, 6, 9]);
check("a silly span yields nothing rather than looping", tickValues({ step: 1e-12, min: -1e6, max: 1e6 }).length, 0);

/* -------------------------------------------------------------- persistence */

console.log("\n--- share links ---");
{
  const original = doc([
    expression("y = x^2", { label: "parabola", lineStyle: "dashed", domain: [-3, 3] }),
    slider("a", 2.5),
    { id: "p1", kind: "point", color: "#2f6feb", x: 1, y: 2, label: "P" },
    table("[1, 2]"),
  ]);
  const restored = decodeDocument(encodeDocument(original));
  check("item count survives", restored.items.length, 4);
  check("expression survives", restored.items[0]!.source, "y = x^2");
  check("label survives", (restored.items[0] as ExpressionItem).label, "parabola");
  check("line style survives", (restored.items[0] as ExpressionItem).lineStyle, "dashed");
  check("domain survives", (restored.items[0] as ExpressionItem).domain, [-3, 3]);
  check("slider survives", restored.items[1]!.kind === "slider" && restored.items[1]!.value, 2.5);
  check("point survives", restored.items[2]!.kind === "point" && restored.items[2]!.x, 1);
  check("viewport survives", restored.viewport, DEFAULT_VIEWPORT);
  checkThat(
    "settings survive",
    (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).every(
      (key) => restored.settings[key] === DEFAULT_SETTINGS[key],
    ),
    JSON.stringify(restored.settings),
  );
  checkThat("the encoded form is url safe", /^[A-Za-z0-9_-]+$/.test(encodeDocument(original)));
}

console.log("\n--- hostile input ---");
{
  const cleaned = sanitize({ items: "nonsense", viewport: { scale: -4 }, settings: { theme: "neon", grid: 7 } });
  check("garbage yields no items", cleaned.items.length, 0);
  check("negative scale is replaced", Number.isFinite(cleaned.viewport.scale) && cleaned.viewport.scale > 0, true);
  check("unknown theme falls back", cleaned.settings.theme, DEFAULT_SETTINGS.theme);
  check("unknown grid falls back", cleaned.settings.grid, DEFAULT_SETTINGS.grid);

  const partial = sanitize({ items: [{ kind: "expression", source: "y = x" }, { kind: "nope" }, null, { kind: "slider" }] });
  check("valid items survive, invalid are dropped", partial.items.length, 2);
  check("missing colour gets a default", /^#[0-9a-f]{6}$/i.test((partial.items[0] as ExpressionItem).color), true);
}

console.log(failures === 0 ? "\nALL BUILD CHECKS PASS" : `\n${failures} BUILD FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);