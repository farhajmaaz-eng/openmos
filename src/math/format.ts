/**
 * Number presentation. The graph, the table, the coordinate readout and the
 * LaTeX printer all need to agree on how a value looks, so formatting lives in
 * one place.
 */

/** Round to `places` decimals without the string round-trip artefacts. */
export function roundTo(value: number, places: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/**
 * A readable decimal for a finite number: no trailing zeros, no `1e-7` noise
 * for values that are simply small, and exponent notation only when it is the
 * shorter option.
 */
export function formatNumber(value: number, places = 6): string {
  if (Number.isNaN(value)) return "undefined";
  if (value === Infinity) return "∞";
  if (value === -Infinity) return "-∞";

  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    const exponential = value.toExponential(Math.max(0, places - 1));
    const [mantissa, exponent] = exponential.split("e");
    const power = exponent!.replace(/^\+/, "");
    return `${mantissa}\u00d710${supDigits(power)}`;
  }

  return trimZeros(roundTo(value, places).toFixed(places));
}

function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

/** Digits of an exponent as superscript unicode, so 1e-7 reads as 10⁻⁷. */
function supDigits(digits: string): string {
  const superscripts: Record<string, string> = {
    "0": "\u2070",
    "1": "\u00b9",
    "2": "\u00b2",
    "3": "\u00b3",
    "4": "\u2074",
    "5": "\u2075",
    "6": "\u2076",
    "7": "\u2077",
    "8": "\u2078",
    "9": "\u2079",
    "-": "\u207b",
  };
  return [...digits].map((digit) => superscripts[digit] ?? digit).join("");
}

/** Compact form for axis ticks and coordinate readouts. */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";

  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) {
    const exponential = value.toExponential(2);
    const [mantissa, exponent] = exponential.split("e");
    return `${mantissa}\u00d710${supDigits(exponent!.replace(/^[+-]/, ""))}`;
  }

  const decimals = abs < 1 ? 4 : abs < 10 ? 3 : abs < 100 ? 2 : abs < 1000 ? 1 : 0;
  return trimZeros(roundTo(value, decimals).toFixed(decimals));
}

/** How many decimals the current zoom level justifies. */
export function decimalsForScale(unitsPerPixel: number): number {
  if (unitsPerPixel >= 1) return 0;
  if (unitsPerPixel >= 0.1) return 1;
  if (unitsPerPixel >= 0.01) return 2;
  if (unitsPerPixel >= 0.001) return 3;
  if (unitsPerPixel >= 0.0001) return 4;
  return 5;
}