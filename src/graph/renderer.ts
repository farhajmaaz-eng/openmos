import type {
  CurveDrawable,
  Drawable,
  GraphScope,
  ImplicitDrawable,
  ParametricDrawable,
  RegionDrawable,
} from "../document/build";
import type { PointItem, Settings, Viewport } from "../document/types";
import { formatTick } from "../math/format";
import {
  CONTOUR_BASE_PIXELS,
  INSIDE,
  MIXED,
  contourSegments,
  partitionField,
  type ContourOptions,
  type ContourSegment,
} from "./contour";
import { gridStep, niceStep, tickValues } from "./ticks";
import { slope } from "../document/analysis";

/** Colours the renderer needs, resolved from the document theme. */
export interface Palette {
  grid: string;
  gridStrong: string;
  axis: string;
  label: string;
  point: string;
  pointLabel: string;
  background: string;
  sliderHandle: string;
}

export const LIGHT_PALETTE: Palette = {
  grid: "#e3e6ea",
  gridStrong: "#d3d8de",
  axis: "#8d949c",
  label: "#6b7280",
  point: "#3d4550",
  pointLabel: "#3d4550",
  background: "#ffffff",
  sliderHandle: "#ffffff",
};

export const DARK_PALETTE: Palette = {
  grid: "#262a31",
  gridStrong: "#31363f",
  axis: "#6f7780",
  label: "#9aa3ad",
  point: "#c3cad3",
  pointLabel: "#c3cad3",
  background: "#16181d",
  sliderHandle: "#16181d",
};

export interface LabelBox {
  text: string;
  x: number;
  y: number;
  color: string;
  /** Draw a dot in the curve's colour, as Desmos does for expression labels. */
  dot: boolean;
  emphasis: boolean;
}

export interface AxisSample {
  /** Graph-space x the last evaluated sample landed on. */
  x: number;
  y: number;
  color: string;
}

/** Props the renderer needs; kept as a plain object so React can hand it over. */
export interface RenderInput {
  viewport: Viewport;
  width: number;
  height: number;
  drawables: Drawable[];
  points: PointItem[];
  scope: GraphScope;
  settings: Settings;
  palette: Palette;
  devicePixelRatio: number;
  /** Rows whose label should be drawn highlighted. */
  focusedId: string | null;
  /** Graph-space x under the pointer, for tangent lines. */
  hoverX: number | null;
}

export interface FrameResult {
  /** Screen position of the axis-following label for the focused row. */
  label: LabelBox | null;
  axisSample: AxisSample | null;
  /** How long the frame took, in milliseconds. */
  duration: number;
}

/** Offscreen buffer used to shade inequality regions. */
interface FillBuffer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  image: ImageData | null;
}

const AXIS_MARGIN = 28;
const MIN_SCALE = 1e-11;
const MAX_SCALE = 1e9;

export class GraphRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private transform = new Transform({ x: 0, y: 0, scale: 1 }, 1, 1);
  private offscreen: FillBuffer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("openmos needs canvas 2d support");
    this.context = context;
  }

  /** Match the backing store to the element's CSS size and pixel density. */
  resize(width: number, height: number, devicePixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.dpr = Math.max(1, Math.min(devicePixelRatio, 2.5));

    const targetWidth = Math.floor(this.width * this.dpr);
    const targetHeight = Math.floor(this.height * this.dpr);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  draw(input: RenderInput): FrameResult {
    const started = performance.now();
    const { context } = this;
    const { viewport, palette } = input;

    context.save();
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.fillStyle = palette.background;
    context.fillRect(0, 0, this.width, this.height);

    const transform = new Transform(viewport, this.width, this.height);
    this.transform = transform;
    const labels: LabelBox[] = [];

    this.drawGrid(input, transform);
    this.drawAxes(input, transform);

    const axisSample: AxisSample | null = { x: 0, y: 0, color: "#000000" };
    let axisSampleSet = false;

    for (const drawable of input.drawables) {
      switch (drawable.kind) {
        case "curve":
          this.drawCurve(drawable, input, transform, labels);
          break;
        case "parametric":
          this.drawParametric(drawable, input, transform, labels);
          break;
        case "implicit":
          this.drawImplicit(drawable, input);
          break;
        case "region":
          this.drawRegion(drawable, input);
          break;
        default:
          break;
      }
    }

    this.drawPoints(input, transform);

    if (input.focusedId) {
      const focus = input.drawables.find((drawable) => drawable.id === input.focusedId);
      if (focus && focus.kind === "curve") {
        axisSample.x = transform.toX(0);
        axisSample.y = transform.toY(this.sampleForAxis(focus, input));
        axisSample.color = focus.color;
        axisSampleSet = true;
      }
    }

    this.drawLabels(labels, input);

    context.restore();

    return {
      label: labels.find((box) => box.emphasis) ?? null,
      axisSample: axisSampleSet ? axisSample : null,
      duration: performance.now() - started,
    };
  }

  private sampleForAxis(drawable: CurveDrawable, input: RenderInput): number {
    const x = input.viewport.x;
    try {
      return drawable.fn(x, input.scope);
    } catch {
      return NaN;
    }
  }

  /* ------------------------------------------------------------------ grid */

  private drawGrid(input: RenderInput, transform: Transform): void {
    const { settings, palette } = input;
    if (settings.grid === "none") return;

    const { minX, maxX, minY, maxY } = transform.bounds();
    const step = gridStep(input.viewport.scale);
    const xs = tickValues({ step, min: minX, max: maxX }, 2000);
    const ys = tickValues({ step, min: minY, max: maxY }, 2000);
    if (xs.length === 0 && ys.length === 0) return;

    const context = this.context;
    context.save();
    context.beginPath();

    for (const x of xs) {
      const px = Math.round(transform.toX(x)) + 0.5;
      context.moveTo(px, 0);
      context.lineTo(px, this.height);
    }
    for (const y of ys) {
      const py = Math.round(transform.toY(y)) + 0.5;
      context.moveTo(0, py);
      context.lineTo(this.width, py);
    }

    context.strokeStyle = palette.grid;
    context.lineWidth = 1;
    if (settings.grid === "dashed") context.setLineDash([4, 4]);
    else if (settings.grid === "dotted") {
      context.setLineDash([1, 3]);
      context.lineWidth = 1.5;
    }
    context.stroke();

    // A slightly stronger line every fifth step gives the eye something to
    // count against without doubling the number of strokes.
    // A slightly stronger line every fifth step gives the eye something to
    // count against without doubling the number of strokes. Dotted grids skip
    // it, since a heavier dotted line just reads as noise.
    if (step > 0 && (settings.grid === "solid" || settings.grid === "dashed")) {
      const major = step * 5;
      context.beginPath();
      for (const x of tickValues({ step: major, min: minX, max: maxX }, 800)) {
        const px = Math.round(transform.toX(x)) + 0.5;
        context.moveTo(px, 0);
        context.lineTo(px, this.height);
      }
      for (const y of tickValues({ step: major, min: minY, max: maxY }, 800)) {
        const py = Math.round(transform.toY(y)) + 0.5;
        context.moveTo(0, py);
        context.lineTo(this.width, py);
      }
      context.setLineDash([]);
      context.strokeStyle = palette.gridStrong;
      context.stroke();
    }

    context.restore();
  }

  private drawAxes(input: RenderInput, transform: Transform): void {
    const { settings, palette } = input;
    if (!settings.showAxes) return;

    const bounds = transform.bounds();
    const context = this.context;
    context.save();

    if (bounds.minY <= 0 && bounds.maxY >= 0) {
      const py = Math.round(transform.toY(0)) + 0.5;
      context.beginPath();
      context.moveTo(0, py);
      context.lineTo(this.width, py);
      context.strokeStyle = palette.axis;
      context.lineWidth = 1.25;
      context.stroke();
    }

    if (bounds.minX <= 0 && bounds.maxX >= 0) {
      const px = Math.round(transform.toX(0)) + 0.5;
      context.beginPath();
      context.moveTo(px, 0);
      context.lineTo(px, this.height);
      context.stroke();
    }

    if (settings.showOrigin) {
      const px = transform.toX(0);
      const py = transform.toY(0);
      if (px > -8 && px < this.width + 8 && py > -8 && py < this.height + 8) {
        context.beginPath();
        context.arc(px, py, settings.showNumbers ? 3 : 2.5, 0, Math.PI * 2);
        context.fillStyle = palette.axis;
        context.fill();
      }
    }

    if (settings.showNumbers) this.drawAxisNumbers(input, transform);

    context.restore();
  }

  private drawAxisNumbers(input: RenderInput, transform: Transform): void {
    const { palette, viewport } = input;
    const context = this.context;
    const step = niceStep((viewport.scale * this.width) / 13 || 1);
    const fontSize = 11;

    context.save();
    context.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    // Numbers sit on top of whatever is plotted, so give them a halo in the
    // background colour to keep them legible over a curve.
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = palette.background;
    context.fillStyle = palette.label;

    const bounds = transform.bounds();
    // Both axes share one step so the numbers agree with each other and with
    // the grid behind them.
    const span = { step, min: bounds.minX, max: bounds.maxX };
    const spanY = { step, min: bounds.minY, max: bounds.maxY };
    const minSeparation = 44;
    const wantedX = tickValues(span, 400).filter((x) => Math.abs(x) > step / 1000);

    let lastPx = -Infinity;
    for (const x of wantedX) {
      const px = transform.toX(x);
      if (px < 24 || px > this.width - 16) continue;
      const axisY = transform.toY(0);
      const py = axisY > 8 && axisY < this.height - 20 ? axisY + 6 : AXIS_MARGIN;
      if (px - lastPx < minSeparation) continue;
      lastPx = px;
      const text = formatTick(x);
      context.strokeText(text, px, py);
      context.fillText(text, px, py);
    }

    context.textAlign = "right";
    context.textBaseline = "middle";
    const wantedY = tickValues(spanY, 400).filter((y) => Math.abs(y) > step / 1000);

    let lastPy = -Infinity;
    for (const y of wantedY) {
      const py = transform.toY(y);
      if (py < 12 || py > this.height - 12) continue;
      const axisX = transform.toX(0);
      const px = axisX > 30 && axisX < this.width - 20 ? axisX - 8 : AXIS_MARGIN - 8;
      // Screen y decreases as the value grows, so the gap needs an absolute
      // value; a signed comparison would drop every label after the first.
      if (Math.abs(py - lastPy) < minSeparation) continue;
      lastPy = py;
      const text = formatTick(y);
      context.strokeText(text, px, py);
      context.fillText(text, px, py);
    }

    context.restore();
  }

  /* --------------------------------------------------------------- curves */

  private drawCurve(
    drawable: CurveDrawable,
    input: RenderInput,
    transform: Transform,
    labels: LabelBox[],
  ): void {
    const { scope } = input;
    const context = this.context;

    const bounds = transform.bounds();

    // The shaded area goes down first so the curve is drawn over its top edge.
    if (drawable.area) {
      this.fillUnderCurve(drawable, input, transform, drawable.area[0], drawable.area[1]);
    }

    const [domainMin, domainMax] = drawable.domain ?? [bounds.minX, bounds.maxX];
    // One column of slack so a curve leaving the window still gets its final
    // segment drawn and does not visibly stop at the edge.
    const from = Math.max(domainMin, bounds.minX - transform.scale);
    const to = Math.min(domainMax, bounds.maxX + transform.scale);
    if (!(to > from)) return;

    // Two samples per pixel: enough to catch fast curves, cheap enough to stay
    // interactive. Denser sampling only pays off when zoomed right in.
    const samples = Math.min(4096, Math.max(2, Math.ceil((to - from) / (transform.scale * 0.5)) + 1));
    const step = (to - from) / (samples - 1 || 1);

    // A jump many times the visible height means we crossed an asymptote or a
    // discontinuity, so the line must not be drawn across it.
    const jumpLimit = (bounds.maxY - bounds.minY) * 6;

    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);

    let penDown = false;
    // Kept in graph units so it can be compared against the jump limit above.
    let previousY = NaN;
    let labelPlaced = false;

    for (let i = 0; i < samples; i += 1) {
      const x = from + step * i;
      let y: number;
      try {
        y = drawable.fn(x, scope);
      } catch {
        y = NaN;
      }

      if (!Number.isFinite(y)) {
        if (penDown) {
          context.stroke();
          penDown = false;
        }
        previousY = NaN;
        continue;
      }

      const px = transform.toX(x);
      const py = transform.toY(y);

      if (!penDown || Math.abs(y - previousY) > jumpLimit) {
        if (penDown) context.stroke();
        context.beginPath();
        context.moveTo(px, py);
        penDown = true;
      } else {
        context.lineTo(px, py);
      }

      previousY = y;

      if (!labelPlaced && drawable.labelHidden !== true && px > 14 && px < this.width - 14 && py > 18 && py < this.height - 14) {
        labels.push({
          text: drawable.label,
          x: px + 8,
          y: py - 9,
          color: drawable.color,
          dot: true,
          emphasis: input.focusedId === drawable.id,
        });
        labelPlaced = true;
      }
    }

    if (penDown) context.stroke();
    context.restore();

    if (drawable.tangent && input.hoverX !== null) {
      this.drawTangent(drawable, input, transform);
    }
  }

  /**
   * Shade the column between the curve and the x-axis.
   *
   * Working column by column rather than as a polygon keeps a steep section
   * from needing thousands of vertices, and it needs no contour tracer: for a
   * given x the curve is a single y, so the span is known.
   */
  private fillUnderCurve(
    drawable: CurveDrawable,
    input: RenderInput,
    transform: Transform,
    from: number,
    to: number,
  ): void {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return;

    const domain = drawable.domain;
    if (domain && (high < domain[0] || low > domain[1])) return;

    const axisY = transform.toY(0);
    const startColumn = Math.max(0, Math.floor(transform.toX(low)));
    const endColumn = Math.min(this.width, Math.ceil(transform.toX(high)));

    const context = this.context;
    context.save();
    context.beginPath();

    for (let column = startColumn; column < endColumn; column += 1) {
      const x = transform.toGraphX(column + 0.5);
      if (x < low || x > high) continue;
      if (domain && (x < domain[0] || x > domain[1])) continue;

      let y: number;
      try {
        y = drawable.fn(x, input.scope);
      } catch {
        continue;
      }
      if (!Number.isFinite(y)) continue;

      const curveY = transform.toY(y);
      const top = Math.min(axisY, curveY);
      const bottom = Math.max(axisY, curveY);
      if (bottom < 0 || top > this.height) continue;
      context.rect(column, top, 1, bottom - top);
    }

    context.fillStyle = withAlpha(drawable.color, 0.2);
    context.fill();
    context.restore();
  }

  /** A short tangent at the hovered x, long enough to read as a direction. */
  private drawTangent(drawable: CurveDrawable, input: RenderInput, transform: Transform): void {
    const x = input.hoverX!;
    const bounds = transform.bounds();
    if (x < bounds.minX || x > bounds.maxX) return;

    let y: number;
    let m: number | null;
    try {
      y = drawable.fn(x, input.scope);
      m = slope(drawable.fn, input.scope, x, input.viewport.scale);
    } catch {
      return;
    }
    if (!Number.isFinite(y) || m === null || !Number.isFinite(m)) return;

    // Span about a tenth of the window, so the line reaches the edge of the
    // view for a gentle slope and stays a short marker for a steep one.
    const reach = Math.abs(bounds.maxX - bounds.minX) * 0.1;
    const x0 = x - reach;
    const x1 = x + reach;

    const context = this.context;
    context.save();
    context.strokeStyle = drawable.color;
    context.globalAlpha = 0.85;
    context.lineWidth = 1.5;
    context.setLineDash([6, 4]);
    context.beginPath();
    context.moveTo(transform.toX(x0), transform.toY(y + m * (x0 - x)));
    context.lineTo(transform.toX(x1), transform.toY(y + m * (x1 - x)));
    context.stroke();
    context.restore();
  }

  private drawParametric(
    drawable: ParametricDrawable,
    input: RenderInput,
    transform: Transform,
    labels: LabelBox[],
  ): void {
    const { viewport, scope } = input;
    const context = this.context;
    void viewport;
    const [tMin, tMax] = drawable.domain;
    if (!(tMax > tMin)) return;

    const steps = Math.min(6000, Math.max(240, Math.ceil(Math.abs(tMax - tMin) / 0.01)));
    const step = (tMax - tMin) / steps;

    // Grow the window a little past the viewport so curves entering from
    // off-screen still get drawn.
    const marginX = viewport.scale * this.width * 0.5;
    const marginY = viewport.scale * this.height * 0.5;

    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);

    context.beginPath();
    let penDown = false;
    let labelPlaced = false;

    for (let i = 0; i <= steps; i += 1) {
      const t = tMin + step * i;
      let point: [number, number];
      try {
        point = drawable.fn(t, scope);
      } catch {
        point = [NaN, NaN];
      }

      const [x, y] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (penDown) {
          context.stroke();
          context.beginPath();
          penDown = false;
        }
        continue;
      }

      const px = transform.toX(x);
      const py = transform.toY(y);
      const outside =
        px < -marginX || px > this.width + marginX || py < -marginY || py > this.height + marginY;

      if (outside) {
        if (penDown) {
          context.stroke();
          context.beginPath();
          penDown = false;
        }
        continue;
      }

      if (penDown) context.lineTo(px, py);
      else {
        context.moveTo(px, py);
        penDown = true;
      }

      if (!labelPlaced && drawable.labelHidden !== true && px > 12 && px < this.width - 12) {
        labels.push({
          text: drawable.label,
          x: px + 8,
          y: py - 8,
          color: drawable.color,
          dot: true,
          emphasis: input.focusedId === drawable.id,
        });
        labelPlaced = true;
      }
    }

    if (penDown) context.stroke();
    context.restore();
  }

  /* ------------------------------------------------------------- implicit */

  private drawImplicit(drawable: ImplicitDrawable, input: RenderInput): void {
    const { scope } = input;
    const field = (x: number, y: number) => safeField(drawable.field, x, y, scope);
    const cells = this.contourOptions();

    if (drawable.fill !== "none") {
      // `x^2 + y^2 = 16` compiles to `x^2 + y^2 - 16`, which is negative
      // *inside* the circle. Shading the negative side is what puts the colour
      // where a reader expects it, rather than over the whole window.
      this.fillField(field, drawable.color, 0.16, -1);
    }

    const segments = contourSegments(field, cells);
    if (segments.length === 0) return;

    const context = this.context;
    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);

    // Contour segments come back in graph units and have to be projected onto
    // the canvas before they are stroked.
    this.strokeContour(segments);
    context.restore();
  }

  private drawRegion(drawable: RegionDrawable, input: RenderInput): void {
    const { scope } = input;
    const field = (x: number, y: number) => safeField(drawable.field, x, y, scope);
    const cells = this.contourOptions();

    if (drawable.fill !== "none") {
      this.fillField(field, drawable.color, drawable.fill === "solid" ? 0.92 : 0.17, 1);
    }

    const segments = contourSegments(field, cells);
    if (segments.length === 0) return;

    const context = this.context;
    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);
    this.strokeContour(segments);
    context.restore();
  }

  /**
   * Stroke contour segments, which arrive in graph units.
   *
   * They are drawn as one path so the stroke width and dash phase stay steady
   * along the whole curve, and consecutive segments are joined when they meet,
   * which they usually do because the tracer walks the grid in order.
   */
  private strokeContour(segments: ContourSegment[]): void {
    const context = this.context;
    const view = this.transform;
    context.beginPath();

    let previous: ContourSegment | null = null;
    for (const segment of segments) {
      const x0 = view.toX(segment.x0);
      const y0 = view.toY(segment.y0);
      const x1 = view.toX(segment.x1);
      const y1 = view.toY(segment.y1);
      if (previous && Math.abs(previous.x1 - segment.x0) < 1e-9 && Math.abs(previous.y1 - segment.y0) < 1e-9) {
        context.lineTo(x1, y1);
      } else {
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
      }
      previous = segment;
    }

    context.stroke();
  }

  /**
   * Finest cell edge for the contour tracer, in graph units. Two pixels is
   * smooth enough that the eye reads a curve rather than a staircase, and the
   * tracer refines nothing below it.
   */
  private contourOptions(): ContourOptions {
    const bounds = this.transform.bounds();
    const scale = this.transform.scale;
    return {
      ...bounds,
      minCell: scale * CONTOUR_PIXEL_SIZE,
      // Start coarse enough that most of the window is skipped outright.
      baseCells: Math.max(4, Math.min(96, Math.round(Math.min(this.width, this.height) / CONTOUR_BASE_PIXELS))),
    };
  }

  /**
   * Shade the region where a field is positive.
   *
   * The window is first split into blocks and classified with a handful of
   * samples each. Blocks that come out uniformly inside or outside are painted
   * without touching the field again; only blocks straddling the boundary are
   * evaluated per pixel. That keeps the cost tied to the length of the boundary
   * rather than to the area of the window.
   */
  private fillField(
    field: (x: number, y: number) => number,
    color: string,
    alpha: number,
    /** +1 shades where the field is positive, -1 where it is negative. */
    sign: 1 | -1,
  ): void {
    // Shading is cheap to evaluate in the blocks that straddle the boundary and
    // expensive to paint everywhere, so the window is classified at a coarser
    // resolution and scaled back up. The contour that follows is drawn at full
    // resolution, which is what makes the edge read as a curve.
    const width = Math.max(2, Math.ceil(this.width / FILL_SCALE));
    const height = Math.max(2, Math.ceil(this.height / FILL_SCALE));
    const buffer = this.fillBuffer(width, height);
    if (!buffer) return;

    const bounds = this.transform.bounds();
    const rgb = parseColor(color);
    const byteAlpha = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    const pixels = buffer.image.data;

    const partition = partitionField(field, bounds, width, height, FILL_BLOCK);
    const spanX = (bounds.maxX - bounds.minX) / width;
    const spanY = (bounds.maxY - bounds.minY) / height;
    const inside = sign > 0;

    // Block first, pixels second: the per-block decision is taken once instead
    // of on every pixel, and the field is only consulted where the boundary is.
    for (let blockRow = 0; blockRow < partition.rows; blockRow += 1) {
      const top = blockRow * partition.block;
      const bottom = Math.min(height, top + partition.block);

      for (let blockColumn = 0; blockColumn < partition.columns; blockColumn += 1) {
        const verdict = partition.state[blockRow * partition.columns + blockColumn]!;
        const left = blockColumn * partition.block;
        const right = Math.min(width, left + partition.block);

        const uniform = verdict !== MIXED && (verdict === INSIDE) === inside;
        const mixed = verdict === MIXED;

        for (let row = top; row < bottom; row += 1) {
          // Pixel centres, one `spanY` per row down from the top of the window.
          const y = bounds.maxY - (row + 0.5) * spanY;
          let offset = (row * width + left) * 4;

          for (let column = left; column < right; column += 1) {
            let on = uniform;
            if (mixed) {
              const x = bounds.minX + (column + 0.5) * spanX;
              const value = field(x, y);
              on = Number.isFinite(value) && value * sign > 0;
            }

            if (on) {
              pixels[offset] = rgb[0];
              pixels[offset + 1] = rgb[1];
              pixels[offset + 2] = rgb[2];
              pixels[offset + 3] = byteAlpha;
            } else {
              pixels[offset + 3] = 0;
            }
            offset += 4;
          }
        }
      }
    }

    buffer.context.putImageData(buffer.image, 0, 0);

    const context = this.context;
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(buffer.canvas, 0, 0, this.width, this.height);
    context.restore();
  }

  /** Reuse one offscreen canvas so a redraw does not reallocate it. */
  private fillBuffer(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; image: ImageData } | null {
    if (typeof document === "undefined") return null;

    let buffer = this.offscreen;
    if (!buffer) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return null;
      buffer = { canvas, context, image: null };
      this.offscreen = buffer;
    }

    if (buffer.canvas.width !== width || buffer.canvas.height !== height) {
      buffer.canvas.width = width;
      buffer.canvas.height = height;
      buffer.image = null;
    }

    const image = buffer.image ?? buffer.context.createImageData(width, height);
    buffer.image = image;
    return { canvas: buffer.canvas, context: buffer.context, image };
  }

  /* --------------------------------------------------------------- points */

  private drawPoints(input: RenderInput, transform: Transform): void {
    const { points, palette } = input;
    if (points.length === 0) return;
    const context = this.context;

    context.save();
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const px = transform.toX(point.x);
      const py = transform.toY(point.y);
      if (px < -20 || px > this.width + 20 || py < -20 || py > this.height + 20) continue;

      context.beginPath();
      context.arc(px, py, 4.5, 0, Math.PI * 2);
      context.fillStyle = point.color;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = palette.background;
      context.stroke();

      if (point.label && point.label.length > 0) {
        context.font = "12px ui-sans-serif, system-ui, sans-serif";
        context.fillStyle = palette.pointLabel;
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(point.label, px, py - 8);
      }
    }
    context.restore();
  }

  private drawLabels(labels: LabelBox[], input: RenderInput): void {
    if (labels.length === 0) return;
    const { palette } = input;
    const context = this.context;

    context.save();
    context.font = "12px ui-sans-serif, system-ui, sans-serif";
    context.textBaseline = "middle";
    context.textAlign = "left";

    for (const label of labels) {
      const metrics = context.measureText(label.text);
      const paddingX = 5;
      const dotSpace = label.dot ? 12 : 0;
      const boxWidth = metrics.width + paddingX * 2 + dotSpace;
      const boxHeight = 18;

      const x = Math.min(Math.max(2, label.x), this.width - boxWidth - 2);
      const y = Math.min(Math.max(2, label.y), this.height - boxHeight - 2);

      context.fillStyle = palette.sliderHandle;
      roundRect(context, x, y, boxWidth, boxHeight, 4);
      context.fill();

      if (label.emphasis) {
        context.strokeStyle = label.color;
        context.lineWidth = 1.5;
        context.stroke();
      }

      if (label.dot) {
        context.beginPath();
        context.arc(x + paddingX + 3.5, y + boxHeight / 2, 3.5, 0, Math.PI * 2);
        context.fillStyle = label.color;
        context.fill();
      }

      context.fillStyle = palette.label;
      context.fillText(label.text, x + paddingX + dotSpace, y + boxHeight / 2 + 0.5);
    }

    context.restore();
  }
}

/* --------------------------------------------------------------- helpers */

export class Transform {
  readonly scale: number;

  constructor(
    readonly viewport: Viewport,
    readonly width: number,
    readonly height: number,
  ) {
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale));
  }

  toX(x: number): number {
    return (x - this.viewport.x) / this.scale + this.width / 2;
  }

  toY(y: number): number {
    return this.height / 2 - (y - this.viewport.y) / this.scale;
  }

  toGraphX(px: number): number {
    return this.viewport.x + (px - this.width / 2) * this.scale;
  }

  toGraphY(py: number): number {
    return this.viewport.y - (py - this.height / 2) * this.scale;
  }

  bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return {
      minX: this.toGraphX(0),
      maxX: this.toGraphX(this.width),
      minY: this.toGraphY(this.height),
      maxY: this.toGraphY(0),
    };
  }
}

function applyLineStyle(context: CanvasRenderingContext2D, style: string): void {
  if (style === "dashed") context.setLineDash([7, 5]);
  else if (style === "dotted") context.setLineDash([2, 4]);
  else context.setLineDash([]);
}

/** Shading is drawn at this fraction of the canvas resolution, then scaled up. */
const FILL_SCALE = 3;
/** Side of the blocks the fill is classified in, in buffer pixels. */
const FILL_BLOCK = 8;
/** Finest cell edge for contours, in CSS pixels. */
const CONTOUR_PIXEL_SIZE = 2.5;

/** `rgba()` for a hex colour, which is what a canvas fill needs for translucency. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

function parseColor(color: string): [number, number, number] {
  const hex = color.trim().replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(value)) return [47, 111, 235];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Cells across and down for contour work. Four cells per pixel is smooth
 * enough that the eye reads a curve rather than a staircase, and it stays
 * inside the frame budget when several expressions are on screen at once.
 */


function safeField(
  field: (x: number, y: number, scope: Record<string, number>) => number,
  x: number,
  y: number,
  scope: Record<string, number>,
): number {
  try {
    return field(x, y, scope);
  } catch {
    return NaN;
  }
}

export function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}