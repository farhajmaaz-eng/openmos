import type { CompareOp, Node } from "./ast";
import { walk } from "./ast";
import { fail } from "./errors";
import { CONSTANT_VALUES, FUNCTIONS, factorial, isList, type Value } from "./functions";

/** Variables available while evaluating: always `x`, plus whatever is declared. */
export type Scope = Record<string, number>;

export type Compiled = (scope: Scope) => Value;

/** A scalar field over the plane, used for implicit curves and shading. */
export type FieldFn = (x: number, y: number, scope: Record<string, number>) => number;

export interface CompileOptions {
  degrees?: boolean;
  /** Names the user has bound (sliders, points, earlier expressions, params). */
  declared?: Set<string>;
  /** Functions the user defined with `f(x) = …`. */
  functions?: Map<string, UserFunction>;
}

export interface UserFunction {
  name: string;
  params: string[];
  /** Takes a scope where the parameters are already bound. */
  fn: Compiled;
}

export interface CompileResult {
  fn: Compiled;
  variables: Set<string>;
  /** `true` when the expression can evaluate to a list instead of a number. */
  listy: boolean;
}

/** Calls that hand back a list no matter what you feed them. */
const LIST_FUNCTIONS = new Set([
  "range",
  "linspace",
  "sort",
  "sortBy",
  "reverse",
  "unique",
  "union",
  "shuffle",
  "join",
  "joinNumber",
]);

function lookup(scope: Scope, name: string): Value {
  const value = scope[name];
  if (value !== undefined) return value;
  const constant = CONSTANT_VALUES[name];
  if (constant !== undefined) return constant;
  return NaN;
}

function asNumber(value: Value): number {
  return isList(value) ? (value[0] ?? NaN) : value;
}

function truthy(value: Value): boolean {
  const scalar = asNumber(value);
  return Number.isFinite(scalar) ? scalar !== 0 : false;
}

export function compare(op: CompareOp, a: number, b: number): boolean {
  switch (op) {
    case "=":
      return Math.abs(a - b) < 1e-9;
    case "!=":
      return Math.abs(a - b) >= 1e-9;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
  }
}

function collectVariables(node: Node): Set<string> {
  const names = new Set<string>();
  walk(node, (n) => {
    if (n.kind === "var") names.add(n.name);
    if (n.kind === "call") names.add(n.name);
  });
  return names;
}

function mayProduceList(node: Node): boolean {
  let listy = false;
  walk(node, (n) => {
    if (n.kind === "list" || n.kind === "index") listy = true;
    if (n.kind === "call" && LIST_FUNCTIONS.has(n.name)) listy = true;
    if (n.kind === "piecewise") {
      for (const branch of n.branches) if (branch.value.kind === "list") listy = true;
    }
  });
  return listy;
}

/**
 * Compile a node tree into a closure.
 *
 * Compiling once and calling many times matters: a single redraw can evaluate
 * one expression tens of thousands of times, and re-walking the tree every
 * time shows up in profiles on slower machines.
 */
export function compile(node: Node, options: CompileOptions = {}): CompileResult {
  const ctx = makeContext(options);
  const fn = build(node, ctx);
  return { fn, variables: collectVariables(node), listy: mayProduceList(node) };
}

interface BuildContext {
  degrees: boolean;
  declared: Set<string>;
  functions: Map<string, UserFunction>;
}

function makeContext(options: CompileOptions): BuildContext {
  return {
    degrees: options.degrees ?? false,
    declared: options.declared ?? new Set(),
    functions: options.functions ?? new Map(),
  };
}

function build(node: Node, ctx: BuildContext): Compiled {
  switch (node.kind) {
    case "num": {
      const value = node.value;
      return () => value;
    }

    case "group":
      return build(node.arg, ctx);

    case "var": {
      const name = node.name;
      const span = { start: node.start, end: node.start + name.length };
      const isParameter = ctx.declared.has(name);
      if (!isParameter && CONSTANT_VALUES[name] === undefined) {
        if (FUNCTIONS.has(name) || ctx.functions.has(name)) {
          fail(`\`${name}\` is a function — try ${name}(...)`, span);
        }
        fail(`\`${name}\` is not defined`, span);
      }
      return (scope) => lookup(scope, name);
    }

    case "unary": {
      if (node.op === "+") return build(node.arg, ctx);
      if (node.op === "not") {
        const arg = build(node.arg, ctx);
        return (scope) => (truthy(arg(scope)) ? 0 : 1);
      }
      if (node.op === "factorial") {
        const arg = build(node.arg, ctx);
        return (scope) => factorial(asNumber(arg(scope)));
      }
      const arg = build(node.arg, ctx);
      return (scope) => -asNumber(arg(scope));
    }

    case "bin":
      return buildBinary(node, ctx);

    case "abs": {
      const arg = build(node.arg, ctx);
      return (scope) => Math.abs(asNumber(arg(scope)));
    }

    case "call": {
      const span = { start: node.start, end: node.start + node.name.length };
      const userFn = ctx.functions.get(node.name);
      if (userFn) {
        if (userFn.params.length !== node.args.length) {
          fail(
            `${node.name}() takes ${userFn.params.length} argument${userFn.params.length === 1 ? "" : "s"}, got ${node.args.length}`,
            span,
          );
        }
        const paramFns = node.args.map((arg) => build(arg, ctx));
        const params = userFn.params;
        const body = userFn.fn;
        return (scope) => {
          // The body may read sliders as well as its parameters, so start from
          // the caller's scope and shadow the parameters on top.
          const local: Scope = { ...scope };
          for (let i = 0; i < params.length; i += 1) local[params[i]!] = asNumber(paramFns[i]!(scope));
          return asNumber(body(local));
        };
      }

      const spec = FUNCTIONS.get(node.name);
      if (!spec) fail(`\`${node.name}\` is not a function`, span);

      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        const expected =
          spec.minArgs === spec.maxArgs
            ? `${spec.minArgs} argument${spec.minArgs === 1 ? "" : "s"}`
            : spec.maxArgs === Infinity
              ? `at least ${spec.minArgs} argument${spec.minArgs === 1 ? "" : "s"}`
              : `${spec.minArgs}–${spec.maxArgs} arguments`;
        fail(`${node.name}() takes ${expected}, got ${node.args.length}`, span);
      }

      const argFns = node.args.map((arg) => build(arg, ctx));
      const angleMode = spec.angle ? ctx.degrees : false;
      return (scope) => {
        const values = new Array<Value>(argFns.length);
        for (let i = 0; i < argFns.length; i += 1) values[i] = argFns[i]!(scope);
        return spec.call(values, angleMode);
      };
    }

    case "list": {
      const items = node.items.map((item) => build(item, ctx));
      return (scope) => items.map((item) => asNumber(item(scope)));
    }

    case "index": {
      const target = build(node.target, ctx);
      const index = build(node.index, ctx);
      return (scope) => {
        const list = target(scope);
        const at = Math.round(asNumber(index(scope)));
        if (!isList(list)) return NaN;
        // Lists are 1-indexed, matching how they are written in the editor.
        return list[at > 0 ? at - 1 : list.length + at] ?? NaN;
      };
    }

    case "logic": {
      const left = build(node.left, ctx);
      const right = build(node.right, ctx);
      if (node.op === "and") {
        return (scope) => (truthy(left(scope)) ? (truthy(right(scope)) ? 1 : 0) : 0);
      }
      return (scope) => (truthy(left(scope)) || truthy(right(scope)) ? 1 : 0);
    }

    case "compare": {
      const left = build(node.left, ctx);
      const right = build(node.right, ctx);
      return (scope) => (compare(node.op, asNumber(left(scope)), asNumber(right(scope))) ? 1 : 0);
    }

    case "relation": {
      // A relation doubles as a predicate when the caller needs a boolean.
      const left = build(node.left, ctx);
      const right = build(node.right, ctx);
      return (scope) => (compare("=", asNumber(left(scope)), asNumber(right(scope))) ? 1 : 0);
    }

    case "piecewise": {
      const branches = node.branches.map((branch) => ({
        value: build(branch.value, ctx),
        condition: branch.condition ? build(branch.condition, ctx) : null,
      }));
      return (scope) => {
        for (const branch of branches) {
          if (branch.condition === null) return asNumber(branch.value(scope));
          if (truthy(branch.condition(scope))) return asNumber(branch.value(scope));
        }
        return NaN;
      };
    }
  }
}

function buildBinary(node: Extract<Node, { kind: "bin" }>, ctx: BuildContext): Compiled {
  const left = build(node.left, ctx);
  const right = build(node.right, ctx);
  const op = node.op;

  if (op === "^") {
    return (scope) => Math.pow(asNumber(left(scope)), asNumber(right(scope)));
  }

  return (scope) => {
    const a = left(scope);
    const b = right(scope);
    switch (op) {
      case "+":
        return add(a, b);
      case "-":
        return subtract(a, b);
      case "*":
        return multiply(a, b);
      case "/":
        return divide(a, b);
      case "%":
        return modulo(a, b);
    }
  };
}

/* ------------------------------------------------------ value-aware arithmetic */

function broadcast(a: Value, b: Value, fn: (x: number, y: number) => number): Value {
  if (!isList(a) && !isList(b)) return fn(a, b);
  const length = Math.max(isList(a) ? a.length : 1, isList(b) ? b.length : 1);
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push(fn(isList(a) ? (a[i] ?? NaN) : a, isList(b) ? (b[i] ?? NaN) : b));
  }
  return out;
}

function add(a: Value, b: Value): Value {
  return broadcast(a, b, (x, y) => x + y);
}

function subtract(a: Value, b: Value): Value {
  return broadcast(a, b, (x, y) => x - y);
}

function multiply(a: Value, b: Value): Value {
  if (!isList(a)) return broadcast(a, b, (x, y) => x * y);
  if (!isList(b)) return broadcast(b, a, (x, y) => y * x);
  // Outer product, so [1, 2] * [3, 4] gives [3, 4, 6, 8].
  const out: number[] = [];
  for (const x of a) for (const y of b) out.push(x * y);
  return out;
}

function divide(a: Value, b: Value): Value {
  return broadcast(a, b, (x, y) => (y === 0 ? NaN : x / y));
}

function modulo(a: Value, b: Value): Value {
  return broadcast(a, b, (x, y) => (y === 0 ? NaN : x % y));
}

/* ------------------------------------------------------------------- fields */

/**
 * Compile something that depends on both `x` and `y` into a scalar field.
 *
 * Two conventions are used, and they both vanish on the boundary:
 *  - relations compile to `left - right`, a smooth difference whose zero set
 *    is the curve, which gives the best interpolation in marching squares;
 *  - comparisons and logic compile to a *truth field* that is positive inside
 *    the region and negative outside, so a single `> 0` test describes every
 *    kind of inequality and any chain of them.
 */
export function compileField(node: Node, options: CompileOptions = {}): FieldFn {
  const ctx = makeContext(options);

  switch (node.kind) {
    case "relation":
      return signedField(node, ctx);

    case "compare":
    case "logic":
      return truthField(node, ctx);

    case "piecewise": {
      const branches = node.branches.map((branch) => ({
        field: fieldOf(branch.value, ctx),
        condition: branch.condition ? build(branch.condition, ctx) : null,
      }));
      return (x, y, scope) => {
        const local = { ...scope, x, y };
        for (const branch of branches) {
          if (branch.condition === null) return branch.field(x, y, scope);
          if (truthy(branch.condition(local))) return branch.field(x, y, scope);
        }
        return NaN;
      };
    }

    case "group":
      return fieldOf(node.arg, ctx);

    default:
      return wrapScalar(build(node, ctx));
  }
}

function fieldOf(node: Node, ctx: BuildContext): FieldFn {
  return compileField(node, { degrees: ctx.degrees, declared: ctx.declared, functions: ctx.functions });
}

/** `left - right`, recursing through any nested comparisons or logic. */
function signedField(
  node: Extract<Node, { kind: "relation" | "compare" }>,
  ctx: BuildContext,
): FieldFn {
  const left = fieldOf(node.left, ctx);
  const right = fieldOf(node.right, ctx);
  return (x, y, scope) => left(x, y, scope) - right(x, y, scope);
}

/** Positive where the comparison holds. */
function truthField(node: Extract<Node, { kind: "compare" | "logic" }>, ctx: BuildContext): FieldFn {
  if (node.kind === "logic") {
    const left = truthField(node.left as Extract<Node, { kind: "compare" }>, ctx);
    const right = truthField(node.right as Extract<Node, { kind: "compare" }>, ctx);
    return node.op === "and"
      ? (x, y, scope) => Math.min(left(x, y, scope), right(x, y, scope))
      : (x, y, scope) => Math.max(left(x, y, scope), right(x, y, scope));
  }

  const right = fieldOf(node.right, ctx);

  // `a < b < c` parses as a nested comparison; both halves have to hold, so
  // take the intersection.
  if (node.left.kind === "compare" || node.left.kind === "logic") {
    const left = truthField(node.left, ctx);
    return (x, y, scope) => Math.min(left(x, y, scope), orient(node.op, right(x, y, scope)));
  }

  const left = fieldOf(node.left, ctx);
  return (x, y, scope) => orient(node.op, left(x, y, scope) - right(x, y, scope));
}

/** Flip a difference so that "holds" always means positive. */
function orient(op: CompareOp, difference: number): number {
  switch (op) {
    case "<":
    case "<=":
      return -difference;
    case ">":
    case ">=":
      return difference;
    case "=":
      return -Math.abs(difference);
    case "!=":
      return Math.abs(difference);
  }
}

/** Turn a plain expression into a field that is positive where it holds. */
function wrapScalar(fn: Compiled): FieldFn {
  return (x, y, scope) => asNumber(fn({ ...scope, x, y }));
}