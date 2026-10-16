import { fail } from "./errors";
import { tokenize, type Token } from "./tokenize";
import type { BinaryOp, CompareOp, Node, PiecewiseBranch, UnaryOp } from "./ast";

/**
 * Precedence table; higher binds tighter. `and` / `or` are listed here even
 * though they arrive as identifiers, so they take part in the same loop.
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  "=": 3,
  "<": 3,
  "<=": 3,
  ">": 3,
  ">=": 3,
  "!=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
  "^": 6,
};

const RIGHT_ASSOCIATIVE = new Set(["^"]);

const COMPARE_TOKENS: Record<string, CompareOp> = {
  "=": "=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "!=": "!=",
};

/** Functions that accept `{...}` instead of `(...)`. */
const BRACE_ARGS = new Map<string, number>([
  ["frac", 2],
  ["dfrac", 2],
  ["tfrac", 2],
  ["nthroot", 2],
  ["sqrt", 1],
  ["cbrt", 1],
  ["abs", 1],
]);

const MAX_IMPLICIT_CHAIN = 64;

class Parser {
  private readonly tokens: Token[];
  private index = 0;
  /**
   * How many `|…|` groups are currently open. Inside one, a `|` closes the
   * group instead of starting a multiplication — that is what makes
   * `|x| + |y|` and `3|x|` both read the way people expect.
   */
  private absDepth = 0;

  constructor(source: string, reserved: ReadonlySet<string>) {
    this.tokens = tokenize(source, reserved);
  }

  /* ----------------------------------------------------------------- cursor */

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  advance(): Token {
    const token = this.peek();
    if (token.type !== "eof") this.index += 1;
    return token;
  }

  atEnd(): boolean {
    return this.peek().type === "eof";
  }

  /* ---------------------------------------------------------------- grammar */

  parseProgram(): Node {
    const node = this.parseTernary();
    this.assertExhausted();
    return node;
  }

  assertExhausted(): void {
    if (this.atEnd()) return;
    const token = this.peek();
    if (token.type === "rparen") fail("Unmatched `)`", token);
    if (token.type === "rbrace") fail("Unmatched `}`", token);
    if (token.type === "rbracket") fail("Unmatched `]`", token);
    if (token.type === "comma") fail("Unexpected `,`", token);
    fail(`Unexpected \`${token.value}\``, token);
  }

  private parseTernary(): Node {
    return this.parseBinary(1, 0);
  }

  private parseBinary(minPrecedence: number, implicitCount: number): Node {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      let op: string | null = null;

      if (token.type === "ident" && (token.value === "and" || token.value === "or")) {
        op = token.value;
      } else if (token.type === "relop") {
        op = token.value;
      } else if (token.type === "op" && BINARY_PRECEDENCE[token.value] !== undefined) {
        op = token.value;
      } else if (token.type === "bar" && this.absDepth > 0) {
        // A `|` inside `|…|` closes the group rather than multiplying.
        break;
      } else if (this.startsImplicitProduct()) {
        if (implicitCount >= MAX_IMPLICIT_CHAIN) {
          fail("That chain of adjacent factors is too long", token);
        }
        // No operator token to consume — adjacency *is* the operator.
        left = { kind: "bin", op: "*", left, right: this.parseBinary(BINARY_PRECEDENCE["*"]!, implicitCount + 1) };
        continue;
      } else {
        break;
      }

      const precedence = BINARY_PRECEDENCE[op]!;
      if (precedence < minPrecedence) break;

      this.advance();
      const nextMin = RIGHT_ASSOCIATIVE.has(op) ? precedence : precedence + 1;
      const right = this.parseBinary(nextMin, implicitCount);

      if (op === "and" || op === "or") {
        left = { kind: "logic", op, left, right };
      } else if (op === "=") {
        left = { kind: "relation", left, right };
      } else if (COMPARE_TOKENS[op] !== undefined) {
        left = { kind: "compare", op: COMPARE_TOKENS[op]!, left, right };
      } else {
        left = { kind: "bin", op: op as BinaryOp, left, right };
      }
    }

    return left;
  }

  /** `a b` means `a * b`, which covers `2x`, `xy`, `(x+1)(x-1)` and `3|x|`. */
  private startsImplicitProduct(): boolean {
    switch (this.peek().type) {
      case "number":
      case "ident":
      case "lparen":
      case "bar":
        return true;
      default:
        // `{` is excluded on purpose: it opens piecewise branches and the
        // brace-argument forms of functions, never an implicit product.
        return false;
    }
  }

  private parseUnary(): Node {
    const token = this.peek();

    if (token.type === "op" && (token.value === "-" || token.value === "+")) {
      this.advance();
      const arg = this.parseBinary(BINARY_PRECEDENCE["^"]!, 0);
      if (token.value === "+") return arg;
      if (arg.kind === "num") return { kind: "num", value: -arg.value };
      return { kind: "unary", op: "-" as UnaryOp, arg };
    }

    if (token.type === "op" && token.value === "!") {
      this.advance();
      return { kind: "unary", op: "not", arg: this.parseUnary() };
    }

    if (token.type === "ident" && (token.value === "and" || token.value === "or")) {
      fail(`\`${token.value}\` needs an operand on both sides`, token);
    }

    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();

    for (;;) {
      if (this.peek().type === "lbracket") {
        this.advance();
        const index = this.parseTernary();
        this.expect("rbracket", "`]`");
        node = { kind: "index", target: node, index };
        continue;
      }
      if (this.peek().type === "op" && this.peek().value === "!") {
        this.advance();
        node = { kind: "unary", op: "factorial", arg: node };
        continue;
      }
      break;
    }

    return node;
  }

  private parsePrimary(): Node {
    const token = this.advance();

    switch (token.type) {
      case "number": {
        const value = Number(token.value);
        if (Number.isNaN(value)) fail(`\`${token.value}\` is not a number`, token);
        return { kind: "num", value };
      }

      case "lparen": {
        const inner = this.parseTernary();
        this.expect("rparen", "`)`");
        return { kind: "group", arg: inner };
      }

      case "lbrace": {
        const inner = this.parseTernary();
        this.expect("rbrace", "`}`");
        return { kind: "group", arg: inner };
      }

      case "bar": {
        this.absDepth += 1;
        const inner = this.parseTernary();
        if (this.peek().type !== "bar") {
          fail("Expected a closing `|`", this.peek());
        }
        this.absDepth -= 1;
        this.advance();
        return { kind: "abs", arg: inner };
      }

      case "lbracket": {
        const items: Node[] = [];
        if (this.peek().type !== "rbracket") {
          for (;;) {
            items.push(this.parseTernary());
            if (this.peek().type !== "comma") break;
            this.advance();
          }
        }
        this.expect("rbracket", "`]`");
        return { kind: "list", items };
      }

      case "ident":
        return this.parseIdentifier(token);

      case "comma":
        fail("Unexpected `,`", token);

      case "rparen":
      case "rbrace":
      case "rbracket":
        fail(`Unmatched \`${token.value}\``, token);

      case "eof":
        fail("Expression is incomplete", token);

      default:
        fail(`Unexpected \`${token.value}\``, token);
    }
  }

  private parseIdentifier(token: Token): Node {
    const name = token.value;

    if (this.peek().type === "lbrace" && BRACE_ARGS.has(name)) {
      const args = this.parseBraceArguments(BRACE_ARGS.get(name)!, token);
      const callee = name === "dfrac" || name === "tfrac" ? "frac" : name;
      return { kind: "call", name: callee, args, start: token.start };
    }

    if (this.peek().type === "lparen") {
      this.advance();
      const args: Node[] = [];
      if (this.peek().type !== "rparen") {
        for (;;) {
          args.push(this.parseTernary());
          if (this.peek().type !== "comma") break;
          this.advance();
        }
      }
      this.expect("rparen", "`)`");
      return { kind: "call", name, args, start: token.start };
    }

    return { kind: "var", name, start: token.start };
  }

  private parseBraceArguments(count: number, token: Token): Node[] {
    const args: Node[] = [];
    for (let i = 0; i < count; i += 1) {
      if (this.peek().type !== "lbrace") {
        fail(`\`${token.value}\` needs {braces} around its arguments`, this.peek());
      }
      this.advance();
      args.push(this.parseTernary());
      this.expect("rbrace", "`}`");
    }
    return args;
  }

  private expect(type: Token["type"], label: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      fail(
        token.type === "eof"
          ? `Expression is incomplete — expected ${label}`
          : `Expected ${label} but found \`${token.value}\``,
        token,
      );
    }
    return this.advance();
  }

  /* -------------------------------------------------------------- piecewise */

  /**
   * `x < 0 { -x }, x >= 0 { x }`
   *
   * A branch is a condition followed immediately by a brace group holding the
   * value. A branch without a brace group is a plain expression, which keeps
   * ordinary single-expression lines on the fast path.
   */
  parsePiecewiseBranches(): PiecewiseBranch[] {
    const branches: PiecewiseBranch[] = [];

    for (;;) {
      const condition = this.parseTernary();

      if (this.peek().type === "lbrace") {
        this.advance();
        const value = this.parseTernary();
        this.expect("rbrace", "`}`");
        branches.push({ value, condition });
      } else {
        branches.push({ value: condition, condition: null });
      }

      if (this.peek().type !== "comma") break;
      this.advance();
      if (this.atEnd()) fail("Expected another branch after `,`", this.peek());
    }

    return branches;
  }
}

/* -------------------------------------------------------------------- API */

/** Names the document already binds, so `n` stays one variable and not `n`. */
export interface ParseOptions {
  reserved?: ReadonlySet<string>;
}

export function parse(source: string, options: ParseOptions = {}): Node {
  const trimmed = source.trim();
  if (trimmed.length === 0) fail("Enter an expression");
  return new Parser(trimmed, options.reserved ?? EMPTY).parseProgram();
}

/**
 * Parse a graph line. On top of ordinary expressions this understands the
 * piecewise shorthand and implicit relations such as `x^2 + y^2 = 9`.
 */
export function parseGraphSource(source: string, options: ParseOptions = {}): Node {
  const trimmed = source.trim();
  if (trimmed.length === 0) fail("Enter an expression");

  const parser = new Parser(trimmed, options.reserved ?? EMPTY);
  const branches = parser.parsePiecewiseBranches();
  parser.assertExhausted();

  if (branches.length === 1 && branches[0]!.condition === null) return branches[0]!.value;
  return { kind: "piecewise", branches };
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Inspect the left half of a function definition, e.g. `f(x)` in
 * `f(x) = x^2 + 1`. Returns null when the line is not a definition.
 */
export function parseFunctionSignature(source: string): { name: string; params: string[] } | null {
  const trimmed = source.trim();
  const match = /^([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*=(?!=)/.exec(trimmed);
  if (!match) return null;

  const params = match[2]!
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (params.length === 0) return null;
  for (const param of params) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(param)) return null;
  }

  return { name: match[1]!, params };
}

/**
 * Split `a = b` into its halves, or return null if the line has no top-level
 * equality. Used to decide between an equation, a definition and an implicit
 * curve.
 */
export function splitRelation(source: string): { left: string; right: string } | null {
  let depth = 0;
  const trimmed = source.trim();

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === "(" || ch === "[" || ch === "{" || ch === "|") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === "|") depth -= 1;
    else if (depth === 0 && ch === "=" && trimmed[i + 1] !== "=") {
      const previous = trimmed[i - 1];
      const next = trimmed[i + 1];
      if (previous === "!" || previous === "<" || previous === ">" || next === "=") continue;
      return { left: trimmed.slice(0, i).trim(), right: trimmed.slice(i + 1).trim() };
    }
  }

  return null;
}