import { formatTick } from "../math/format";

/**
 * Axis ticks.
 *
 * The step has to land on 1, 2 or 5 times a power of ten, and it has to be big
 * enough that labels never collide but small enough that the grid stays useful.
 */

const NICE_STEPS = [1, 2, 5];

export function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const normalized = target / magnitude;
  for (const step of NICE_STEPS) {
    if (normalized <= step) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface TickSpan {
  /** Distance between ticks, in graph units. */
  step: number;
  min: number;
  max: number;
}

/**
 * Tick values inside a range, with a guard against the pathological case where
 * floating point drift would let the loop run away.
 */
export function tickValues(span: TickSpan, limit = 512): number[] {
  const values: number[] = [];
  const count = (span.max - span.min) / span.step;
  if (!Number.isFinite(count) || count < 0 || count > limit) return values;

  const first = Math.round(span.min / span.step);
  const last = Math.round(span.max / span.step);
  for (let i = first; i <= last; i += 1) {
    const value = i * span.step;
    if (value >= span.min && value <= span.max) values.push(value);
  }
  return values;
}

/**
 * Grid step for the faint background grid. Kept separate from the axis step so
 * the two can differ when the user turns axis labels off.
 */
export function gridStep(unitsPerPixel: number): number {
  return niceStep(unitsPerPixel * 48);
}

export { formatTick };