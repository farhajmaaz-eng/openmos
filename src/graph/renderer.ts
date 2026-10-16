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
import { contourSegments, type ContourSegment } from "./contour";
import { gridStep, layoutTicks, niceStep, tickValues } from "./ticks";

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
          this.drawImplicit(drawable, input, transform);
          break;
        case "region":
          this.drawRegion(drawable, input, transform);
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
    const xs = tickValues({ step, labelStep: step, min: minX, max: maxX }, 2000);
    const ys = tickValues({ step, labelStep: step, min: minY, max: maxY }, 2000);
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
      for (const x of tickValues({ step: major, labelStep: major, min: minX, max: maxX }, 800)) {
        const px = Math.round(transform.toX(x)) + 0.5;
        context.moveTo(px, 0);
        context.lineTo(px, this.height);
      }
      for (const y of tickValues({ step: major, labelStep: major, min: minY, max: maxY }, 800)) {
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

    if (settings.showXAxis && bounds.minY <= 0 && bounds.maxY >= 0) {
      const py = Math.round(transform.toY(0)) + 0.5;
      context.beginPath();
      context.moveTo(0, py);
      context.lineTo(this.width, py);
      context.strokeStyle = palette.axis;
      context.lineWidth = 1.25;
      context.stroke();
    }

    if (settings.showYAxis && bounds.minX <= 0 && bounds.maxX >= 0) {
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

    const { minX, maxX, minY, maxY } = transform.bounds();
    const xs = tickValues(layoutTicks(minX, maxX, 10), 400);
    const minSeparation = 44;
    const wantedX = xs.filter((x) => Math.abs(x) > step / 1000);

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
    const ys = tickValues(layoutTicks(minY, maxY, 8), 400);
    const wantedY = ys.filter((y) => Math.abs(y) > step / 1000);

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

  private drawImplicit(drawable: ImplicitDrawable, input: RenderInput, transform: Transform): void {
    const { scope } = input;
    const bounds = transform.bounds();
    const grid = gridFor(this.width, this.height);
    const field = (x: number, y: number) => safeField(drawable.field, x, y, scope);

    if (drawable.fill !== "none") {
      // `x^2 + y^2 = 16` compiles to `x^2 + y^2 - 16`, which is negative
      // *inside* the circle. Shading the negative side is what puts the colour
      // where a reader expects it, rather than over the whole window.
      this.fillField(field, drawable.color, 0.16, -1);
    }

    const segments = contourSegments(field, { ...bounds, ...grid });
    if (segments.length === 0) return;

    const context = this.context;
    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);

    // Segments arrive in raster order, so consecutive ones usually join up.
    // Drawing them as one path keeps the stroke width and dash phase steady.
    context.beginPath();
    let previous: ContourSegment | null = null;
    for (const segment of segments) {
      if (previous && Math.abs(previous.x1 - segment.x0) < 1e-9 && Math.abs(previous.y1 - segment.y0) < 1e-9) {
        context.lineTo(segment.x1, segment.y1);
      } else {
        context.moveTo(segment.x0, segment.y0);
        context.lineTo(segment.x1, segment.y1);
      }
      previous = segment;
    }
    context.stroke();
    context.restore();
  }

  private drawRegion(drawable: RegionDrawable, input: RenderInput, transform: Transform): void {
    const { scope } = input;
    const bounds = transform.bounds();
    const grid = gridFor(this.width, this.height);
    const field = (x: number, y: number) => safeField(drawable.field, x, y, scope);

    if (drawable.fill !== "none") {
      this.fillField(field, drawable.color, drawable.fill === "solid" ? 0.92 : 0.17, 1);
    }

    const segments = contourSegments(field, { ...bounds, ...grid });
    if (segments.length === 0) return;

    const context = this.context;
    context.save();
    context.strokeStyle = drawable.color;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    applyLineStyle(context, drawable.lineStyle);
    context.beginPath();
    for (const segment of segments) {
      context.moveTo(segment.x0, segment.y0);
      context.lineTo(segment.x1, segment.y1);
    }
    context.stroke();
    context.restore();
  }

  /**
   * Shade the region where a field is positive.
   *
   * This is done per pixel into a half-resolution buffer rather than with
   * marching-squares polygons: thousands of overlapping sub-paths are
   * quadratic for the rasteriser, while a pixel loop is linear, and the
   * upscaled buffer gives a smoother edge than the polygons did.
   */
  private fillField(
    field: (x: number, y: number) => number,
    color: string,
    alpha: number,
    /** +1 shades where the field is positive, -1 where it is negative. */
    sign: 1 | -1,
  ): void {
    const width = Math.max(2, Math.ceil(this.width / FILL_DOWNSAMPLE));
    const height = Math.max(2, Math.ceil(this.height / FILL_DOWNSAMPLE));
    const buffer = this.fillBuffer(width, height);
    if (!buffer) return;

    const bounds = this.transform.bounds();
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const rgb = parseColor(color);
    const byteAlpha = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    const pixels = buffer.image.data;

    for (let row = 0; row < height; row += 1) {
      // Image rows run top to bottom, graph y runs the other way.
      const y = bounds.maxY - ((row + 0.5) / height) * spanY;
      let offset = row * width * 4;
      for (let column = 0; column < width; column += 1) {
        const x = bounds.minX + ((column + 0.5) / width) * spanX;
        const value = field(x, y);
        if (Number.isFinite(value) && value * sign > 0) {
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

    buffer.context.putImageData(buffer.image, 0, 0);

    const context = this.context;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
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

/** Fill regions are drawn at half resolution and scaled up. */
const FILL_DOWNSAMPLE = 2;

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
function gridFor(width: number, height: number): { columns: number; rows: number } {
  // Two cells per pixel is smooth enough that the eye reads a curve rather
  // than a staircase, and the cell loop stays cheap.
  return {
    columns: Math.max(48, Math.min(400, Math.round(width / 2))),
    rows: Math.max(48, Math.min(400, Math.round(height / 2))),
  };
}

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

export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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