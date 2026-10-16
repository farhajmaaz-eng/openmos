/**
 * Least-squares fits over a table.
 *
 * Everything here works on plain number pairs so it can be tested without a
 * document, and every model reports an R² so the UI can show how much of the
 * spread the fit actually explains.
 */

export type ModelName = "linear" | "quadratic" | "cubic" | "exponential" | "power" | "logarithmic";

export interface FitResult {
  name: ModelName;
  /** LaTeX for the fitted curve, ready for a new expression row. */
  latex: string;
  /** Coefficients in the order `describe` lists them. */
  coefficients: number[];
  r2: number;
  /** How many points took part. */
  count: number;
}

export interface Series {
  x: number[];
  y: number[];
}

export const MODEL_LABELS: Record<ModelName, string> = {
  linear: "Linear",
  quadratic: "Quadratic",
  cubic: "Cubic",
  exponential: "Exponential",
  power: "Power",
  logarithmic: "Logarithmic",
};

/** Solve a small linear system with Gaussian elimination and partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-12) return null;

    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];

    const divisor = augmented[column]![column]!;
    for (let k = column; k <= n; k += 1) augmented[column]![k] = augmented[column]![k]! / divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) {
        augmented[row]![k] = augmented[row]![k]! - factor * augmented[column]![k]!;
      }
    }
  }

  return augmented.map((row) => row[n]!);
}

/** Ordinary least squares for a polynomial basis. */
function polynomialFit(xs: number[], ys: number[], degree: number): number[] | null {
  const terms = degree + 1;
  const matrix: number[][] = Array.from({ length: terms }, () => new Array<number>(terms).fill(0));
  const vector = new Array<number>(terms).fill(0);

  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i]!;
    const y = ys[i]!;
    const powers = new Array<number>(terms);
    let power = 1;
    for (let t = 0; t < terms; t += 1) {
      powers[t] = power;
      power *= x;
    }
    for (let r = 0; r < terms; r += 1) {
      vector[r] = vector[r]! + powers[r]! * y;
      for (let c = 0; c < terms; c += 1) matrix[r]![c] = matrix[r]![c]! + powers[r]! * powers[c]!;
    }
  }

  return solve(matrix, vector);
}

function rSquared(xs: number[], ys: number[], predict: (x: number) => number): number {
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let residual = 0;
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const error = ys[i]! - predict(xs[i]!);
    residual += error * error;
    total += (ys[i]! - mean) ** 2;
  }
  if (total === 0) return residual === 0 ? 1 : 0;
  return 1 - residual / total;
}

const round = (value: number, places = 6): number => {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
};

/**
 * Round to a number of significant figures. Printed fits read better as
 * `0.0667x^3` than as `0.066667x^3`, and the extra digits were noise anyway.
 */
const tidy = (value: number, digits = 4): number => {
  if (!Number.isFinite(value) || value === 0) return 0;
  const magnitude = Math.ceil(Math.log10(Math.abs(value)));
  const places = digits - magnitude;
  return round(value, places);
};

function coefficientLatex(value: number): string {
  const rounded = tidy(value);
  if (rounded === 0) return "0";
  return rounded < 0 ? `-${Math.abs(rounded)}` : `${rounded}`;
}

/**
 * `magnitude * x^power`, with a coefficient of 1 dropped so it reads `x^2`
 * rather than `1x^2`.
 */
function termLatex(magnitude: number, power: number): string {
  const value = tidy(Math.abs(magnitude));
  const sign = magnitude < 0 ? "-" : "";
  if (power === 0) return `${sign}${value}`;
  const factor = value === 1 ? "" : `${value}`;
  return power === 1 ? `${sign}${factor}x` : `${sign}${factor}x^{${power}}`;
}

/**
 * Build the right-hand side of `y = …`.
 *
 * `coefficients` arrive lowest power first, matching the least-squares system,
 * and come out reversed so the highest power leads.
 */
function polynomialLatex(coefficients: number[]): string {
  let body = "";
  for (let power = coefficients.length - 1; power >= 0; power -= 1) {
    const coefficient = coefficients[power]!;
    const magnitude = tidy(Math.abs(coefficient));
    if (magnitude === 0) continue;

    const sign = coefficient < 0 ? "-" : body.length === 0 ? "" : "+";
    body += `${sign}${termLatex(magnitude, power)}`;
  }

  return body.length === 0 ? "0" : body;
}

/** Report coefficients highest power first, which is how they are displayed. */
function descending(coefficients: number[]): number[] {
  return [...coefficients].reverse().map((c) => round(c));
}

export function fitModel(series: Series, model: ModelName): FitResult | null {
  const points = series.x
    .map((x, index) => [x, series.y[index]!] as const)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length < 2) return null;

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);

  switch (model) {
    case "linear":
    case "quadratic":
    case "cubic": {
      const degree = model === "linear" ? 1 : model === "quadratic" ? 2 : 3;
      if (points.length < degree + 1) return null;
      const coefficients = polynomialFit(xs, ys, degree);
      if (!coefficients) return null;

      const predict = (x: number) => coefficients.reduce((acc, c, index) => acc + c * x ** index, 0);
      return {
        name: model,
        latex: `y=${polynomialLatex(coefficients)}`,
        coefficients: descending(coefficients),
        r2: rSquared(xs, ys, predict),
        count: points.length,
      };
    }

    case "exponential": {
      // Fit log(y) = a + b x, then put the exponent back.
      const usable = points.filter(([, y]) => y > 0);
      if (usable.length < 2) return null;
      const logX = usable.map(([x]) => x);
      const logY = usable.map(([, y]) => Math.log(y));
      const coefficients = polynomialFit(logX, logY, 1);
      if (!coefficients) return null;

      const scale = coefficientLatex(Math.exp(coefficients[0]!));
      const rate = coefficients[1]!;
      return {
        name: model,
        latex: `y=${scale}\\cdot e^{${termLatex(rate, 1)}}`,
        coefficients: descending(coefficients),
        r2: rSquared(logX, logY, (x) => coefficients[1]! * x + coefficients[0]!),
        count: usable.length,
      };
    }

    case "power": {
      // Fit log(y) = a + b log(x).
      const usable = points.filter(([x, y]) => x > 0 && y > 0);
      if (usable.length < 2) return null;
      const logX = usable.map(([x]) => Math.log(x));
      const logY = usable.map(([, y]) => Math.log(y));
      const coefficients = polynomialFit(logX, logY, 1);
      if (!coefficients) return null;

      const exponent = tidy(coefficients[1]!);
      const scale = Math.exp(coefficients[0]!);
      return {
        name: model,
        // `a * x^b`, dropping a multiplier or exponent of one.
        latex:
          exponent === 1
            ? `y=${termLatex(scale, 1)}`
            : `y=${tidy(scale) === 1 ? "" : coefficientLatex(scale)}x^{${exponent}}`,
        coefficients: [round(scale), exponent],
        r2: rSquared(logX, logY, (x) => coefficients[1]! * x + coefficients[0]!),
        count: usable.length,
      };
    }

    case "logarithmic": {
      // y = a + b ln(x) is already linear in ln(x), so the fit happens there —
      // but the score is reported against the data the user can see.
      const usable = points.filter(([x]) => x > 0);
      if (usable.length < 2) return null;
      const logX = usable.map(([x]) => Math.log(x));
      const logY = usable.map(([, y]) => y);
      const coefficients = polynomialFit(logX, logY, 1);
      if (!coefficients) return null;

      const slope = coefficients[1]!;
      const predict = (x: number) => slope * Math.log(x) + coefficients[0]!;
      return {
        name: model,
        latex: `y=${
          tidy(slope) === 1 ? "" : tidy(slope) === -1 ? "-" : coefficientLatex(slope)
        }\\ln\\left(x\\right)${
          coefficients[0]! < 0 ? `-${coefficientLatex(-coefficients[0]!)}` : `+${coefficientLatex(coefficients[0]!)}`
        }`,
        coefficients: descending(coefficients),
        r2: rSquared(usable.map(([x]) => x), usable.map(([, y]) => y), predict),
        count: usable.length,
      };
    }
  }
}

export const MODEL_ORDER: ModelName[] = [
  "linear",
  "quadratic",
  "cubic",
  "exponential",
  "power",
  "logarithmic",
];