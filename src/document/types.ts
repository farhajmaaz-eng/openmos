/**
 * The document: an ordered list of items plus the settings that affect how
 * they draw. Everything is plain JSON so a document round-trips through
 * localStorage or a share link without any special casing.
 */

export type ItemKind = "expression" | "table" | "slider" | "point";

export interface BaseItem {
  id: string;
  kind: ItemKind;
  color: string;
  /** Hidden items stay in the list but do not draw. */
  hidden?: boolean;
}

export type FillStyle = "solid" | "semi" | "none";

export interface ExpressionItem extends BaseItem {
  kind: "expression";
  /** Source text exactly as typed. */
  source: string;
  /** Override for the label shown on the graph; defaults to the source. */
  label?: string;
  /** `dotted` and `dashed` are used to distinguish overlapping curves. */
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Restrict the curve to a domain, for piecewise-free clipping. */
  domain?: [number, number];
  /** Restrict a parametric curve's parameter range. */
  parameterDomain?: [number, number];
  /** Show the enclosed region for inequalities. */
  fill?: FillStyle;
  /** Render a solid disc of the expression's value instead of a curve. */
  labelHidden?: boolean;
}

export interface TableItem extends BaseItem {
  kind: "table";
  source: string;
}

export interface SliderItem extends BaseItem {
  kind: "slider";
  variable: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Snap to `step` while dragging. */
  animate?: boolean;
}

export interface PointItem extends BaseItem {
  kind: "point";
  x: number;
  y: number;
  label?: string;
  /** Constrain the point to a curve, e.g. `y = x^2`. */
  constraint?: string;
}

export type Item = ExpressionItem | TableItem | SliderItem | PointItem;

export type ThemeName = "light" | "dark" | "system";
export type GridStyle = "solid" | "dashed" | "dotted" | "none";
export type LabelSize = "auto" | "small" | "normal" | "large";

export interface Viewport {
  /** Horizontal centre of the window, in graph units. */
  x: number;
  y: number;
  /** Graph units per CSS pixel. */
  scale: number;
}

export interface Settings {
  theme: ThemeName;
  grid: GridStyle;
  showAxes: boolean;
  showNumbers: boolean;
  showOrigin: boolean;
  showXAxis: boolean;
  showYAxis: boolean;
  degrees: boolean;
  /** Draw the label box for the most recent expression. */
  labelSize: LabelSize;
  /** Show the coordinate readout while dragging. */
  showDragHint: boolean;
  /** Turn on the table view below the expression list. */
  tablesVisible: boolean;
}

export interface Document {
  items: Item[];
  viewport: Viewport;
  settings: Settings;
  /** Bumped whenever an item is added or removed, to renumber the rows. */
  seed: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  grid: "solid",
  showAxes: true,
  showNumbers: true,
  showOrigin: true,
  showXAxis: true,
  showYAxis: true,
  degrees: false,
  labelSize: "auto",
  showDragHint: true,
  tablesVisible: true,
};

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 / 48 };

/**
 * Colours for the first few expressions. The sequence is fixed rather than
 * generated so that adding a row never reshuffles the ones above it.
 */
export const PALETTE = [
  "#2f6feb",
  "#d1483c",
  "#17916b",
  "#8a4fd3",
  "#c77b11",
  "#0f8ba8",
  "#c4378f",
  "#5c6f7d",
  "#7a5c3e",
  "#4a7c2f",
] as const;

export function colorAt(index: number): string {
  return PALETTE[index % PALETTE.length]!;
}

let counter = 0;

/** Short, collision-resistant enough for a single document. */
export function nextId(prefix = "i"): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}${counter.toString(36)}${random}`;
}