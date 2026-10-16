import { memo, useMemo, useState } from "react";
import type { BuildResult, CurveDrawable, Drawable } from "../document/build";
import { findIntersections, type Box, type Crossing } from "../document/analysis";
import type { Viewport } from "../document/types";
import { formatNumber } from "../math/format";
import { Dialog } from "./Panels";

/** Two curves and the points where they meet. */
export interface Pair {
  a: CurveDrawable;
  b: CurveDrawable;
  crossings: Crossing[];
}

/**
 * Every pair of curves on the board, and where each pair crosses.
 *
 * Only `y = f(x)` curves can be intersected this way; a parametric or implicit
 * curve has no single-valued x to search along, so those are left out rather
 * than reported as having no crossings.
 */
export function findAllIntersections(build: BuildResult, window: Box): Pair[] {
  const curves = build.drawables.filter(
    (entry): entry is CurveDrawable => entry.kind === "curve",
  );

  const pairs: Pair[] = [];
  for (let i = 0; i < curves.length; i += 1) {
    for (let j = i + 1; j < curves.length; j += 1) {
      const a = curves[i]!;
      const b = curves[j]!;
      pairs.push({ a, b, crossings: findIntersections(a, b, build.scope, window) });
    }
  }
  return pairs;
}

export interface IntersectionsPanelProps {
  build: BuildResult;
  viewport: Viewport;
  size: { width: number; height: number };
  onClose: () => void;
  onGoTo: (crossing: Crossing) => void;
}

export function IntersectionsPanel({
  build,
  viewport,
  size,
  onClose,
  onGoTo,
}: IntersectionsPanelProps) {
  const [showEmpty, setShowEmpty] = useState(true);

  // Search a generous band around the window: crossings just off screen are
  // usually the ones the user wants.
  const window = useMemo<Box>(() => {
    const padX = Math.abs(viewport.scale * size.width) * 0.5;
    const padY = Math.abs(viewport.scale * size.height) * 0.5;
    return {
      minX: viewport.x - padX,
      maxX: viewport.x + padX,
      minY: viewport.y - padY,
      maxY: viewport.y + padY,
    };
  }, [size, viewport]);

  const pairs = useMemo(() => findAllIntersections(build, window), [build, window]);
  const withCrossings = pairs.filter((pair) => pair.crossings.length > 0);
  const total = withCrossings.reduce((sum, pair) => sum + pair.crossings.length, 0);

  return (
    <Dialog
      title="Intersections"
      onClose={onClose}
      width={520}
      footer={
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(event) => setShowEmpty(event.target.checked)}
            />
            Show pairs with no crossings
          </label>
          <button type="button" className="text-button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {pairs.length === 0 ? (
        <p className="panel-note">
          Add two curves of the form <code>y = f(x)</code> and open this panel again.
        </p>
      ) : total === 0 && !showEmpty ? (
        <p className="panel-note">
          None of the {pairs.length} pairs cross inside the current view. Zoom out, or switch on the pairs
          with no crossings to see what was checked.
        </p>
      ) : (
        <div className="intersection-list">
          {pairs
            .filter((pair) => showEmpty || pair.crossings.length > 0)
            .map((pair) => (
              <PairRow key={`${pair.a.id}-${pair.b.id}`} pair={pair} onGoTo={onGoTo} />
            ))}
        </div>
      )}
    </Dialog>
  );
}

const PairRow = memo(function PairRow({ pair, onGoTo }: { pair: Pair; onGoTo: (crossing: Crossing) => void }) {
  const decimals = 4;
  return (
    <div className="intersection-pair">
      <div className="intersection-head">
        <CurveTag drawable={pair.a} />
        <span className="intersection-x">×</span>
        <CurveTag drawable={pair.b} />
      </div>
      {pair.crossings.length === 0 ? (
        <p className="panel-note is-quiet">Do not cross in view</p>
      ) : (
        <div className="intersection-points">
          {pair.crossings.map((crossing, index) => (
            <button
              key={`${crossing.x}-${index}`}
              type="button"
              className="intersection-point"
              title="Centre the view here"
              onClick={() => onGoTo(crossing)}
            >
              ({formatNumber(crossing.x, decimals)}, {formatNumber(crossing.y, decimals)})
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

function CurveTag({ drawable }: { drawable: Drawable }) {
  return (
    <span className="curve-tag" style={{ color: drawable.color }}>
      <span className="curve-tag-dot" style={{ background: drawable.color }} />
      {drawable.label}
    </span>
  );
}
