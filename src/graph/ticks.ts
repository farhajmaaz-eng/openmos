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

export interface TickLayout {
  /** Distance between major ticks, in graph units. */
  step: number;
  /** Graph units per label, used to thin out text on very dense axes. */
  labelStep: number;
  min: number;
  max: number;
}

/**
 * Choose ticks for a span. `targetLabels` is how many labelled ticks we would
 * like to fit along the axis.
 */
export function layoutTicks(min: number, max: number, targetLabels: number): TickLayout {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return { step: 1, labelStep: 1, min: 0, max: 1 };

  const step = niceStep(span / Math.max(1, targetLabels));
  const start = Math.ceil(min / step) * step;
  return { step, labelStep: step, min: start, max };
}

/**
 * Tick values inside a range, with a guard against the pathological case where
 * floating point drift would let the loop run away.
 */
export function tickValues(layout: TickLayout, limit = 512): number[] {
  const values: number[] = [];
  const span = layout.max - layout.min;
  const count = span / layout.step;
  if (!Number.isFinite(count) || count < 0 || count > limit) return values;

  const startIndex = Math.round(layout.min / layout.step);
  const lastIndex = Math.round(layout.max / layout.step);
  for (let i = startIndex; i <= lastIndex; i += 1) {
    const value = i * layout.step;
    if (value >= layout.min && value <= layout.max) values.push(value);
  }
  return values;
}

/** How many labelled ticks fit without overlapping at the given font size. */
export function labelBudget(pixels: number, labelWidth: number, desired: number): number {
  const fit = Math.floor(pixels / Math.max(labelWidth, 1));
  return Math.max(2, Math.min(desired, fit));
}

/**
 * Grid step for the faint background grid. Kept separate from the axis step so
 * the two can differ when the user turns axis labels off.
 */
export function gridStep(unitsPerPixel: number): number {
  return niceStep(unitsPerPixel * 48);
}

export { formatTick };