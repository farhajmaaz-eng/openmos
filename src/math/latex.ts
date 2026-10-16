import type { Node } from "./ast";
import { formatNumber } from "./format";
import { FUNCTION_NAMES } from "./tokenize";

/**
 * AST to LaTeX.
 *
 * The input field renders whatever the user typed through this function, which
 * is why it reproduces the shape they meant rather than a canonical form: `2x`
 * stays `2x`, `x^2` becomes a real superscript, `1/2` becomes a real fraction.
 */

const GREEK = new Set([
  "pi",
  "tau",
  "phi",
  "theta",
  "alpha",
  "beta",
  "gamma",
  "delta",
  "lambda",
  "mu",
  "sigma",
  "omega",
  "rho",
  "epsilon",
]);

/** Functions whose LaTeX name differs from the callable name. */
const FUNCTION_LATEX: Record<string, string> = {
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  sec: "\\sec",
  csc: "\\csc",
  cot: "\\cot",
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  sinh: "\\sinh",
  cosh: "\\cosh",
  tanh: "\\tanh",
  exp: "\\exp",
  ln: "\\ln",
  lg: "\\log_{2}",
  log: "\\log",
};

const COMPARE_LATEX: Record<string, string> = {
  "=": "=",
  "<": "<",
  "<=": "\\le",
  ">": ">",
  ">=": "\\ge",
  "!=": "\\ne",
};

/** Precedence of the loosest operator at the root of a sub-expression. */
function rootPrecedence(node: Node): number {
  switch (node.kind) {
    case "logic":
      return node.op === "or" ? 1 : 2;
    case "compare":
    case "relation":
      return 3;
    case "bin":
      return node.op === "+" || node.op === "-" ? 4 : node.op === "^" ? 6 : 5;
    case "unary":
      return 4;
    default:
      return 9;
  }
}

function print(node: Node, parentPrecedence = 0): string {
  const body = render(node);
  return rootPrecedence(node) < parentPrecedence ? `\\left(${body}\\right)` : body;
}

function render(node: Node): string {
  switch (node.kind) {
    case "num":
      return formatMathNumber(node.value);

    case "var":
      return renderName(node.name);

    case "group":
      return `\\left(${print(node.arg, 0)}\\right)`;

    case "abs":
      return `\\left|${print(node.arg, 0)}\\right|`;

    case "unary":
      if (node.op === "factorial") return `${print(node.arg, 6)}!`;
      if (node.op === "not") return `\\neg ${print(node.arg, 6)}`;
      return `-${print(node.arg, 4)}`;

    case "bin":
      return renderBinary(node);

    case "call":
      return renderCall(node);

    case "list":
      return `\\left[${node.items.map((item) => print(item, 0)).join(",")}\\right]`;

    case "index":
      return `${print(node.target, 9)}\\left[${print(node.index, 0)}\\right]`;

    case "logic": {
      const word = node.op === "or" ? "\\text{ or }" : "\\text{ and }";
      const precedence = node.op === "or" ? 1 : 2;
      return `${print(node.left, precedence)}${word}${print(node.right, precedence)}`;
    }

    case "compare":
      return `${print(node.left, 3)}\\ ${COMPARE_LATEX[node.op] ?? node.op}\\ ${print(node.right, 3)}`;

    case "relation":
      return `${print(node.left, 3)}=${print(node.right, 3)}`;

    case "piecewise":
      return renderPiecewise(node);
  }
}

function renderBinary(node: Extract<Node, { kind: "bin" }>): string {
  const { op, left, right } = node;

  switch (op) {
    case "+":
      return `${print(left, 4)}+${print(right, 4)}`;

    case "-":
      // `a-(b-c)` needs the parentheses back or the reading changes.
      return `${print(left, 4)}-${print(right, rootPrecedence(right) < 4 ? 0 : 4)}`;

    case "*": {
      const useJuxtaposition = canJuxtapose(left) && canJuxtapose(right);
      const operator = useJuxtaposition ? "" : "\\cdot ";
      return `${print(left, 5)}${operator}${print(right, 6)}`;
    }

    case "/": {
      if (isTidy(left) && isTidy(right)) {
        return `\\frac{${print(left, 0)}}{${print(right, 0)}}`;
      }
      return `${print(left, 5)}/${print(right, 5)}`;
    }

    case "%":
      return `${print(left, 5)}\\bmod ${print(right, 5)}`;

    case "^":
      return renderPower(node);
  }
}

function renderPower(node: Extract<Node, { kind: "bin" }>): string {
  const printedBase = print(node.left, 7);
  // A single symbol can ride bare; anything longer needs its own group.
  const base = /^[a-zA-Z0-9]$/.test(printedBase) ? printedBase : `{${printedBase}}`;
  return `${base}^{${print(node.right, 0)}}`;
}

function renderCall(node: Extract<Node, { kind: "call" }>): string {
  const { name, args } = node;
  const mapped = FUNCTION_LATEX[name];

  if (name === "sqrt" && args.length === 1) return `\\sqrt{${print(args[0]!, 0)}}`;
  if (name === "cbrt" && args.length === 1) return `\\sqrt[3]{${print(args[0]!, 0)}}`;
  if (name === "nthroot" && args.length === 2) {
    return `\\sqrt[${print(args[0]!, 0)}]{${print(args[1]!, 0)}}`;
  }
  if (name === "frac" && args.length === 2) {
    return `\\frac{${print(args[0]!, 0)}}{${print(args[1]!, 0)}}`;
  }
  if ((name === "floor" || name === "ceil") && args.length === 1) {
    const open = name === "floor" ? "\\left\\lfloor " : "\\left\\lceil ";
    const close = name === "floor" ? " \\right\\rfloor" : " \\right\\rceil";
    return `${open}${print(args[0]!, 0)}${close}`;
  }
  if (name === "abs" && args.length === 1) return `\\left|${print(args[0]!, 0)}\\right|`;

  const head = mapped ?? renderName(name);
  const body = args.map((arg) => print(arg, 0)).join(",");
  return `${head}\\left(${body}\\right)`;
}

function renderPiecewise(node: Extract<Node, { kind: "piecewise" }>): string {
  const rows = node.branches.map((branch) => {
    const value = print(branch.value, 0);
    return branch.condition === null
      ? `${value}\\\\`
      : `${value}\\quad\\text{if}\\ ${print(branch.condition, 0)}`;
  });
  return `\\begin{cases}${rows.join(" \\\\ ")}\\end{cases}`;
}

/** Can this node be written straight after another one with no operator? */
function canJuxtapose(node: Node): boolean {
  switch (node.kind) {
    case "num":
    case "var":
    case "group":
    case "abs":
    case "call":
      return true;
    case "unary":
      return node.op === "-";
    case "bin":
      // A product or power is still a single value, so `3x^2` stays glued.
      return node.op === "+" || node.op === "-" || node.op === "*" || node.op === "^";
    default:
      return false;
  }
}

/** Simple enough to sit inside a fraction or an exponent. */
function isTidy(node: Node): boolean {
  switch (node.kind) {
    case "num":
    case "var":
    case "abs":
      return true;
    case "group":
      return true;
    case "unary":
      return node.op === "-";
    case "call":
      return node.name !== "mod" && node.name !== "rem";
    case "bin":
      return node.op === "^" || node.op === "*";
    default:
      return false;
  }
}

/**
 * Variable names become italic single letters, Greek commands, a base letter
 * with a subscript when the name is two characters (`a_1`, `x2`), or upright
 * text for anything longer.
 */
function renderName(name: string): string {
  if (GREEK.has(name)) {
    switch (name) {
      case "pi":
        return "\\pi";
      case "tau":
        return "\\tau";
      case "phi":
        return "\\phi";
      case "theta":
        return "\\theta";
      case "epsilon":
        return "\\varepsilon";
      default:
        return `\\${name}`;
    }
  }

  if (name === "e") return "e";
  if (/^[A-Za-z0-9]$/.test(name)) return name;

  const subscript = /^([A-Za-z])_?([A-Za-z0-9]+)$/.exec(name);
  if (subscript && !FUNCTION_NAMES.has(name)) {
    const base = subscript[1]!;
    const baseLatex = GREEK.has(base) ? `\\${base}` : base;
    return `${baseLatex}_{${renderName(subscript[2]!)}}`;
  }

  // Multi-letter names are function names or deliberate labels, both upright.
  return `\\operatorname{${name}}`;
}

function formatMathNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "\\infty" : "-\\infty";
  const text = formatNumber(value, 8);
  return text;
}

/**
 * Render an expression tree as LaTeX.
 */
export function toLatex(node: Node): string {
  return print(node, 0);
}

/**
 * Last-resort printer for sources that failed to parse: show them verbatim so
 * the user still sees what they typed.
 */
export function rawToLatex(source: string): string {
  return source.replace(/([_^])/g, "\\$1").replace(/([{}])/g, "\\$1");
}