import { parse, parseGraphSource, parseFunctionSignature, splitRelation } from "../src/math/parser.ts";
import { compile, compileField, type UserFunction } from "../src/math/compile.ts";
import { toLatex } from "../src/math/latex.ts";
import { walk } from "../src/math/ast.ts";
import { reseedRandom } from "../src/math/functions.ts";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = typeof actual === "number" ? actual : JSON.stringify(actual);
  const e = typeof expected === "number" ? expected : JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.log(`FAIL  ${label}\n        got ${a}\n        want ${e}`);
  } else {
    console.log(`ok    ${label} = ${a}`);
  }
}

function evalOk(source: string, scope: Record<string, number> = {}, degrees = false): number {
  const reserved = new Set(["x", "y", "t", ...Object.keys(scope)]);
  const node = parse(source, { reserved });
  const declared = new Set(["x", "y", "t", ...Object.keys(scope)]);
  const { fn } = compile(node, { declared, degrees });
  const value = fn(scope);
  if (typeof value !== "number") throw new Error(`${source} produced a list`);
  return value;
}

function evalList(source: string, scope: Record<string, number> = {}): number[] {
  const reserved = new Set(["x", "y", "t", ...Object.keys(scope)]);
  const node = parse(source, { reserved });
  const declared = new Set(["x", "y", "t", ...Object.keys(scope)]);
  const { fn } = compile(node, { declared });
  const value = fn(scope);
  if (!Array.isArray(value)) throw new Error(`${source} did not produce a list`);
  return value;
}

console.log("--- parsing and evaluation ---");
check("2 + 3 * 4", evalOk("2+3*4"), 14);
check("2x at x=5 (implicit mult)", evalOk("2x", { x: 5 }), 10);
check("xy at x=3,y=4", evalOk("xy", { x: 3, y: 4 }), 12);
check("(x+1)(x-1) at x=3", evalOk("(x+1)(x-1)", { x: 3 }), 8);
check("3sin(x) at x=0", evalOk("3sin(x)", { x: 0 }), 0);
check("-x^2 at x=3", evalOk("-x^2", { x: 3 }), -9);
check("2^-1", evalOk("2^-1"), 0.5);
check("2^3^2 (right assoc)", evalOk("2^3^2"), 512);
check("1/2x (binds as 1/(2x))", evalOk("1/2x", { x: 3 }), 1 / 6);
check("3|x| at x=-4", evalOk("3|x|", { x: -4 }), 12);
check("|x-2| at x=7", evalOk("|x-2|", { x: 7 }), 5);
check("sqrt(16)", evalOk("sqrt(16)"), 4);
check("nthroot(3, 27)", evalOk("nthroot(3, 27)"), 3);
check("nthroot(3, -8)", evalOk("nthroot(3, -8)"), -2);
check("\\frac{1}{2}", evalOk("\\frac{1}{2}"), 0.5);
check("\\sqrt{2}^2", Math.round(evalOk("\\sqrt{2}^2") * 1e10) / 1e10, 2);
check("pi", evalOk("pi"), Math.PI);
check("tau/2", evalOk("tau/2"), Math.PI);
check("mod(-1, 3) -> positive remainder", evalOk("mod(-1, 3)"), 2);
check("rem(-1, 3) -> js remainder", evalOk("rem(-1, 3)"), -1);
check("-7 % 3 infix", evalOk("-7 % 3"), -1);
check("5!", evalOk("5!"), 120);
check("nCr(5, 2)", evalOk("nCr(5, 2)"), 10);
check("gcd(12, 18)", evalOk("gcd(12, 18)"), 6);
check("sum([1,2,3])", evalOk("sum([1,2,3])"), 6);
check("[1,2,3][2]", evalOk("[1,2,3][2]"), 2);
check("[1,2,3][-1]", evalOk("[1,2,3][-1]"), 3);
check("mean([2,4,6])", evalOk("mean([2,4,6])"), 4);
check("median([3,1,2])", evalOk("median([3,1,2])"), 2);
check("range(1,5) length", evalList("range(1,5)").length, 4);
check("range(1,5) values", evalList("range(1,5)").join(","), "1,2,3,4");
check("linspace(0,1,3)", evalList("linspace(0,1,3)").join(","), "0,0.5,1");
check("stddev([2,4,4,4,5,5,7,9])", Math.round(evalOk("stddev([2,4,4,4,5,5,7,9])") * 1e10) / 1e10, 2.1380899353);
check("max(1, 9, 3)", evalOk("max(1, 9, 3)"), 9);
check("floor(-1.5)", evalOk("floor(-1.5)"), -2);
check("round(2.567, 2)", evalOk("round(2.567, 2)"), 2.57);

console.log("\n--- degrees ---");
check("sin(90) in degrees", evalOk("sin(90)", {}, true), 1);
check("asin(1) in degrees", evalOk("asin(1)", {}, true), 90);
check("cos(180) in degrees", evalOk("cos(180)", {}, true), -1);

console.log("\n--- random is stable ---");
reseedRandom(42);
const r1 = evalOk("rand()");
reseedRandom(42);
check("rand() repeats after reseed", evalOk("rand()"), r1);

console.log("\n--- piecewise ---");
const piece = parseGraphSource("x < 0 { -x }, x >= 0 { x^2 }", { reserved: new Set(["x"]) });
check("piecewise branch count", piece.kind === "piecewise" ? piece.branches.length : -1, 2);
if (piece.kind === "piecewise") {
  const { fn } = compile(piece, { declared: new Set(["x"]) });
  check("piecewise at x=-3", fn({ x: -3 }), 3);
  check("piecewise at x=3", fn({ x: 3 }), 9);
}

console.log("\n--- relations and fields ---");
const split = splitRelation("y = x^2 + 1");
check("splitRelation left", split?.left, "y");
check("splitRelation right", split?.right, "x^2 + 1");
check("no relation in x^2", splitRelation("x^2") === null, true);
check("no relation when !=", splitRelation("a != b") === null, true);
const circle = compileField(parseGraphSource("x^2 + y^2 = 9"), { declared: new Set(["x", "y"]) });
check("circle field at (3,0)", circle(3, 0), 0);
check("circle field at (0,0)", circle(0, 0), -9);
const inequality = compileField(parseGraphSource("y > x^2"), { declared: new Set(["x", "y"]) });
check("y > x^2 field at (0,1)", inequality(0, 1) > 0, true);
check("y > x^2 field at (0,-1) < 0", inequality(0, -1) < 0, true);

console.log("\n--- function definitions ---");
check("signature f(x)", parseFunctionSignature("f(x) = x^2")?.name, "f");
check("signature params", parseFunctionSignature("f(x, y) = x + y")?.params.join(","), "x,y");
check("not a signature", parseFunctionSignature("y = x^2") === null, true);

console.log("\n--- user-defined functions ---");
{
  const functions = new Map<string, UserFunction>();
  const body = parse("x^2 + 1", { reserved: new Set(["x"]) });
  const { fn } = compile(body, { declared: new Set(["x"]) });
  functions.set("f", { name: "f", params: ["x"], fn });

  const call = compile(parse("f(3) + f(1)", { reserved: new Set(["f"]) }), {
    declared: new Set(["x", "y"]),
    functions,
  });
  check("f(3) + f(1)", call.fn({}), 12);
  check("f(x) as a curve", compile(parse("f(x)", { reserved: new Set(["f", "x"]) }), {
    declared: new Set(["x", "y"]),
    functions,
  }).fn({ x: 4 }), 17);

  try {
    compile(parse("f(1, 2)", { reserved: new Set(["f"]) }), {
      declared: new Set(["x", "y"]),
      functions,
    });
    failures += 1;
    console.log("FAIL  arity check for user functions");
  } catch (error) {
    console.log(`ok    arity check -> ${(error as Error).message}`);
  }
}

console.log("\n--- latex ---");
const LATEX_SAMPLES = [
  "x^2 + 1",
  "2x",
  "1/2",
  "x^2/4",
  "sqrt(x)",
  "sin(x)",
  "|x|",
  "[1, 2, 3]",
  "y = x^2",
  "x < 0 { -x }, x >= 0 { x }",
  "a_1 + a_2",
  "3x^2 - 2x + 1",
  "\\frac{1}{2}",
  "2^{3^2}",
  "(x+1)(x-1)",
  "x/2 + 1",
  "floor(x) + ceil(x)",
  "atan2(y, x)",
  "log(x, 2)",
  "y >= x^2 and x >= 0",
  "x != 0",
  "e^x",
  "-x + 1",
  "1/(x+1)",
  "(x+1)/2",
  "sum([1,2])",
  "f(x) = x^2",
  "x^2 < y <= 4",
  "round(x, 2)",
  "nthroot(3, x)",
  "theta",
];

for (const source of LATEX_SAMPLES) {
  let out: string;
  try {
    out = toLatex(parseGraphSource(source, { reserved: new Set(["x", "y", "a_1", "a_2", "f"]) }));
  } catch (error) {
    out = `THREW: ${(error as Error).message}`;
  }
  console.log(`      ${source.padEnd(30)} -> ${out}`);
}

console.log("\n--- katex can render every output ---");
{
  const katex = (await import("katex")).default;
  const reserved = new Set(["x", "y", "a_1", "a_2", "f"]);
  for (const source of LATEX_SAMPLES) {
    let latex: string;
    try {
      latex = toLatex(parseGraphSource(source, { reserved }));
    } catch {
      continue;
    }
    try {
      katex.renderToString(latex, { throwOnError: true, output: "html" });
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${source}\n        latex: ${latex}\n        katex: ${(error as Error).message}`);
    }
  }
  console.log(`      ${LATEX_SAMPLES.length} samples checked`);
}

console.log("\n--- errors ---");
function expectError(label: string, source: string, needle: string): void {
  try {
    evalOk(source, { a: 1 });
    failures += 1;
    console.log(`FAIL  ${label}: expected an error`);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes(needle)) console.log(`ok    ${label} -> ${message}`);
    else {
      failures += 1;
      console.log(`FAIL  ${label}: got "${message}", wanted "${needle}"`);
    }
  }
}
expectError("unknown variable", "b + 1", "not defined");
expectError("function without call", "sin", "function");
expectError("unknown function", "quux(2)", "not a function");
expectError("bad arity", "sin(1, 2)", "takes 1");
expectError("unmatched paren", "(1 + 2", "expected");
expectError("stray close paren", "1 + 2)", "Unmatched");
expectError("empty", "   ", "Enter an expression");

console.log("\n--- walk sanity ---");
const tree = parse("f(x) = sin(x) + g(x^2)");
const kinds: string[] = [];
walk(tree, (node) => kinds.push(node.kind));
check("walk visits call nodes", kinds.filter((k) => k === "call").length, 3);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);