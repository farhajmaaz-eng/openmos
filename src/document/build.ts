import { collectVars } from "../math/ast";
import { compile, compileField, type FieldFn, type UserFunction } from "../math/compile";
import { MathError } from "../math/errors";
import { parse, parseFunctionSignature, parseGraphSource, splitRelation } from "../math/parser";
import { tokenize } from "../math/tokenize";
import { toLatex } from "../math/latex";
import type { Document, ExpressionItem, Item, PointItem, TableItem } from "./types";

export type LineStyle = "solid" | "dashed" | "dotted";
export type FillStyle = "solid" | "semi" | "none";

/** Values available to an expression: slider and variable values. */
export type GraphScope = Record<string, number>;

export interface DrawableBase {
  id: string;
  color: string;
  label: string;
  /** Span of the offending token, when the expression failed to compile. */
  errorStart: number;
  errorEnd: number;
}

export interface CurveDrawable extends DrawableBase {
  kind: "curve";
  fn: (x: number, scope: GraphScope) => number;
  lineStyle: LineStyle;
  domain?: [number, number];
  labelHidden: boolean;
}

export interface ParametricDrawable extends DrawableBase {
  kind: "parametric";
  fn: (t: number, scope: GraphScope) => [number, number];
  domain: [number, number];
  lineStyle: LineStyle;
  labelHidden: boolean;
}

export interface ImplicitDrawable extends DrawableBase {
  kind: "implicit";
  field: FieldFn;
  lineStyle: LineStyle;
  fill: FillStyle;
}

export interface RegionDrawable extends DrawableBase {
  kind: "region";
  field: FieldFn;
  /** +1 when the true side is `field > 0`, -1 when it is `field < 0`. */
  sign: 1 | -1;
  fill: FillStyle;
  lineStyle: LineStyle;
}

export interface BadDrawable extends DrawableBase {
  kind: "bad";
  message: string;
}

export interface DefinitionDrawable extends DrawableBase {
  kind: "definition";
  params: string[];
}

export type Drawable =
  | CurveDrawable
  | ParametricDrawable
  | ImplicitDrawable
  | RegionDrawable
  | BadDrawable
  | DefinitionDrawable;

export interface TableColumn {
  header: string;
  values: number[];
}

export interface BuiltTable {
  id: string;
  color: string;
  columns: TableColumn[];
}

export interface BuildResult {
  drawables: Drawable[];
  tables: BuiltTable[];
  points: PointItem[];
  /** Slider and variable values that seed the graph scope. */
  scope: GraphScope;
  errors: Map<string, string>;
  /** LaTeX for every expression row, keyed by item id. */
  latex: Map<string, string>;
}

const PARAM_DOMAIN: [number, number] = [-Math.PI * 2, Math.PI * 2];
const POLAR_NAMES = new Set(["r", "rho"]);
const DEFAULT_COLUMN_NAMES = ["x", "y", "z", "w"];

interface CompileEnv {
  degrees: boolean;
  declared: Set<string>;
  functions: Map<string, UserFunction>;
}

function asNumber(value: number | number[]): number {
  return Array.isArray(value) ? (value[0] ?? NaN) : value;
}

function errorText(error: unknown): { message: string; start: number; end: number } {
  if (error instanceof MathError) return { message: error.message, start: error.start, end: error.end };
  return { message: (error as Error).message, start: -1, end: -1 };
}

/**
 * Split on a top-level comma. Parametric curves `(2t, t^2)` and multi-column
 * tables `[1,2], [3,4]` are both written this way, and the grammar otherwise
 * only allows commas inside call parentheses.
 */
export function splitTopLevel(source: string): string[] {
  const tokens = tokenize(source);
  const parts: string[] = [];
  let depth = 0;
  let last = 0;

  for (const token of tokens) {
    // Braces are skipped deliberately: they delimit piecewise branches and
    // `rac{a}{b}` arguments, and commas inside them are not separators.
    if (token.type === "lparen" || token.type === "lbracket") depth += 1;
    else if (token.type === "rparen" || token.type === "rbracket") depth -= 1;
    else if (token.type === "comma" && depth === 0) {
      parts.push(source.slice(last, token.start).trim());
      last = token.end;
    }
  }
  parts.push(source.slice(last).trim());
  return parts.filter((part) => part.length > 0);
}

/**
 * Remove one layer of wrapping parentheses, but only when they really wrap the
 * whole expression — `(2t, t^2)` is parametric, `(x+1)(x-1)` is a product.
 */
export function stripOuterParens(source: string): string {
  const trimmed = source.trim();
  if (!trimmed.startsWith("(")) return trimmed;

  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
    }
  }
  return trimmed;
}

/** Names a slider or a `name = value` line binds for later expressions. */
function declaredBy(item: Item): string[] {
  if (item.kind === "slider") return [item.variable];
  if (item.kind !== "expression") return [];

  const signature = parseFunctionSignature(item.source);
  if (signature) return [];

  const relation = splitRelation(item.source);
  if (!relation) return [];
  const { left } = relation;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(left)) return [];
  if (left === "x" || left === "y" || left === "t") return [];
  return [left];
}

export function buildDocument(document: Document): BuildResult {
  const { settings, items } = document;
  const degrees = settings.degrees;

  const declared = new Set<string>(["x", "y", "t"]);
  for (const item of items) for (const name of declaredBy(item)) declared.add(name);

  const functions = buildFunctions(items, declared, degrees);
  for (const name of functions.keys()) declared.add(name);

  const env: CompileEnv = { degrees, declared, functions };

  const scope: GraphScope = { x: 0, y: 0, t: 0 };
  for (const item of items) {
    if (item.kind === "slider") scope[item.variable] = item.value;
  }

  const drawables: Drawable[] = [];
  const tables: BuiltTable[] = [];
  const points: PointItem[] = [];
  const errors = new Map<string, string>();
  const latex = new Map<string, string>();

  for (const item of items) {
    if (item.kind === "slider") continue;
    if (item.kind === "point") {
      points.push(item);
      continue;
    }
    if (item.kind === "table") {
      tables.push(buildTable(item, env));
      continue;
    }

    const signature = parseFunctionSignature(item.source);
    if (signature) {
      drawables.push({
        kind: "definition",
        id: item.id,
        color: item.color,
        label: item.source,
        params: signature.params,
        errorStart: -1,
        errorEnd: -1,
      });
      latex.set(item.id, `\\operatorname{${signature.name}}\\left(${signature.params.join(",")}\\right)=${safeLatex(
        item.source.slice(item.source.indexOf("=") + 1),
        declared,
      )}`);
      continue;
    }

    const result = buildExpression(item, env);
    drawables.push(result.drawable);
    latex.set(item.id, result.latex);
    if (result.drawable.kind === "bad") errors.set(item.id, result.drawable.message);
  }

  return { drawables, tables, points, scope, errors, latex };
}

function safeLatex(source: string, declared: Set<string>): string {
  try {
    return toLatex(parseGraphSource(source, { reserved: declared }));
  } catch {
    return source;
  }
}

/** Compile user functions in order so later ones can call earlier ones. */
function buildFunctions(items: Item[], declared: Set<string>, degrees: boolean): Map<string, UserFunction> {
  const functions = new Map<string, UserFunction>();

  for (const item of items) {
    if (item.kind !== "expression") continue;
    const signature = parseFunctionSignature(item.source);
    if (!signature || functions.has(signature.name)) continue;

    const bodySource = item.source.slice(item.source.indexOf("=") + 1);
    try {
      const scope = new Set([...declared, ...signature.params]);
      const node = parse(bodySource, { reserved: scope });
      if (collectVars(node).has(signature.name)) {
        throw new MathError(`\`${signature.name}\` cannot refer to itself`, 0, signature.name.length);
      }
      const { fn } = compile(node, { degrees, declared: scope, functions });
      functions.set(signature.name, { name: signature.name, params: signature.params, fn });
    } catch {
      // A broken definition is simply unavailable; its own row shows the error.
    }
  }

  return functions;
}

/* ------------------------------------------------------------- expressions */

interface ExpressionBuild {
  drawable: Drawable;
  latex: string;
  /** Overrides the on-graph label when the default would be too long. */
  label?: string;
}

function buildExpression(item: ExpressionItem, env: CompileEnv): ExpressionBuild {
  const source = item.source;
  const label = item.label && item.label.trim().length > 0 ? item.label : source;
  const base = { id: item.id, color: item.color, label, errorStart: -1, errorEnd: -1 };
  const lineStyle: LineStyle = item.lineStyle ?? "solid";
  const fail = (error: unknown): ExpressionBuild => {
    const { message, start, end } = errorText(error);
    return {
      drawable: { ...base, kind: "bad", message, errorStart: start, errorEnd: end },
      latex: source,
    };
  };

  if (source.trim().length === 0) {
    return { drawable: { ...base, kind: "bad", message: "" }, latex: "" };
  }

  try {
    // `r(theta)` draws a polar curve.
    const polar = tryPolar(source, base, lineStyle, env);
    if (polar) {
      return {
        drawable: polar.drawable.kind === "parametric" ? { ...polar.drawable, label: polar.label ?? polar.drawable.label } : polar.drawable,
        latex: polar.latex,
      };
    }

    // `(2t, t^2)` draws a parametric curve. Braces rule this out: they mark a
    // piecewise list, which also uses commas as separators.
    const pair = source.includes("{") ? [] : splitTopLevel(stripOuterParens(source));
    if (pair.length === 2) {
      const xNode = parse(pair[0]!, { reserved: env.declared });
      const yNode = parse(pair[1]!, { reserved: env.declared });
      const xFn = compile(xNode, env);
      const yFn = compile(yNode, env);
      return {
        drawable: {
          ...base,
          kind: "parametric",
          fn: (t, scope) => [asNumber(xFn.fn({ ...scope, t })), asNumber(yFn.fn({ ...scope, t }))],
          domain: item.parameterDomain ?? PARAM_DOMAIN,
          lineStyle,
          labelHidden: item.labelHidden ?? false,
        },
        latex: `\\left(${toLatex(xNode)},${toLatex(yNode)}\\right)`,
      };
    }

    const node = parseGraphSource(source, { reserved: env.declared });
    const latex = toLatex(node);
    const usesX = collectVars(node).has("x");
    const usesY = collectVars(node).has("y");
    const usesT = collectVars(node).has("t");

    if (usesT) {
      throw new MathError("`t` only makes sense in a pair like (t, t^2)", 0, 1);
    }

    if (node.kind === "relation") {
      const rightVars = collectVars(node.right);

      // `y = f(x)` is an ordinary function of x.
      if (node.left.kind === "var" && node.left.name === "y" && !rightVars.has("y")) {
        const fn = compile(node.right, env);
        return {
          drawable: {
            ...base,
            kind: "curve",
            fn: (x, scope) => asNumber(fn.fn({ ...scope, x })),
            lineStyle,
            domain: item.domain,
            labelHidden: item.labelHidden ?? false,
          },
          latex,
        };
      }

      // Anything else with an `=` is an implicit curve: `x = 3` draws a
      // vertical line, `x^2 + y^2 = 9` a circle.
      if (!usesX && !usesY) throw new MathError("That equation has no x or y in it", 0, source.length);

      return {
        drawable: {
          ...base,
          kind: "implicit",
          field: compileField(node, env),
          lineStyle,
          fill: item.fill ?? "none",
        },
        latex,
      };
    }

    if (node.kind === "compare" || node.kind === "logic") {
      if (node.kind === "compare" && node.op === "!=") {
        throw new MathError("`!=` has no curve — use < or > to shade a region", 0, source.length);
      }
      const sign = node.kind === "compare" && (node.op === "<" || node.op === "<=") ? -1 : 1;
      return {
        drawable: {
          ...base,
          kind: "region",
          field: compileField(node, env),
          sign,
          fill: item.fill ?? "semi",
          lineStyle,
        },
        latex,
      };
    }

    if (usesY) {
      // A bare two-variable expression has no curve of its own, so show the
      // level set where it is zero — that is what people mean by `x^2 + y^2`.
      return {
        drawable: {
          ...base,
          kind: "implicit",
          field: compileField(node, env),
          lineStyle,
          fill: item.fill ?? "none",
        },
        latex: `${latex}=0`,
      };
    }

    const fn = compile(node, env);
    return {
      drawable: {
        ...base,
        kind: "curve",
        fn: (x, scope) => asNumber(fn.fn({ ...scope, x })),
        lineStyle,
        domain: item.domain,
        labelHidden: item.labelHidden ?? false,
      },
      latex,
    };
  } catch (error) {
    return fail(error);
  }
}

function tryPolar(
  source: string,
  base: DrawableBase,
  lineStyle: LineStyle,
  env: CompileEnv,
): ExpressionBuild | null {
  const trimmed = source.trim();
  const match = /^([A-Za-z]+)\s*\(/.exec(trimmed);
  if (!match || !POLAR_NAMES.has(match[1]!)) return null;
  if (trimmed.includes("=")) return null;

  try {
    const node = parse(trimmed, { reserved: env.declared });
    if (node.kind !== "call" || node.args.length !== 1) return null;

    // `r(...)` is not a call, it is a radius: compile what is inside.
    const radiusNode = node.args[0]!;
    const { fn } = compile(radiusNode, env);
    const domain: [number, number] = env.degrees ? [-360, 360] : PARAM_DOMAIN;
    const radiusLatex = toLatex(radiusNode);

    return {
      drawable: {
        ...base,
        kind: "parametric",
        fn: (theta, scope) => {
          const r = asNumber(fn({ ...scope, t: theta }));
          const angle = env.degrees ? (theta * Math.PI) / 180 : theta;
          return [r * Math.cos(angle), r * Math.sin(angle)];
        },
        domain,
        lineStyle,
        labelHidden: false,
      },
      latex: `\\left(${radiusLatex}\\cos t,${radiusLatex}\\sin t\\right)`,
      label: trimmed,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ tables */

/**
 * A table shows one column per top-level list. `[1, 2, 3], [1, 4, 9]` gives an
 * `x` and a `y` column; `height = [1, 2, 3]` names the column directly.
 */
function buildTable(item: TableItem, env: CompileEnv): BuiltTable {
  const columns: TableColumn[] = [];

  for (const [index, segment] of splitTopLevel(item.source).entries()) {
    const binding = splitRelation(segment);
    const expression = binding ? binding.right : segment;
    const header = binding?.left ?? DEFAULT_COLUMN_NAMES[index] ?? `col${index + 1}`;

    let values: number[] = [];
    try {
      const node = parse(expression, { reserved: env.declared });
      const { fn } = compile(node, env);
      const result = fn({});
      values = Array.isArray(result)
        ? result.filter((value) => Number.isFinite(value))
        : Number.isFinite(asNumber(result))
          ? [asNumber(result)]
          : [];
    } catch {
      values = [];
    }
    columns.push({ header, values });
  }

  // Every column lines up with the longest one; gaps are shown as missing.
  const length = columns.reduce((max, column) => Math.max(max, column.values.length), 0);
  for (const column of columns) {
    while (column.values.length < length) column.values.push(NaN);
  }

  return { id: item.id, color: item.color, columns };
}

/** Evaluate a table column, used by the regression tools. */
export function columnValues(table: BuiltTable, index: number): number[] {
  return table.columns[index]?.values ?? [];
}

