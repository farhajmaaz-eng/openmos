import { fail } from "./errors";

export type Value = number | number[];

/** Randomness is seeded so a re-render never reshuffles the same expression. */
let randomSeed = 0x2f6e2b1 >>> 0;

export function reseedRandom(seed: number): void {
  randomSeed = (seed >>> 0) || 1;
}

function nextRandom(): number {
  // xorshift32 — fast, good enough for visualisation jitter.
  let x = randomSeed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  randomSeed = x >>> 0;
  return randomSeed / 0x100000000;
}

export const isList = (value: Value): value is number[] => Array.isArray(value);

function needList(value: Value, name: string): number[] {
  if (!isList(value)) fail(`${name}() needs a list, such as [1, 2, 3]`);
  return value;
}

function flatten(args: Value[]): number[] {
  const out: number[] = [];
  for (const arg of args) {
    if (isList(arg)) out.push(...arg);
    else out.push(arg);
  }
  return out;
}

/** `true` when any argument is a list, which decides list vs. scalar semantics. */
function anyList(args: Value[]): boolean {
  return args.some(isList);
}

const factorialCache = new Map<number, number>();

export function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity;
  const cached = factorialCache.get(n);
  if (cached !== undefined) return cached;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  factorialCache.set(n, result);
  return result;
}

const gcd2 = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
};

/** Sorted, duplicate-free list used by `union`, `unique` and friends. */
function asSet(args: Value[]): number[] {
  const values = new Set<number>();
  for (const arg of flatten(args)) values.add(arg);
  return [...values].sort((a, b) => a - b);
}

export interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  /** Angles are interpreted in degrees when the document asks for it. */
  angle?: boolean;
  /** Reduces a scalar argument set to a single scalar (handles lists). */
  fold?: (args: number[]) => number;
  call: (args: Value[], angleMode: boolean) => Value;
  /** Short label shown in the function palette. */
  summary?: string;
}

const num = (value: Value): number => (isList(value) ? value[0] ?? NaN : value);

/**
 * Fold a call's arguments into one number. Used by functions such as `min`
 * that take a variable number of scalars; the list-aware work happens in the
 * call path instead.
 */
const reducer =
  (fn: (values: number[]) => number): FunctionSpec["fold"] =>
  (args) =>
    fn(args);

/** Default fold: elementwise over lists, otherwise the scalar path. */
function elementwise(args: Value[], scalar: (values: number[]) => number): Value {
  if (!anyList(args)) return scalar(args.map((arg) => (isList(arg) ? (arg[0] ?? NaN) : arg)));
  const length = Math.max(...args.map((arg) => (isList(arg) ? arg.length : 1)));
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const row = args.map((arg) => (isList(arg) ? (arg[i] ?? NaN) : arg));
    out.push(scalar(row));
  }
  return out;
}

function sumSpec(): FunctionSpec {
  return {
    minArgs: 1,
    maxArgs: Infinity,
    call: (args) => flatten(args).reduce((a, b) => a + b, 0),
    fold: reducer((values) => values.reduce((a, b) => a + b, 0)),
    summary: "sum([1, 2, 3])",
  };
}

export const FUNCTIONS = new Map<string, FunctionSpec>();

function define(name: string, spec: FunctionSpec): void {
  FUNCTIONS.set(name, spec);
}

/* ------------------------------------------------------------------ trigonometry */

const toRadians = (v: number, degrees: boolean) => (degrees ? (v * Math.PI) / 180 : v);
const fromRadians = (v: number, degrees: boolean) => (degrees ? (v * 180) / Math.PI : v);

define("sin", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => Math.sin(toRadians(v[0]!, deg))) });
define("cos", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => Math.cos(toRadians(v[0]!, deg))) });
define("tan", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => Math.tan(toRadians(v[0]!, deg))) });

// Cot/sec/csc are written as reciprocals so a pole still shows as a hole.
define("cot", {
  minArgs: 1,
  maxArgs: 1,
  angle: true,
  call: (a, deg) => elementwise(a, (v) => 1 / Math.tan(toRadians(v[0]!, deg))),
});
define("sec", {
  minArgs: 1,
  maxArgs: 1,
  angle: true,
  call: (a, deg) => elementwise(a, (v) => 1 / Math.cos(toRadians(v[0]!, deg))),
});
define("csc", {
  minArgs: 1,
  maxArgs: 1,
  angle: true,
  call: (a, deg) => elementwise(a, (v) => 1 / Math.sin(toRadians(v[0]!, deg))),
});

define("asin", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => fromRadians(Math.asin(v[0]!), deg)) });
define("acos", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => fromRadians(Math.acos(v[0]!), deg)) });
define("atan", { minArgs: 1, maxArgs: 1, angle: true, call: (a, deg) => elementwise(a, (v) => fromRadians(Math.atan(v[0]!), deg)) });

define("atan2", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => Math.atan2(num(args[0]!), num(args[1]!)),
  fold: reducer((v) => Math.atan2(v[0]!, v[1]!)),
});

define("sinh", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.sinh(v[0]!)) });
define("cosh", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.cosh(v[0]!)) });
define("tanh", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.tanh(v[0]!)) });

/* --------------------------------------------------------------------- radical */

define("sqrt", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.sqrt(v[0]!)) });
define("cbrt", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.cbrt(v[0]!)) });
define("nthroot", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const n = num(args[0]!);
    const x = num(args[1]!);
    if (x < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1) return -Math.pow(-x, 1 / n);
    return Math.pow(x, 1 / n);
  },
});

/* ------------------------------------------------------------------ exp & log */

define("exp", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.exp(v[0]!)) });
define("ln", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.log(v[0]!)) });
define("log", {
  minArgs: 1,
  maxArgs: 2,
  call: (args) =>
    args.length === 1
      ? elementwise(args, (v) => Math.log10(v[0]!))
      : elementwise(args, (v) => Math.log(v[1]!) / Math.log(v[0]!)),
});
define("lg", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.log2(v[0]!)) });

/* --------------------------------------------------------------------- stats */

define("floor", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.floor(v[0]!)) });
define("ceil", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.ceil(v[0]!)) });
define("round", {
  minArgs: 1,
  maxArgs: 2,
  call: (args) => {
    const digits = args.length === 2 ? num(args[1]!) : 0;
    const factor = Math.pow(10, digits);
    return elementwise(args.slice(0, 1), (v) => Math.round(v[0]! * factor) / factor);
  },
});
define("sign", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.sign(v[0]!)) });
define("abs", { minArgs: 1, maxArgs: 1, call: (a) => elementwise(a, (v) => Math.abs(v[0]!)) });

define("min", {
  minArgs: 1,
  maxArgs: Infinity,
  call: (args) => {
    const values = flatten(args);
    return values.length === 0 ? Infinity : Math.min(...values);
  },
  fold: reducer((v) => Math.min(...v)),
});
define("max", {
  minArgs: 1,
  maxArgs: Infinity,
  call: (args) => {
    const values = flatten(args);
    return values.length === 0 ? -Infinity : Math.max(...values);
  },
  fold: reducer((v) => Math.max(...v)),
});
define("mean", {
  minArgs: 1,
  maxArgs: Infinity,
  call: (args) => {
    const values = flatten(args);
    return values.length === 0 ? NaN : values.reduce((a, b) => a + b, 0) / values.length;
  },
});
define("median", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => {
    const values = [...needList(args[0]!, "median")].sort((a, b) => a - b);
    if (values.length === 0) return NaN;
    const mid = values.length >> 1;
    return values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
  },
});
define("stddev", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => {
    const values = needList(args[0]!, "stddev");
    if (values.length < 2) return 0;
    const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + (v - meanValue) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  },
});
define("variance", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => {
    const values = needList(args[0]!, "variance");
    if (values.length < 2) return 0;
    const meanValue = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((acc, v) => acc + (v - meanValue) ** 2, 0) / (values.length - 1);
  },
});

define("gcd", {
  minArgs: 2,
  maxArgs: Infinity,
  call: (args) => flatten(args).reduce((a, b) => gcd2(a, b)),
});
define("lcm", {
  minArgs: 2,
  maxArgs: Infinity,
  call: (args) => flatten(args).reduce((a, b) => Math.abs(a * b) / (gcd2(a, b) || 1)),
});
define("nCr", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const n = num(args[0]!);
    const r = num(args[1]!);
    if (!Number.isInteger(n) || n < 0 || r < 0 || r > n) return NaN;
    let result = 1;
    for (let i = 1; i <= r; i += 1) result = (result * (n - r + i)) / i;
    return Math.round(result);
  },
});
define("nPr", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const n = num(args[0]!);
    const r = num(args[1]!);
    if (!Number.isInteger(n) || n < 0 || r < 0 || r > n) return NaN;
    let result = 1;
    for (let i = 0; i < r; i += 1) result *= n - i;
    return result;
  },
});

define("frac", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const denominator = num(args[1]!);
    return denominator === 0 ? NaN : num(args[0]!) / denominator;
  },
});
define("factorial", { minArgs: 1, maxArgs: 1, call: (a) => factorial(num(a[0]!)) });
define("mod", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const x = num(args[0]!);
    const y = num(args[1]!);
    return y === 0 ? NaN : x - y * Math.floor(x / y);
  },
});
define("rem", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const x = num(args[0]!);
    const y = num(args[1]!);
    return y === 0 ? NaN : x % y;
  },
});

/* --------------------------------------------------------------------- lists */

define("sum", sumSpec());
define("length", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => needList(args[0]!, "length").length,
});
define("sort", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => [...needList(args[0]!, "sort")].sort((a, b) => a - b),
});
define("sortBy", {
  minArgs: 2,
  maxArgs: 2,
  call: (args) => {
    const list = needList(args[0]!, "sortBy");
    const keys = needList(args[1]!, "sortBy");
    return list
      .map((value, index) => ({ value, key: keys[index] ?? NaN }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.value);
  },
});
define("reverse", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => [...needList(args[0]!, "reverse")].reverse(),
});
define("unique", { minArgs: 1, maxArgs: Infinity, call: (args) => asSet(args) });
define("union", { minArgs: 1, maxArgs: Infinity, call: (args) => asSet(args) });
define("shuffle", {
  minArgs: 1,
  maxArgs: 1,
  call: (args) => {
    const values = [...needList(args[0]!, "shuffle")];
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(nextRandom() * (i + 1));
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  },
});

define("range", {
  minArgs: 1,
  maxArgs: 3,
  call: (args) => {
    const [first, second, third] = args.map(num);
    const start = args.length >= 2 ? first! : 1;
    const stop = args.length >= 2 ? second! : first!;
    const step = args.length >= 3 ? third! : 1;
    if (step === 0 || !Number.isFinite(step)) fail("range() step cannot be 0");
    const count = Math.max(0, Math.floor((stop - start) / step + 1e-9));
    if (count > 200000) fail("range() would produce too many values");
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) out.push(start + i * step);
    return out;
  },
});

define("linspace", {
  minArgs: 2,
  maxArgs: 3,
  call: (args) => {
    const start = num(args[0]!);
    const stop = num(args[1]!);
    const count = Math.max(1, Math.floor(args.length >= 3 ? num(args[2]!) : 50));
    if (count > 200000) fail("linspace() would produce too many values");
    if (count === 1) return [start];
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) out.push(start + ((stop - start) * i) / (count - 1));
    return out;
  },
});

/* ------------------------------------------------------------------- random */

define("rand", {
  minArgs: 0,
  maxArgs: 1,
  call: (args) => (args.length === 0 ? nextRandom() : nextRandom() * num(args[0]!)),
});
define("randInt", {
  minArgs: 0,
  maxArgs: 2,
  call: (args) => {
    const low = args.length >= 2 ? num(args[0]!) : 0;
    const high = args.length >= 2 ? num(args[1]!) : num(args[0]! ?? 1);
    if (high < low) fail("randInt() needs high >= low");
    return low + Math.floor(nextRandom() * (high - low + 1));
  },
});
define("randomSeed", {
  minArgs: 0,
  maxArgs: 1,
  call: (args) => {
    if (args.length === 1) reseedRandom(num(args[0]!));
    return randomSeed;
  },
});

/* ---------------------------------------------------------------- constants */

/**
 * Names that resolve without ever being declared. Greek letters and `theta`
 * default to zero so that slider-free polar plots still evaluate; anything the
 * user declares simply shadows these.
 */
export const CONSTANT_VALUES: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  theta: 0,
  alpha: 0,
  beta: 0,
  gamma: 0,
  delta: 0,
  lambda: 0,
  mu: 0,
  sigma: 0,
  omega: 0,
  rho: 0,
  epsilon: Number.EPSILON,
  infty: Infinity,
};