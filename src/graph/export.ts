import type { BuildResult } from "../document/build";
import type { PointItem, Settings, Viewport } from "../document/types";
import { DARK_PALETTE, GraphRenderer, LIGHT_PALETTE, type Palette } from "./renderer";

/**
 * Draw the current frame onto a detached canvas at a chosen size.
 *
 * A new renderer is used rather than the one on screen, so the export can be
 * larger than the window and is built from the document rather than from
 * whatever happened to be painted last.
 */
export function renderToCanvas(
  build: BuildResult,
  viewport: Viewport,
  settings: Settings,
  focusedId: string | null,
  dark: boolean,
  size: { width: number; height: number },
  scale = 1,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const renderer = new GraphRenderer(canvas);
  const dpr = Math.max(1, Math.min(scale, 4));

  renderer.resize(size.width, size.height, dpr);
  renderer.draw({
    viewport,
    width: size.width,
    height: size.height,
    drawables: build.drawables,
    points: build.points.filter((point) => point.hidden !== true) as PointItem[],
    scope: build.scope,
    settings,
    palette: (dark ? DARK_PALETTE : LIGHT_PALETTE) as Palette,
    devicePixelRatio: dpr,
    focusedId,
    hoverX: null,
  });

  return canvas;
}

/** The same frame as a PNG blob, or `null` if the canvas cannot produce one. */
export async function renderToBlob(
  build: BuildResult,
  viewport: Viewport,
  settings: Settings,
  focusedId: string | null,
  dark: boolean,
  size: { width: number; height: number },
  scale = 1,
): Promise<Blob | null> {
  const canvas = renderToCanvas(build, viewport, settings, focusedId, dark, size, scale);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked once the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
