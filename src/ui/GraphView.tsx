import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BuildResult } from "../document/build";
import type { PointItem, Settings, Viewport } from "../document/types";
import { DARK_PALETTE, GraphRenderer, LIGHT_PALETTE, Transform, type Palette, type RenderInput } from "../graph/renderer";
import { decimalsForScale, formatNumber } from "../math/format";
import { useDispatch } from "../state/useStore";
import { IconMinus, IconPlus, IconReset } from "./Icon";

const MIN_SCALE = 1e-9;
const MAX_SCALE = 1e8;
const HIT_RADIUS = 11;
const KEYBOARD_NUDGE = 40;

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

interface PinchState {
  distance: number;
  scale: number;
  centerX: number;
  centerY: number;
}

export function GraphView({ build, viewport, settings, focusedId, dark }: GraphViewProps) {
  const dispatch = useDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const gestureRef = useRef<Gesture>({ kind: "none" });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<PinchState | null>(null);
  const frameRef = useRef(0);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverPoint, setHoverPoint] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

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

  // The pending frame always draws the newest input rather than whatever the
  // callback happened to close over. Without this a frame scheduled before the
  // element was measured would bail out, and the `frameRef` guard would then
  // block every later attempt.
  const pendingRef = useRef<RenderInput | null>(null);
  pendingRef.current = {
    viewport,
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
  }, [
    requestDraw,
    build.drawables,
    points,
    build.scope,
    settings,
    palette,
    focusedId,
    viewport.x,
    viewport.y,
    viewport.scale,
  ]);

  useEffect(
    () => () => {
      if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------ coordinates */

  const transform = useMemo(
    () => new Transform(viewport, size.width || 1, size.height || 1),
    [size.height, size.width, viewport],
  );

  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: transform.toGraphX(clientX - rect.left),
        y: transform.toGraphY(clientY - rect.top),
      };
    },
    [transform],
  );

  const pointUnder = useCallback(
    (clientX: number, clientY: number): string | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const threshold = HIT_RADIUS * viewport.scale;

      let best: { id: string; distance: number } | null = null;
      for (const point of points) {
        const dx = point.x - transform.toGraphX(px);
        const dy = point.y - transform.toGraphY(py);
        const distance = Math.hypot(dx, dy);
        if (distance <= threshold && (best === null || distance < best.distance)) {
          best = { id: point.id, distance };
        }
      }
      return best?.id ?? null;
    },
    [points, transform, viewport.scale],
  );

  /* --------------------------------------------------------------- viewport */

  const setViewport = useCallback(
    (next: Viewport) => dispatch({ type: "setViewport", viewport: next }),
    [dispatch],
  );

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || size.width === 0) return;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const anchor = transform.toGraphX(px);
      const anchorY = transform.toGraphY(py);
      const scale = clampScale(viewport.scale * factor);
      const ratio = scale / viewport.scale;
      setViewport({
        scale,
        x: anchor - (px - size.width / 2) * ratio,
        y: anchorY + (py - size.height / 2) * ratio,
      });
    },
    [setViewport, size.height, size.width, transform, viewport.scale],
  );

  const zoomFromCentre = useCallback(
    (factor: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      zoomAt(factor, (rect?.left ?? 0) + (rect?.width ?? 0) / 2, (rect?.top ?? 0) + (rect?.height ?? 0) / 2);
    },
    [zoomAt],
  );

  const panBy = useCallback(
    (dxPixels: number, dyPixels: number) => {
      setViewport({
        ...viewport,
        x: viewport.x + dxPixels * viewport.scale,
        y: viewport.y - dyPixels * viewport.scale,
      });
    },
    [setViewport, viewport],
  );

  /* ---------------------------------------------------------------- pointer */

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      canvasRef.current?.setPointerCapture(event.pointerId);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // Two fingers means a pinch; keep the previous gesture so lifting one
      // finger does not jump the view.
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        if (a && b) {
          pinchRef.current = {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            scale: viewport.scale,
            centerX: (a.x + b.x) / 2,
            centerY: (a.y + b.y) / 2,
          };
        }
        gestureRef.current = { kind: "none" };
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
      setCursor(toGraph(event.clientX, event.clientY));
    },
    [build.points, dispatch, pointUnder, toGraph, viewport.scale],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      setCursor(toGraph(event.clientX, event.clientY));

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()];
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 0) {
          zoomAt(distance / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        pinch.centerX = (a.x + b.x) / 2;
        pinch.centerY = (a.y + b.y) / 2;
        return;
      }

      const gesture = gestureRef.current;
      if (gesture.kind === "pan") {
        const dx = event.clientX - gesture.lastX;
        const dy = event.clientY - gesture.lastY;
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        if (dx !== 0 || dy !== 0) panBy(dx, dy);
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
    [dispatch, panBy, pointUnder, toGraph, zoomAt],
  );

  const endPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    if (pointersRef.current.size === 0) {
      gestureRef.current = { kind: "none" };
      setPanning(false);
      setCursor(null);
    }
  }, []);

  /* ------------------------------------------------------------------ wheel */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.shiftKey) {
        panBy(event.deltaY + event.deltaX, 0);
        return;
      }
      // Trackpads report pixels, mice report lines or pages.
      const intensity = event.deltaMode === 1 ? 0.02 : event.deltaMode === 2 ? 0.3 : 0.0016;
      zoomAt(Math.exp(event.deltaY * intensity), event.clientX, event.clientY);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [panBy, zoomAt]);

  /* --------------------------------------------------------------- keyboard */

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowLeft":
          panBy(KEYBOARD_NUDGE, 0);
          break;
        case "ArrowRight":
          panBy(-KEYBOARD_NUDGE, 0);
          break;
        case "ArrowUp":
          panBy(0, -KEYBOARD_NUDGE);
          break;
        case "ArrowDown":
          panBy(0, KEYBOARD_NUDGE);
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
    [panBy, zoomFromCentre],
  );

  /* ---------------------------------------------------------------- readout */

  const decimals = decimalsForScale(viewport.scale);
  const focusedValue = useMemo(() => {
    if (!focusedId) return null;
    const drawable = build.drawables.find((entry) => entry.id === focusedId);
    if (!drawable || drawable.kind !== "curve") return null;
    const value = evaluate(drawable.fn, viewport.x, build.scope);
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
          <button type="button" className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomFromCentre(1.4)}>
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
            onClick={() => dispatch({ type: "resetViewport" })}
          >
            <IconReset size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
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