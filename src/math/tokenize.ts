export type TokenType =
  | "number"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "bar"
  | "relop"
  | "eof";

export interface Token {
  type: TokenType;
  /** Canonical text for the token, after alias resolution. */
  value: string;
  start: number;
  end: number;
}

/**
 * LaTeX spellings we accept on input. openmos renders math notation by
 * default, but people paste from LaTeX sources constantly, so the common
 * commands are translated rather than rejected.
 */
const LATEX_ALIASES: Record<string, string> = {
  pi: "pi",
  tau: "tau",
  phi: "phi",
  theta: "theta",
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  lambda: "lambda",
  mu: "mu",
  sigma: "sigma",
  omega: "omega",
  rho: "rho",
  epsilon: "epsilon",
  infty: "infty",
  cdot: "*",
  times: "*",
  div: "/",
  pm: "+-",
  mp: "-+",
  le: "<=",
  leq: "<=",
  ge: ">=",
  geq: ">=",
  ne: "!=",
  neq: "!=",
  ll: "<<",
  gg: ">>",
  land: "and",
  lor: "or",
  lnot: "!",
  mod: "%",
  frac: "frac",
  sqrt: "sqrt",
  cbrt: "cbrt",
  abs: "abs",
  exp: "exp",
  ln: "ln",
  log: "log",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  sec: "sec",
  csc: "csc",
  cot: "cot",
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
  left: "left",
  right: "right",
  lvert: "|",
  rvert: "|",
  vert: "|",
  lVert: "|",
  rVert: "|",
};

/** Greek letters and constants that may not be reassigned by the user. */
export const CONSTANTS = new Set([
  "pi",
  "e",
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
  "infty",
]);

/** Function names are never split into single letters. */
export const FUNCTION_NAMES = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "sqrt", "cbrt", "nthroot", "abs", "exp", "ln", "lg",
  "log", "floor", "ceil", "round", "sign", "min", "max", "mean", "median",
  "stddev", "variance", "gcd", "lcm", "nCr", "nPr", "factorial", "mod", "rem",
  "sum", "length", "sort", "sortBy", "reverse", "unique", "union", "shuffle",
  "range", "linspace", "rand", "randInt", "randomSeed",
  "frac", "and", "or",
]);

const isDigit = (ch: string) => ch >= "0" && ch <= "9";
const isAlpha = (ch: string) =>
  (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

const OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "(", ")", "[", "]", "{", "}", ",", "|", "="]);

/**
 * `xy` is two variables multiplied, not one variable with a long name. We only
 * split pure-letter runs: anything containing a digit or an underscore is
 * assumed to be a deliberate name like `a_1` or `x2`.
 */
function splitIdentifier(name: string): string[] | null {
  if (name.length < 2 || !/^[A-Za-z]+$/.test(name)) return null;
  if (CONSTANTS.has(name)) return null;
  return [...name];
}

/**
 * Turn source text into tokens. Unknown LaTeX commands degrade into plain
 * identifiers (`\foo` -> `foo`) so that `\myvar` still reads as a variable.
 */
export function tokenize(source: string, reserved: ReadonlySet<string> = new Set()): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    // LaTeX command
    if (ch === "\\") {
      const start = i;
      i += 1;
      while (i < source.length && /[a-zA-Z]/.test(source[i]!)) i += 1;
      const command = source.slice(start + 1, i);
      const aliased = LATEX_ALIASES[command];

      if (aliased === undefined) {
        if (command.length === 0) {
          tokens.push({ type: "op", value: "\\", start, end: i });
        } else {
          tokens.push({ type: "ident", value: command, start, end: i });
        }
        continue;
      }

      // `\left(` / `\right)` only carry grouping intent; treat as thin parens.
      if (aliased === "left" || aliased === "right") {
        i = skipSpaces(source, i);
        const next = source[i];
        if (next === "(") {
          tokens.push({ type: "lparen", value: "(", start, end: ++i });
          continue;
        }
        if (next === "[") {
          tokens.push({ type: "lbracket", value: "[", start, end: ++i });
          continue;
        }
        if (next === "|") {
          tokens.push({ type: "bar", value: "|", start, end: ++i });
          continue;
        }
        if (next === "{") {
          tokens.push({ type: "lbrace", value: "{", start, end: ++i });
          continue;
        }
        continue;
      }

      if (aliased === "|" || aliased === "+-" || aliased === "-+" || aliased === "and" || aliased === "or") {
        // Multi-character symbols need to be split into their parts.
        for (const part of aliased) tokens.push({ type: "op", value: part, start, end: i });
        continue;
      }

      if (aliased === "!" || aliased === "!=") {
        tokens.push({ type: "relop", value: aliased, start, end: i });
        continue;
      }

      if (aliased === "<=" || aliased === ">=" || aliased === "<<" || aliased === ">>") {
        tokens.push({ type: "relop", value: aliased, start, end: i });
        continue;
      }

      if (aliased === "+" || aliased === "-" || aliased === "*" || aliased === "/" || aliased === "^" || aliased === "%") {
        tokens.push({ type: "op", value: aliased, start, end: i });
        continue;
      }

      tokens.push({ type: "ident", value: aliased, start, end: i });
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) {
      const start = i;
      while (i < source.length && isDigit(source[i]!)) i += 1;
      if (source[i] === ".") {
        i += 1;
        while (i < source.length && isDigit(source[i]!)) i += 1;
      }
      if (source[i] === "e" || source[i] === "E") {
        const mark = i;
        i += 1;
        if (source[i] === "+" || source[i] === "-") i += 1;
        if (isDigit(source[i] ?? "")) {
          while (i < source.length && isDigit(source[i]!)) i += 1;
        } else {
          i = mark;
        }
      }
      tokens.push({ type: "number", value: source.slice(start, i), start, end: i });
      continue;
    }

    if (isAlpha(ch)) {
      const start = i;
      while (i < source.length && (isAlpha(source[i]!) || isDigit(source[i]!))) i += 1;
      const name = source.slice(start, i);
      // `quux(2)` is a call to an unknown function, not `q·u·u·x(2)`.
      const called = source[i] === "(";
      const parts =
        called || reserved.has(name) || FUNCTION_NAMES.has(name) || CONSTANTS.has(name)
          ? null
          : splitIdentifier(name);
      if (parts) {
        for (const part of parts) {
          tokens.push({ type: "ident", value: part, start, end: i });
        }
        continue;
      }
      tokens.push({ type: "ident", value: name, start, end: i });
      continue;
    }

    const two = source.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "!=" || two === "==") {
      tokens.push({ type: "relop", value: two === "==" ? "=" : two, start: i, end: i + 2 });
      i += 2;
      continue;
    }

    if (source[i] === "<" || source[i] === ">") {
      tokens.push({ type: "relop", value: source[i]!, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    if (OPERATORS.has(ch)) {
      const type: TokenType =
        ch === "("
          ? "lparen"
          : ch === ")"
            ? "rparen"
            : ch === "["
              ? "lbracket"
              : ch === "]"
                ? "rbracket"
                : ch === "{"
                  ? "lbrace"
                  : ch === "}"
                    ? "rbrace"
                    : ch === ","
                      ? "comma"
                      : ch === "|"
                        ? "bar"
                        : ch === "="
                          ? "relop"
                          : "op";
      tokens.push({ type, value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    tokens.push({ type: "op", value: ch, start: i, end: i + 1 });
    i += 1;
  }

  tokens.push({ type: "eof", value: "", start: i, end: i });
  return tokens;
}

function skipSpaces(source: string, i: number): number {
  while (i < source.length && isSpace(source[i]!)) i += 1;
  return i;
}