import { colorAt, type Document, type ExpressionItem, type SliderItem } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_VIEWPORT } from "./types";

/**
 * The document a first-time visitor sees. It is deliberately small: one
 * obvious curve, one that needs a slider to feel alive, and one implicit
 * circle, so each kind of expression announces itself.
 */
export function welcomeDocument(): Document {
  const parabola: ExpressionItem = {
    id: "welcome-1",
    kind: "expression",
    color: colorAt(0),
    source: "y = x^2 - 2",
  };

  const a: SliderItem = {
    id: "welcome-2",
    kind: "slider",
    color: colorAt(1),
    variable: "a",
    min: -2,
    max: 6,
    step: 0.1,
    value: 2,
  };

  const sine: ExpressionItem = {
    id: "welcome-3",
    kind: "expression",
    color: colorAt(1),
    source: "y = a sin(x)",
  };

  const circle: ExpressionItem = {
    id: "welcome-4",
    kind: "expression",
    color: colorAt(2),
    source: "x^2 + y^2 = 16",
    fill: "semi",
  };

  return {
    items: [a, parabola, sine, circle],
    viewport: { ...DEFAULT_VIEWPORT, scale: 1 / 18 },
    settings: { ...DEFAULT_SETTINGS },
    seed: 5,
  };
}