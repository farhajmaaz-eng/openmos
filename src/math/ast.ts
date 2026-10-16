/**
 * Expression tree used by every part of openmos.
 *
 * The shapes here are deliberately small: the parser produces them, the
 * compiler walks them, and the LaTeX printer reads them back out. Anything a
 * user can type should be expressible without extensions.
 */

export type BinaryOp = "+" | "-" | "*" | "/" | "^" | "%";
export type CompareOp = "=" | "<" | "<=" | ">" | ">=" | "!=";
export type UnaryOp = "-" | "+" | "factorial" | "not";

export type Node =
  | NumNode
  | VarNode
  | CallNode
  | BinaryNode
  | UnaryNode
  | GroupNode
  | AbsNode
  | ListNode
  | IndexNode
  | CompareNode
  | LogicNode
  | PiecewiseNode
  | RelationNode;

export interface NumNode {
  kind: "num";
  value: number;
  /** Literal text the user typed, kept so round-tripping never loses digits. */
  raw?: string;
}

export interface VarNode {
  kind: "var";
  name: string;
  /** Byte offset in the source, used to point error markers at the right token. */
  start: number;
}

export interface CallNode {
  kind: "call";
  name: string;
  args: Node[];
  start: number;
}

export interface BinaryNode {
  kind: "bin";
  op: BinaryOp;
  left: Node;
  right: Node;
}

export interface UnaryNode {
  kind: "unary";
  op: UnaryOp;
  arg: Node;
}

export interface GroupNode {
  kind: "group";
  arg: Node;
}

export interface AbsNode {
  kind: "abs";
  arg: Node;
}

export interface ListNode {
  kind: "list";
  items: Node[];
}

export interface IndexNode {
  kind: "index";
  target: Node;
  index: Node;
}

export interface CompareNode {
  kind: "compare";
  op: CompareOp;
  left: Node;
  right: Node;
}

export interface LogicNode {
  kind: "logic";
  op: "and" | "or";
  left: Node;
  right: Node;
}

export interface PiecewiseBranch {
  value: Node;
  condition: Node | null;
}

export interface PiecewiseNode {
  kind: "piecewise";
  branches: PiecewiseBranch[];
}

/** `a = b` where both sides are general expressions (implicit curves). */
export interface RelationNode {
  kind: "relation";
  left: Node;
  right: Node;
}

export function isNum(node: Node): node is NumNode {
  return node.kind === "num";
}

/** Left-most leaf of a chain, used to decide how far an expression reaches. */
export function leftmost(node: Node): Node {
  let current = node;
  for (;;) {
    switch (current.kind) {
      case "bin":
      case "compare":
      case "logic":
      case "relation":
        current = current.left;
        break;
      case "unary":
        current = current.arg;
        break;
      case "group":
      case "abs":
        current = current.arg;
        break;
      default:
        return current;
    }
  }
}

export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  switch (node.kind) {
    case "bin":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case "unary":
      walk(node.arg, visit);
      break;
    case "group":
    case "abs":
      walk(node.arg, visit);
      break;
    case "call":
      for (const arg of node.args) walk(arg, visit);
      break;
    case "list":
      for (const item of node.items) walk(item, visit);
      break;
    case "index":
      walk(node.target, visit);
      walk(node.index, visit);
      break;
    case "compare":
    case "logic":
    case "relation":
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case "piecewise":
      for (const branch of node.branches) {
        walk(branch.value, visit);
        if (branch.condition) walk(branch.condition, visit);
      }
      break;
  }
}

export function collectVars(node: Node, into: Set<string> = new Set()): Set<string> {
  walk(node, (n) => {
    if (n.kind === "var") into.add(n.name);
  });
  return into;
}