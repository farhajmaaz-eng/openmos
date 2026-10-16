/**
 * Marching squares over a scalar field.
 *
 * Implicit curves (`x^2 + y^2 = 9`) and inequality shading (`y > x^2`) both
 * come down to finding where a field crosses zero. Evaluating on a grid and
 * stitching the crossings into geometry is the cheapest way to get smooth
 * results without solving anything analytically.
 */

export interface ContourSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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

export interface ContourOptions {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Cells across and down. The window is not square, so neither is the grid. */
  columns: number;
  rows: number;
  /** Treat values in (-epsilon, epsilon) as exactly zero. */
  epsilon?: number;
}

const MAX_CELLS = 400;

/**
 * Trace the zero contour of `field` as a list of segments.
 *
 * Corner samples are cached, so a curve that loops back over part of the grid
 * does not pay to evaluate the same point twice.
 */
export function contourSegments(
  field: (x: number, y: number) => number,
  options: ContourOptions,
): ContourSegment[] {
  const { minX, maxX, minY, maxY } = options;
  const epsilon = options.epsilon ?? 0;

  const columns = clampCells(options.columns);
  const rows = clampCells(options.rows);
  const stepX = (maxX - minX) / columns;
  const stepY = (maxY - minY) / rows;

  const width = columns + 1;
  const cache = new Float64Array(width * (rows + 1));
  const filled = new Uint8Array(width * (rows + 1));

  const at = (column: number, row: number): number => {
    const index = row * width + column;
    if (filled[index] === 0) {
      const value = field(minX + column * stepX, minY + row * stepY);
      cache[index] = Number.isFinite(value) ? value : NaN;
      filled[index] = 1;
    }
    return cache[index]!;
  };

  const segments: ContourSegment[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = minX + column * stepX;
      const y0 = minY + row * stepY;
      const x1 = x0 + stepX;
      const y1 = y0 + stepY;

      const v0 = at(column, row);
      const v1 = at(column + 1, row);
      const v2 = at(column + 1, row + 1);
      const v3 = at(column, row + 1);
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;

      // bit 0 = v0 (top-left), 1 = v1 (top-right), 2 = v2, 3 = v3 (bottom-left)
      const code = (v0 > epsilon ? 1 : 0) | (v1 > epsilon ? 2 : 0) | (v2 > epsilon ? 4 : 0) | (v3 > epsilon ? 8 : 0);
      if (code === 0 || code === 15) continue;

      const top = () => crossing(x0, y0, v0, x1, y0, v1);
      const right = () => crossing(x1, y0, v1, x1, y1, v2);
      const bottom = () => crossing(x0, y1, v3, x1, y1, v2);
      const left = () => crossing(x0, y0, v0, x0, y1, v3);

      switch (code) {
        case 1:
        case 14:
          segments.push({ x0: left()[0], y0: left()[1], x1: top()[0], y1: top()[1] });
          break;
        case 2:
        case 13:
          segments.push({ x0: top()[0], y0: top()[1], x1: right()[0], y1: right()[1] });
          break;
        case 3:
        case 12:
          segments.push({ x0: left()[0], y0: left()[1], x1: right()[0], y1: right()[1] });
          break;
        case 4:
        case 11:
          segments.push({ x0: right()[0], y0: right()[1], x1: bottom()[0], y1: bottom()[1] });
          break;
        case 6:
        case 9:
          segments.push({ x0: top()[0], y0: top()[1], x1: bottom()[0], y1: bottom()[1] });
          break;
        case 7:
        case 8:
          segments.push({ x0: left()[0], y0: left()[1], x1: bottom()[0], y1: bottom()[1] });
          break;
        case 5: {
          // Saddle: exactly two opposite corners are inside. Join them so the
          // two regions touch at a point instead of one swallowing the other.
          const pairs: Array<[() => [number, number], () => [number, number]]> =
            code === 5
              ? [[left, top], [right, bottom]]
              : [[left, bottom], [top, right]];
          for (const [a, b] of pairs) {
            const p = a();
            const q = b();
            segments.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1] });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return segments;
}

/** A flat list of vertices, ready to hand to `ctx.fill()`. */
export type FillPolygon = number[];

/**
 * Cover the cells where `field * sign > 0` with polygons that follow the
 * boundary. Marching squares gives us the geometry per cell, so the fill hugs
 * the curve instead of showing a staircase.
 */
export function fillPolygons(
  field: (x: number, y: number) => number,
  options: ContourOptions & { sign: number },
): FillPolygon[] {
  const { minX, maxX, minY, maxY, sign } = options;
  const epsilon = options.epsilon ?? 0;

  const columns = clampCells(options.columns);
  const rows = clampCells(options.rows);
  const stepX = (maxX - minX) / columns;
  const stepY = (maxY - minY) / rows;

  const width = columns + 1;
  const cache = new Float64Array(width * (rows + 1));
  const filled = new Uint8Array(width * (rows + 1));

  const at = (column: number, row: number): number => {
    const index = row * width + column;
    if (filled[index] === 0) {
      const value = field(minX + column * stepX, minY + row * stepY);
      cache[index] = Number.isFinite(value) ? value * sign : NaN;
      filled[index] = 1;
    }
    return cache[index]!;
  };

  const polygons: FillPolygon[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = minX + column * stepX;
      const y0 = minY + row * stepY;
      const x1 = x0 + stepX;
      const y1 = y0 + stepY;

      const v0 = at(column, row);
      const v1 = at(column + 1, row);
      const v2 = at(column + 1, row + 1);
      const v3 = at(column, row + 1);
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;

      const code = (v0 > epsilon ? 1 : 0) | (v1 > epsilon ? 2 : 0) | (v2 > epsilon ? 4 : 0) | (v3 > epsilon ? 8 : 0);
      if (code === 0) continue;

      const top = crossing(x0, y0, v0, x1, y0, v1);
      const right = crossing(x1, y0, v1, x1, y1, v2);
      const bottom = crossing(x0, y1, v3, x1, y1, v2);
      const left = crossing(x0, y0, v0, x0, y1, v3);

      if (code === 15) {
        polygons.push([x0, y0, x1, y0, x1, y1, x0, y1]);
        continue;
      }

      switch (code) {
        case 1:
          polygons.push([x0, y0, left[0], left[1], top[0], top[1]]);
          break;
        case 2:
          polygons.push([x1, y0, right[0], right[1], top[0], top[1]]);
          break;
        case 4:
          polygons.push([x1, y1, right[0], right[1], bottom[0], bottom[1]]);
          break;
        case 8:
          polygons.push([x0, y1, left[0], left[1], bottom[0], bottom[1]]);
          break;
        case 7:
          polygons.push([x0, y0, x1, y0, x1, y1, bottom[0], bottom[1], left[0], left[1]]);
          break;
        case 11:
          polygons.push([x1, y0, x1, y1, x0, y1, left[0], left[1], top[0], top[1]]);
          break;
        case 13:
          polygons.push([x0, y0, x1, y0, right[0], right[1], bottom[0], bottom[1], x0, y1]);
          break;
        case 14:
          polygons.push([x0, y0, left[0], left[1], bottom[0], bottom[1], x1, y1, x1, y0]);
          break;
        case 5: {
          const centre = (v0 + v1 + v2 + v3) / 4;
          if (centre > 0) {
            polygons.push([x0, y0, left[0], left[1], top[0], top[1]]);
            polygons.push([x1, y1, right[0], right[1], bottom[0], bottom[1]]);
          } else {
            polygons.push([x1, y0, right[0], right[1], top[0], top[1]]);
            polygons.push([x0, y1, left[0], left[1], bottom[0], bottom[1]]);
          }
          break;
        }
        case 10: {
          const centre = (v0 + v1 + v2 + v3) / 4;
          if (centre > 0) {
            polygons.push([x1, y0, right[0], right[1], top[0], top[1]]);
            polygons.push([x0, y1, left[0], left[1], bottom[0], bottom[1]]);
          } else {
            polygons.push([x0, y0, left[0], left[1], top[0], top[1]]);
            polygons.push([x1, y1, right[0], right[1], bottom[0], bottom[1]]);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return polygons;
}
function clampCells(value: number): number {
  return Math.max(2, Math.min(Math.round(value), MAX_CELLS));
}
