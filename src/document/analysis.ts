import type { CurveDrawable, Drawable, GraphScope } from "./build";
import type { PointItem, Viewport } from "./types";

/**
 * Sampling, arithmetic and framing that the UI asks for but that needs no
 * document of its own. Keeping it here means the same numbers back the graph,
 * the row readouts and the tests.
 */

/** A graph-space rectangle. */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const SAMPLES = 1200;

/**
 * Where the plotted things are.
 *
 * Each drawable is asked separately and its window widens until it holds some
 * data, starting from the current view. Asking separately is what lets an
 * off-screen circle be found while a parabola that is already on screen stays
 * put, instead of one hungry curve dragging the fit out to infinity.
 *
 * Stopping at the first hit is deliberate. `x^2` has no extent to find, so a
 * search that keeps widening because the data reaches the edge would never
 * stop; what is on screen is the best that can be asked of an unbounded curve.
 */
export function dataBounds(
  drawables: Drawable[],
  points: PointItem[],
  scope: GraphScope,
  viewport: Viewport,
  size: { width: number; height: number },
): Box | null {
  const start = Math.max(
    (Math.max(size.width, 1) / 2) * viewport.scale,
    (Math.max(size.height, 1) / 2) * viewport.scale,
    1e-6,
  );

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const widen = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const point of points) widen(point.x, point.y);

  for (const drawable of drawables) {
    const extent = extentOf(drawable, scope, viewport, start);
    if (!extent) continue;
    widen(extent.minX, extent.minY);
    widen(extent.maxX, extent.minY);
    widen(extent.minX, extent.maxY);
    widen(extent.maxX, extent.maxY);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  // A flat line has no height to show; give it something so the view does not
  // collapse onto it.
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const padX = spanX > 0 ? spanX * 0.08 : start * 0.8;
  const padY = spanY > 0 ? spanY * 0.08 : start * 0.8;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

/** One drawable's extent, found by widening until something appears. */
function extentOf(
  drawable: Drawable,
  scope: GraphScope,
  viewport: Viewport,
  start: number,
): Box | null {
  let reach = start;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const window: Box = {
      minX: viewport.x - reach,
      maxX: viewport.x + reach,
      minY: viewport.y - reach,
      maxY: viewport.y + reach,
    };

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    sampleDrawable(drawable, scope, window, (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });

    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      return { minX, maxX, minY, maxY };
    }
    reach *= 4;
  }

  return null;
}

function sampleDrawable(
  drawable: Drawable,
  scope: GraphScope,
  box: Box,
  widen: (x: number, y: number) => void,
): void {
  if (drawable.kind === "curve") {
    const [domainMin, domainMax] = drawable.domain ?? [box.minX, box.maxX];
    const low = Math.max(box.minX, domainMin);
    const high = Math.min(box.maxX, domainMax);
    if (!(high > low)) return;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const x = low + ((high - low) * i) / SAMPLES;
      widen(x, evaluate(drawable.fn, x, scope));
    }
  } else if (drawable.kind === "parametric") {
    const [from, to] = drawable.domain;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = from + ((to - from) * i) / SAMPLES;
      const [x, y] = evaluatePair(drawable.fn, t, scope);
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) widen(x, y);
    }
  } else if (drawable.kind === "implicit" || drawable.kind === "region") {
    // A field has no parametric form to walk, so look for sign changes along a
    // coarse grid and refine each one. Good enough to frame a circle.
    widenField(drawable.field, scope, box, widen);
  }
}

/** The viewport that frames a box, leaving a little air around it. */
export function viewportFor(box: Box, size: { width: number; height: number }): Viewport {
  const width = Math.max(size.width, 1);
  const height = Math.max(size.height, 1);
  const spanX = Math.max(box.maxX - box.minX, 1e-9);
  const spanY = Math.max(box.maxY - box.minY, 1e-9);
  const scale = Math.max(spanX / width, spanY / height);
  return {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    scale,
  };
}

/**
 * Definite integral by composite Simpson's rule.
 *
 * A range that runs off a pole or a gap gives up and reports `null` rather than
 * a number that means nothing.
 */
export function integrate(
  fn: (x: number, scope: GraphScope) => number,
  scope: GraphScope,
  from: number,
  to: number,
  panels = 600,
): number | null {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high === low) return null;

  // Simpson's rule needs an even number of intervals.
  const count = Math.max(2, Math.min(panels, 4000) & ~1);
  const step = (high - low) / count;

  let total = 0;
  for (let i = 0; i <= count; i += 1) {
    const x = low + i * step;
    const value = evaluate(fn, x, scope);
    if (!Number.isFinite(value)) return null;
    const weight = i === 0 || i === count ? 1 : i % 2 === 1 ? 4 : 2;
    total += weight * value;
  }

  return (total * step) / 3;
}

/**
 * Slope by central difference.
 *
 * The step is chosen from the window the graph is drawn in, so the answer is
 * meaningful whether the user is looking at x from 0 to 1 or from 0 to 1000.
 */
export function slope(
  fn: (x: number, scope: GraphScope) => number,
  scope: GraphScope,
  x: number,
  scale: number,
): number | null {
  if (!Number.isFinite(x)) return null;
  const h = Math.max(Math.abs(x), scale * 4) * 1e-5;
  const before = evaluate(fn, x - h, scope);
  const after = evaluate(fn, x + h, scope);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const result = (after - before) / (2 * h);
  return Number.isFinite(result) ? result : null;
}

export interface Crossing {
  x: number;
  y: number;
}

/**
 * Where two curves meet, inside a window.
 *
 * Only sign changes are found, so a curve that just touches another at a cusp
 * is missed. That is the common enough case that a bracket search beats a
 * general solver here, and it cannot wander off to a root somewhere else.
 */
export function findIntersections(
  a: CurveDrawable,
  b: CurveDrawable,
  scope: GraphScope,
  window: Box,
  samples = 800,
): Crossing[] {
  const lowX = Math.max(window.minX, a.domain?.[0] ?? -Infinity, b.domain?.[0] ?? -Infinity);
  const highX = Math.min(window.maxX, a.domain?.[1] ?? Infinity, b.domain?.[1] ?? Infinity);
  if (!(highX > lowX)) return [];

  const step = (highX - lowX) / samples;
  const difference = (x: number) => evaluate(a.fn, x, scope) - evaluate(b.fn, x, scope);
  const record = (found: Crossing[], x: number) => {
    const y = evaluate(a.fn, x, scope);
    if (Number.isFinite(y)) found.push({ x, y });
  };

  const found: Crossing[] = [];

  // Track the last *non-zero* sign rather than the last value. A sample landing
  // exactly on a root is the common case for tidy curves — `x^2` against `x + 2`
  // hits both roots on the grid — and watching raw signs would step straight
  // over them, because a zero either side of a root never has a sign change.
  let sign = Math.sign(difference(lowX) ?? NaN);
  if (Number.isNaN(sign)) sign = 0;
  if (sign === 0) record(found, lowX);

  let lastX = lowX;
  let lastValue = difference(lowX);

  for (let i = 1; i <= samples; i += 1) {
    const x = lowX + i * step;
    const value = difference(x);

    if (!Number.isFinite(value)) {
      // A gap in one of the curves breaks the run; start again after it.
      sign = 0;
      lastValue = NaN;
      continue;
    }

    const current = Math.sign(value);

    if (current === 0) {
      record(found, x);
      sign = 0;
      lastValue = 0;
      continue;
    }

    if (sign !== 0 && current !== sign && Number.isFinite(lastValue)) {
      let left = lastX;
      let right = x;
      let leftValue = lastValue;
      for (let k = 0; k < 60 && right - left > step * 1e-9; k += 1) {
        const middle = (left + right) / 2;
        const middleValue = difference(middle);
        if (!Number.isFinite(middleValue)) break;
        if (leftValue * middleValue <= 0) {
          right = middle;
        } else {
          left = middle;
          leftValue = middleValue;
        }
      }
      record(found, (left + right) / 2);
    }

    sign = current;
    lastX = x;
    lastValue = value;
  }

  return dedupe(found, step);
}

/** Merge roots that the same crossing produced twice. */
function dedupe(crossings: Crossing[], tolerance: number): Crossing[] {
  const out: Crossing[] = [];
  for (const crossing of crossings) {
    if (out.some((existing) => Math.abs(existing.x - crossing.x) <= tolerance * 4)) continue;
    out.push(crossing);
  }
  return out;
}

/* ------------------------------------------------------------------ helpers */

const FIELD_GRID = 72;

/** Widen the box to the zero set of a field, found by scanning rows. */
function widenField(
  field: (x: number, y: number, scope: GraphScope) => number,
  scope: GraphScope,
  box: Box,
  widen: (x: number, y: number) => void,
): void {
  const fieldValue = (x: number, y: number) => {
    try {
      return field(x, y, scope);
    } catch {
      return NaN;
    }
  };

  const { minX: left, maxX: right, minY: bottom, maxY: top } = box;
  const stepX = (right - left) / FIELD_GRID;
  const stepY = (top - bottom) / FIELD_GRID;

  for (let row = 0; row <= FIELD_GRID; row += 1) {
    const y = top - row * stepY;
    let previousX = left;
    let previous = fieldValue(previousX, y);

    for (let column = 1; column <= FIELD_GRID; column += 1) {
      const x = left + column * stepX;
      const value = fieldValue(x, y);

      if (Number.isFinite(previous) && Number.isFinite(value) && previous * value < 0) {
        let lo = previousX;
        let hi = x;
        let loValue = previous;
        for (let k = 0; k < 40 && hi - lo > stepX * 1e-6; k += 1) {
          const middle = (lo + hi) / 2;
          const middleValue = fieldValue(middle, y);
          if (!Number.isFinite(middleValue)) break;
          if (loValue * middleValue <= 0) hi = middle;
          else {
            lo = middle;
            loValue = middleValue;
          }
        }
        widen((lo + hi) / 2, y);
      }

      previousX = x;
      previous = value;
    }
  }
}

function evaluate(fn: (x: number, scope: GraphScope) => number, x: number, scope: GraphScope): number {
  try {
    return fn(x, scope);
  } catch {
    return NaN;
  }
}

function evaluatePair(
  fn: (t: number, scope: GraphScope) => [number, number],
  t: number,
  scope: GraphScope,
): [number, number] {
  try {
    const [x, y] = fn(t, scope);
    return [x, y];
  } catch {
    return [NaN, NaN];
  }
}