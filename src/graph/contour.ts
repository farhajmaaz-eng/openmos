/**
 * Sampling a scalar field.
 *
 * Implicit curves (`x^2 + y^2 = 9`) and shaded regions (`y > x^2`) are both
 * "where does this field cross zero" questions, and both want to answer them
 * without evaluating the field everywhere.
 *
 * A uniform grid does evaluate everywhere: a 1000x900 window at two cells per
 * pixel is 160k samples per expression, per frame, and two or three such
 * expressions put a frame well past 200ms. Instead both routines start from a
 * coarse grid and recurse only into blocks whose corners disagree about the
 * sign, which cuts the work down to roughly the length of the boundary.
 */

export interface ContourSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FieldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Interpolate where a value crosses zero along one edge. */
function crossing(
  ax: number,
  ay: number,
  av: number,
  bx: number,
  by: number,
  bv: number,
): [number, number] {
  const denominator = av - bv;
  const t = denominator === 0 ? 0.5 : Math.min(1, Math.max(0, av / denominator));
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function positive(value: number, epsilon: number): boolean {
  return value > epsilon;
}

interface Corners {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

/**
 * Marching squares over one cell, given its four corner values. Returns the
 * segments that cross zero inside it.
 *
 * Two opposite corners inside (codes 5 and 10) are saddles; the segments are
 * joined so the two regions touch at a point rather than one swallowing the
 * other.
 */
function cellSegments(x0: number, y0: number, x1: number, y1: number, corners: Corners, out: ContourSegment[]): void {
  const { tl, tr, br, bl } = corners;
  if (!Number.isFinite(tl) || !Number.isFinite(tr) || !Number.isFinite(br) || !Number.isFinite(bl)) return;
  const code = (positive(tl, 0) ? 1 : 0) | (positive(tr, 0) ? 2 : 0) | (positive(br, 0) ? 4 : 0) | (positive(bl, 0) ? 8 : 0);
  if (code === 0 || code === 15) return;

  const top = () => crossing(x0, y0, tl, x1, y0, tr);
  const right = () => crossing(x1, y0, tr, x1, y1, br);
  const bottom = () => crossing(x0, y1, bl, x1, y1, br);
  const left = () => crossing(x0, y0, tl, x0, y1, bl);
  const push = (a: [number, number], b: [number, number]) => out.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });

  switch (code) {
    case 1:
    case 14:
      push(left(), top());
      break;
    case 2:
    case 13:
      push(top(), right());
      break;
    case 3:
    case 12:
      push(left(), right());
      break;
    case 4:
    case 11:
      push(right(), bottom());
      break;
    case 6:
    case 9:
      push(top(), bottom());
      break;
    case 7:
    case 8:
      push(left(), bottom());
      break;
    case 5:
      push(left(), top());
      push(right(), bottom());
      break;
    case 10:
      push(left(), bottom());
      push(top(), right());
      break;
    default:
      break;
  }
}

export interface ContourOptions extends FieldBounds {
  /** Finest cell edge, in graph units. Usually a couple of pixels. */
  minCell: number;
  /** Side of the grid the search starts from. Defaults to the window size. */
  baseCells?: number;
}

/** Enough refinement to go from a block of a few pixels down to sub-pixel. */
const MAX_DEPTH = 6;

/**
 * Side, in pixels, of the grid the search starts from.
 *
 * Every starting block costs five samples whatever it contains, so this is the
 * floor on a frame's work: five per block here, plus a few more for the blocks
 * that actually straddle something. Sixteen pixels is coarse enough to keep
 * that floor low and fine enough that a curve smaller than this would not be
 * worth resolving.
 */
export const CONTOUR_BASE_PIXELS = 16;

/**
 * Trace the zero contour of `field`, refining only where the sign changes.
 *
 * A block is accepted as empty once its corners and its centre agree about the
 * sign. That can still miss a closed curve sitting wholly inside one block, so
 * the starting grid is kept around a dozen pixels across — a blob smaller than
 * that would not be worth resolving anyway.
 */
export function contourSegments(
  field: (x: number, y: number) => number,
  options: ContourOptions,
): ContourSegment[] {
  const { minX, maxX, minY, maxY } = options;
  const span = Math.max(maxX - minX, maxY - minY);
  const minCell = Math.max(options.minCell, Math.abs(span) * 1e-12);
  const baseCells = Math.max(2, Math.min(options.baseCells ?? 40, 512));

  const segments: ContourSegment[] = [];

  const visit = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
    const tl = field(x0, y0);
    const tr = field(x1, y0);
    const br = field(x1, y1);
    const bl = field(x0, y1);

    const corners =
      (positive(tl, 0) ? 1 : 0) |
      (positive(tr, 0) ? 2 : 0) |
      (positive(br, 0) ? 4 : 0) |
      (positive(bl, 0) ? 8 : 0);

    // Accept a block as soon as its corners and its centre agree about the
    // sign. `corners` is 0 when all four are below zero and 15 when all four
    // are above; anything else has to be refined.
    if (corners === 0 || corners === 15) {
      const middle = field((x0 + x1) / 2, (y0 + y1) / 2);
      if (!Number.isFinite(middle) || positive(middle, 0) === positive(tl, 0)) return;
    }

    if (x1 - x0 <= minCell && y1 - y0 <= minCell) {
      cellSegments(x0, y0, x1, y1, { tl, tr, br, bl }, segments);
      return;
    }

    if (depth >= MAX_DEPTH) {
      if (Number.isFinite(tl) && Number.isFinite(tr) && Number.isFinite(br) && Number.isFinite(bl)) {
        cellSegments(x0, y0, x1, y1, { tl, tr, br, bl }, segments);
      }
      return;
    }

    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    visit(x0, y0, midX, midY, depth + 1);
    visit(midX, y0, x1, midY, depth + 1);
    visit(x0, midY, midX, y1, depth + 1);
    visit(midX, midY, x1, y1, depth + 1);
  };

  const stepX = (maxX - minX) / baseCells;
  const stepY = (maxY - minY) / baseCells;
  for (let column = 0; column < baseCells; column += 1) {
    const x0 = minX + column * stepX;
    const x1 = column === baseCells - 1 ? maxX : x0 + stepX;
    for (let row = 0; row < baseCells; row += 1) {
      const y0 = minY + row * stepY;
      const y1 = row === baseCells - 1 ? maxY : y0 + stepY;
      visit(x0, y0, x1, y1, 0);
    }
  }

  return segments;
}

/* --------------------------------------------------------------- regions */

/**
 * Classify the window into blocks that are entirely inside, entirely outside,
 * or straddle the boundary. Filling only has to evaluate the field in the
 * straddling blocks, so the cost follows the boundary rather than the area.
 */
export interface FillPartition {
  /** Blocks across and down the pixel grid. */
  columns: number;
  rows: number;
  /** Block edge, in pixels. */
  block: number;
  /** 1 inside, 0 outside, 2 varies across the block. */
  state: Uint8Array;
}

export const INSIDE = 1;
export const OUTSIDE = 0;
export const MIXED = 2;

export function partitionField(
  field: (x: number, y: number) => number,
  bounds: FieldBounds,
  width: number,
  height: number,
  block = 8,
): FillPartition {
  const columns = Math.max(1, Math.ceil(width / block));
  const rows = Math.max(1, Math.ceil(height / block));
  const state = new Uint8Array(columns * rows);

  const spanX = (bounds.maxX - bounds.minX) / width;
  const spanY = (bounds.maxY - bounds.minY) / height;
  const at = (pixelX: number, pixelY: number) => field(bounds.minX + pixelX * spanX, bounds.maxY - pixelY * spanY);

  for (let row = 0; row < rows; row += 1) {
    const top = row * block;
    const bottom = Math.min(height, top + block) - 1;
    for (let column = 0; column < columns; column += 1) {
      const left = column * block;
      const right = Math.min(width, left + block) - 1;
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;

      // A 3x3 probe. Corners alone miss a boundary that clips a corner, and a
      // block wrongly called uniform is painted as a hard rectangle, which shows
      // up as a staircase along the edge of a region.
      let positive = 0;
      let valid = 0;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const value = at(i === 1 ? midX : i === 0 ? left : right, j === 1 ? midY : j === 0 ? top : bottom);
          if (!Number.isFinite(value)) continue;
          valid += 1;
          if (value > 0) positive += 1;
        }
      }

      state[row * columns + column] =
        valid === 0 || positive === 0
          ? OUTSIDE
          : positive === valid
            ? INSIDE
            : MIXED;
    }
  }

  // Widen the mixed set by one block. A block the probes read as uniform can
  // still clip a boundary that passes through its middle; without this the
  // painted rectangle ends short of the neighbouring block's per-pixel edge and
  // the region grows a visible staircase.
  const widened = state.slice();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (state[row * columns + column] !== MIXED) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const y = row + dy;
          const x = column + dx;
          if (y < 0 || y >= rows || x < 0 || x >= columns) continue;
          widened[y * columns + x] = MIXED;
        }
      }
    }
  }

  return { columns, rows, block, state: widened };
}