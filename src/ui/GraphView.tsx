import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BuildResult } from "../document/build";
import type { PointItem, Settings, Viewport } from "../document/types";
import {
  DARK_PALETTE,
  GraphRenderer,
  LIGHT_PALETTE,
  Transform,
  type Palette,
  type RenderInput,
} from "../graph/renderer";
import { decimalsForScale, formatNumber } from "../math/format";
import { useDispatch } from "../state/useStore";
import { IconMinus, IconPlus, IconReset } from "./Icon";

const MIN_SCALE = 1e-9;
const MAX_SCALE = 1e8;
const HIT_RADIUS = 11;
const KEYBOARD_NUDGE = 40;

/** Zoom multiplier per pixel of wheel travel. A notch of 100px is about 1.28x. */
const ZOOM_PER_PIXEL = 0.0025;
/** Cap on a single wheel event, so a trackpad flick cannot jump the view. */
const MAX_WHEEL_PIXELS = 140;
/** How long the viewport waits before being written to the store. */
const COMMIT_DELAY_MS = 180;

interface GraphViewProps {
  build: BuildResult;
  viewport: Viewport;
  settings: Settings;
  focusedId: string | null;
  dark: boolean;
}

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "point"; id: string; offsetX: number; offsetY: number };

interface Pointer {
  x: number;
  y: number;
}

/** Two-finger state: only the change since the previous move is applied. */
interface PinchState {
  lastDistance: number;
  lastMidX: number;
  lastMidY: number;
}

export function GraphView({ build, viewport, settings, focusedId, dark }: GraphViewProps) {
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const gestureRef = useRef<Gesture>({ kind: "none" });
  const pointersRef = useRef(new Map<number, Pointer>());
  const pinchRef = useRef<PinchState | null>(null);
  const frameRef = useRef(0);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverPoint, setHoverPoint] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // The readout follows the pointer during a drag, which would otherwise mean a
  // React render for every pointer event. Updates are collapsed into a frame.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const cursorFrameRef = useRef(0);
  const showCursor = useCallback((value: { x: number; y: number } | null) => {
    cursorRef.current = value;
    if (cursorFrameRef.current !== 0) return;
    cursorFrameRef.current = requestAnimationFrame(() => {
      cursorFrameRef.current = 0;
      setCursor(cursorRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (cursorFrameRef.current !== 0) cancelAnimationFrame(cursorFrameRef.current);
    },
    [],
  );

  const palette: Palette = dark ? DARK_PALETTE : LIGHT_PALETTE;

  /* ----------------------------------------------------------------- sizing */

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(element);

    const rect = element.getBoundingClientRect();
    setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    return () => observer.disconnect();
  }, []);

  /* --------------------------------------------------------------- drawing */

  const points = useMemo(() => build.points.filter((point) => point.hidden !== true), [build.points]);

  // The viewport lives here rather than in the store while a gesture is in
  // flight. Pan and zoom then cost one canvas redraw and nothing else: no store
  // update, no document rebuild, no React render. The value is committed once
  // the gesture settles.
  //
  // It must only be re-synced when the store's viewport genuinely changes — for
  // instance on reset or on undo. Assigning the prop on every render would
  // undo the pan the moment a gesture triggered a re-render.
  const liveViewport = useRef<Viewport>(viewport);
  const syncedViewport = useRef<Viewport>(viewport);
  if (syncedViewport.current !== viewport) {
    syncedViewport.current = viewport;
    liveViewport.current = viewport;
  }

  const pendingRef = useRef<RenderInput | null>(null);
  pendingRef.current = {
    viewport: liveViewport.current,
    width: size.width,
    height: size.height,
    drawables: build.drawables,
    points,
    scope: build.scope,
    settings,
    palette,
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    focusedId,
  };

  const requestDraw = useCallback(() => {
    if (frameRef.current !== 0) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const renderer = rendererRef.current;
      const input = pendingRef.current;
      if (!renderer || !input || input.width === 0 || input.height === 0) return;
      // A pending frame always paints the newest input rather than whatever
      // the callback happened to close over.
      input.viewport = liveViewport.current;
      renderer.draw(input);
    });
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!rendererRef.current) rendererRef.current = new GraphRenderer(canvas);
    // Resizing the backing store clears it, so this has to happen before the
    // frame that paints.
    rendererRef.current.resize(size.width, size.height, window.devicePixelRatio || 1);
    requestDraw();
  }, [requestDraw, size.height, size.width]);

  useEffect(() => {
    requestDraw();
  }, [requestDraw, build.drawables, points, build.scope, settings, palette, focusedId, viewport]);

  useEffect(
    () => () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
      if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------ coordinates */

  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const current = new Transform(liveViewport.current, size.width || 1, size.height || 1);
      return {
        x: current.toGraphX(clientX - rect.left),
        y: current.toGraphY(clientY - rect.top),
      };
    },
    [size.height, size.width],
  );

  const pointUnder = useCallback(
    (clientX: number, clientY: number): string | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const current = new Transform(liveViewport.current, size.width || 1, size.height || 1);
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const threshold = HIT_RADIUS * current.scale;

      let best: { id: string; distance: number } | null = null;
      for (const point of points) {
        const dx = point.x - current.toGraphX(px);
        const dy = point.y - current.toGraphY(py);
        const distance = Math.hypot(dx, dy);
        if (distance <= threshold && (best === null || distance < best.distance)) {
          best = { id: point.id, distance };
        }
      }
      return best?.id ?? null;
    },
    [points, size.height, size.width],
  );

  /* --------------------------------------------------------------- viewport */

  /** Apply a viewport immediately, then write it to the store once things stop. */
  const moveTo = useCallback(
    (next: Viewport) => {
      liveViewport.current = next;
      requestDraw();

      if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = null;
        const settled = liveViewport.current;
        if (settled.x === viewport.x && settled.y === viewport.y && settled.scale === viewport.scale) return;
        dispatch({ type: "setViewport", viewport: settled });
      }, COMMIT_DELAY_MS);
    },
    [dispatch, requestDraw, viewport],
  );

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || size.width === 0 || size.height === 0) return;

      const current = liveViewport.current;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const view = new Transform(current, size.width, size.height);
      const anchorX = view.toGraphX(px);
      const anchorY = view.toGraphY(py);

      const scale = clampScale(current.scale * factor);
      if (scale === current.scale) return;

      // A screen pixel sits at (graph - centre) / scale + centre, so keeping it
      // fixed means solving for the new centre with the *new* scale, not with
      // the ratio between the old and new.
      moveTo({
        scale,
        x: anchorX - (px - size.width / 2) * scale,
        y: anchorY + (py - size.height / 2) * scale,
      });
    },
    [moveTo, size.height, size.width],
  );

  /** Slides the view centre by a screen distance: right and down are positive. */
  const shiftView = useCallback(
    (dxPixels: number, dyPixels: number) => {
      const current = liveViewport.current;
      if (dxPixels === 0 && dyPixels === 0) return;
      moveTo({
        scale: current.scale,
        x: current.x + dxPixels * current.scale,
        y: current.y - dyPixels * current.scale,
      });
    },
    [moveTo],
  );

  /**
   * Carries the picture along with a pointer that moved this far.
   *
   * Dragging right takes the graph left with it, so the view slides the other
   * way. Two fingers moving apart still zoom in and together still zoom out;
   * only the panning half of the gesture is reversed.
   */
  const dragBy = useCallback(
    (dxPixels: number, dyPixels: number) => shiftView(-dxPixels, -dyPixels),
    [shiftView],
  );

  const zoomFromCentre = useCallback(
    (factor: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      zoomAt(factor, (rect?.left ?? 0) + (rect?.width ?? 0) / 2, (rect?.top ?? 0) + (rect?.height ?? 0) / 2);
    },
    [zoomAt],
  );

  /* ---------------------------------------------------------------- pointer */

  const pinchOf = useCallback((): PinchState | null => {
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b) return null;
    return {
      lastDistance: Math.max(1e-6, Math.hypot(a.x - b.x, a.y - b.y)),
      lastMidX: (a.x + b.x) / 2,
      lastMidY: (a.y + b.y) / 2,
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      capturePointer(event.pointerId, true);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // A second finger means a pinch. Both fingers stay tracked so lifting one
      // hands over to a pan instead of jumping.
      if (pointersRef.current.size === 2) {
        pinchRef.current = pinchOf();
        gestureRef.current = { kind: "none" };
        setPanning(false);
        return;
      }

      const grabbed = pointUnder(event.clientX, event.clientY);
      if (grabbed) {
        const point = build.points.find((entry) => entry.id === grabbed);
        const where = toGraph(event.clientX, event.clientY);
        gestureRef.current = point
          ? { kind: "point", id: point.id, offsetX: point.x - where.x, offsetY: point.y - where.y }
          : { kind: "none" };
        dispatch({ type: "select", ids: [grabbed], focus: grabbed });
        return;
      }

      gestureRef.current = { kind: "pan", lastX: event.clientX, lastY: event.clientY };
      setPanning(true);
      showCursor(toGraph(event.clientX, event.clientY));
    },
    [build.points, dispatch, pinchOf, pointUnder, showCursor, toGraph],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // Pinch: apply only the change since the previous move. Re-applying the
      // whole distance from where the fingers started compounds on every event
      // and runs away.
      if (pinchRef.current && pointersRef.current.size >= 2) {
        const next = pinchOf();
        if (!next) return;
        const previous = pinchRef.current;
        pinchRef.current = next;

        const ratio = next.lastDistance / previous.lastDistance;
        if (Math.abs(ratio - 1) > 1e-4) {
          zoomAt(ratio, next.lastMidX, next.lastMidY);
        }
        dragBy(next.lastMidX - previous.lastMidX, next.lastMidY - previous.lastMidY);
        showCursor(toGraph(event.clientX, event.clientY));
        return;
      }

      showCursor(toGraph(event.clientX, event.clientY));

      const gesture = gestureRef.current;
      if (gesture.kind === "pan") {
        const dx = event.clientX - gesture.lastX;
        const dy = event.clientY - gesture.lastY;
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        dragBy(dx, dy);
        return;
      }

      if (gesture.kind === "point") {
        const where = toGraph(event.clientX, event.clientY);
        dispatch({
          type: "setPoint",
          id: gesture.id,
          x: where.x + gesture.offsetX,
          y: where.y + gesture.offsetY,
        });
        return;
      }

      setHoverPoint(pointUnder(event.clientX, event.clientY));
    },
    [dispatch, dragBy, pinchOf, pointUnder, showCursor, toGraph, zoomAt],
  );

  const endPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    capturePointer(event.pointerId, false);

    if (pointersRef.current.size < 2) pinchRef.current = null;

    // One finger left after a pinch: keep dragging as a pan from wherever it is
    // now, so the view does not jump when the second finger lifts.
    if (pointersRef.current.size === 1 && gestureRef.current.kind === "none") {
      const [remaining] = [...pointersRef.current.values()];
      if (remaining) {
        gestureRef.current = { kind: "pan", lastX: remaining.x, lastY: remaining.y };
        setPanning(true);
      }
      return;
    }

    if (pointersRef.current.size === 0) {
      gestureRef.current = { kind: "none" };
      setPanning(false);
      showCursor(null);
    }
  }, [showCursor]);

  /* ------------------------------------------------------------------ wheel */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      // Trackpads report pixels, mice report lines or pages. Normalising to
      // pixels keeps the feel the same on both.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;

      // Shift scrolls sideways, and a scroll carries the picture with it, the
      // same way a drag does.
      if (event.shiftKey && Math.abs(event.deltaX) > 0) {
        dragBy(clampPixels(event.deltaX * unit), 0);
        return;
      }
      if (event.shiftKey) {
        dragBy(clampPixels(event.deltaY * unit), 0);
        return;
      }

      zoomAt(Math.exp(-clampPixels(event.deltaY * unit) * ZOOM_PER_PIXEL), event.clientX, event.clientY);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [dragBy, zoomAt]);

  /* --------------------------------------------------------------- keyboard */

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // An arrow key names a direction for the view, so it is not reversed the
      // way a drag is.
      switch (event.key) {
        case "ArrowLeft":
          shiftView(-KEYBOARD_NUDGE, 0);
          break;
        case "ArrowRight":
          shiftView(KEYBOARD_NUDGE, 0);
          break;
        case "ArrowUp":
          shiftView(0, -KEYBOARD_NUDGE);
          break;
        case "ArrowDown":
          shiftView(0, KEYBOARD_NUDGE);
          break;
        case "+":
        case "=":
          zoomFromCentre(1.25);
          break;
        case "-":
        case "_":
          zoomFromCentre(0.8);
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [shiftView, zoomFromCentre],
  );

  /* ---------------------------------------------------------------- readout */

  const decimals = decimalsForScale(liveViewport.current.scale);
  const focusedValue = useMemo(() => {
    if (!focusedId) return null;
    const drawable = build.drawables.find((entry) => entry.id === focusedId);
    if (!drawable || drawable.kind !== "curve") return null;
    const value = evaluate(drawable.fn, liveViewport.current.x, build.scope);
    return Number.isFinite(value) ? value : null;
  }, [build.drawables, build.scope, focusedId, viewport.x]);

  const readout = cursor && (settings.showDragHint || panning || focusedValue !== null) ? (
    <div className="readout">
      <span>
        x <b>{formatNumber(cursor.x, decimals)}</b>
      </span>
      {focusedValue !== null ? (
        <span>
          y <b>{formatNumber(focusedValue, decimals)}</b>
        </span>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className={`graph${panning ? " is-panning" : ""}${hoverPoint ? " is-over-point" : ""}`}
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Graph"
    >
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={(event) => {
          endPointer(event);
          setHoverPoint(null);
        }}
      />

      <div className="graph-overlay">
        {readout}

        <div className="graph-tools">
          <button
            type="button"
            className="icon-button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomFromCentre(1.4)}
          >
            <IconPlus size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomFromCentre(1 / 1.4)}
          >
            <IconMinus size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Reset view"
            aria-label="Reset view"
            onClick={() => {
              liveViewport.current = { ...viewport, x: 0, y: 0, scale: 1 / 48 };
              dispatch({ type: "resetViewport" });
            }}
          >
            <IconReset size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

/**
 * Pointer capture is best-effort: it throws for pointer ids the browser does
 * not know about, and losing it only means a gesture ends early.
 */
function capturePointer(pointerId: number, want: boolean): void {
  const canvas = document.querySelector<HTMLCanvasElement>("canvas");
  if (!canvas) return;
  try {
    if (want) canvas.setPointerCapture(pointerId);
    else if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampPixels(pixels: number): number {
  return Math.max(-MAX_WHEEL_PIXELS, Math.min(MAX_WHEEL_PIXELS, pixels));
}

function evaluate(
  fn: (x: number, scope: Record<string, number>) => number,
  x: number,
  scope: Record<string, number>,
): number {
  try {
    return fn(x, scope);
  } catch {
    return NaN;
  }
}

export type { PointItem };