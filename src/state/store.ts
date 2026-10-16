import {
  DEFAULT_SETTINGS,
  DEFAULT_VIEWPORT,
  colorAt,
  nextId,
  type Document,
  type ExpressionItem,
  type Item,
  type ItemKind,
  type PointItem,
  type Settings,
  type SliderItem,
  type TableItem,
  type Viewport,
} from "../document/types";

export interface AppState {
  doc: Document;
  /** Row whose label is highlighted on the graph. */
  focusedId: string | null;
  /** Rows the user has selected; the first one is the one being edited. */
  selectedIds: string[];
  past: Document[];
  future: Document[];
  /** Open overlays, if any. */
  panel: "none" | "settings" | "shortcuts" | "functions" | "share";
}

const MAX_HISTORY = 120;

export function emptyDocument(): Document {
  return {
    items: [],
    viewport: { ...DEFAULT_VIEWPORT },
    settings: { ...DEFAULT_SETTINGS },
    seed: 1,
  };
}

export function initialState(doc: Document = emptyDocument()): AppState {
  return { doc, focusedId: null, selectedIds: [], past: [], future: [], panel: "none" };
}

export type Action =
  | { type: "load"; doc: Document }
  | { type: "addItem"; item: Item; afterId?: string }
  | { type: "removeItem"; id: string }
  | { type: "duplicateItem"; id: string }
  | { type: "moveItem"; id: string; delta: number }
  /** `transient` collapses a burst of edits into a single undo step. */
  | { type: "setSource"; id: string; source: string; transient?: boolean }
  | { type: "setField"; id: string; field: string; value: string | number | boolean }
  | { type: "setColor"; id: string; color: string }
  | { type: "toggleHidden"; id: string }
  | { type: "setSliderValue"; id: string; value: number }
  | { type: "setPoint"; id: string; x: number; y: number }
  | { type: "select"; ids: string[]; focus?: string | null }
  | { type: "focus"; id: string | null }
  | { type: "setViewport"; viewport: Viewport }
  | { type: "resetViewport" }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "setPanel"; panel: AppState["panel"] }
  | { type: "undo" }
  | { type: "redo" };

/** Fields whose changes should not push a history entry per keystroke. */
const TRANSIENT_FIELDS = new Set(["value", "hidden"]);

function withHistory(state: AppState, doc: Document, transient = false): AppState {
  if (transient) return { ...state, doc };
  return {
    ...state,
    doc,
    past: [...state.past, state.doc].slice(-MAX_HISTORY),
    future: [],
  };
}

function updateItem(doc: Document, id: string, change: (item: Item) => Item): Document {
  return { ...doc, items: doc.items.map((item) => (item.id === id ? change(item) : item)) };
}

function nextColor(doc: Document): string {
  return colorAt(doc.items.length);
}

export function makeItem(kind: ItemKind, color: string): Item {
  switch (kind) {
    case "slider":
      return {
        id: nextId("s"),
        kind,
        color,
        variable: nextVariableName(),
        min: 0,
        max: 10,
        step: 1,
        value: 5,
      };
    case "point":
      return { id: nextId("p"), kind, color, x: 0, y: 0 };
    case "table":
      return { id: nextId("t"), kind, color, source: "[1, 2, 3], [1, 4, 9]" };
    default:
      return { id: nextId("e"), kind: "expression", color, source: "" };
  }
}

const RESERVED_VARIABLES = new Set(["x", "y", "t", "pi", "e", "tau", "theta"]);

/** Pick an unused single-letter variable so new sliders do not collide. */
function nextVariableName(): string {
  const taken = new Set<string>(RESERVED_VARIABLES);
  for (const name of ["a", "b", "c", "d", "n", "k", "m", "p", "q", "r", "s", "u", "v", "w"]) {
    if (!taken.has(name)) return name;
  }
  return "a";
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "load":
      return initialState(action.doc);

    case "addItem": {
      const item = action.item;
      const items = [...state.doc.items];
      const at = action.afterId ? items.findIndex((existing) => existing.id === action.afterId) : items.length - 1;
      items.splice(at + 1, 0, item);
      return {
        ...withHistory(state, { ...state.doc, items, seed: state.doc.seed + 1 }),
        selectedIds: [item.id],
        focusedId: item.id,
      };
    }

    case "removeItem": {
      const items = state.doc.items.filter((item) => item.id !== action.id);
      const selected = state.selectedIds.filter((id) => id !== action.id);
      const nextFocus = selected[0] ?? items[items.length - 1]?.id ?? null;
      return {
        ...withHistory(state, { ...state.doc, items, seed: state.doc.seed + 1 }),
        selectedIds: selected,
        focusedId: nextFocus,
      };
    }

    case "duplicateItem": {
      const index = state.doc.items.findIndex((item) => item.id === action.id);
      if (index === -1) return state;
      const original = state.doc.items[index]!;
      const copy = { ...original, id: nextId(original.kind[0]!) } as Item;
      const items = [...state.doc.items];
      items.splice(index + 1, 0, copy);
      return {
        ...withHistory(state, { ...state.doc, items, seed: state.doc.seed + 1 }),
        selectedIds: [copy.id],
        focusedId: copy.id,
      };
    }

    case "moveItem": {
      const items = [...state.doc.items];
      const from = items.findIndex((item) => item.id === action.id);
      const to = from + action.delta;
      if (from === -1 || to < 0 || to >= items.length) return state;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved!);
      return withHistory(state, { ...state.doc, items, seed: state.doc.seed + 1 });
    }

    case "setSource": {
      const doc = updateItem(state.doc, action.id, (item) =>
        item.kind === "point" ? item : { ...item, source: action.source },
      ) as Document;
      return withHistory(state, doc, action.transient === true);
    }

    case "setField": {
      const doc = updateItem(state.doc, action.id, (item) => ({
        ...item,
        [action.field]: action.value,
      })) as Document;
      return withHistory(state, doc, TRANSIENT_FIELDS.has(action.field));
    }

    case "setColor": {
      const doc = updateItem(state.doc, action.id, (item) => ({ ...item, color: action.color })) as Document;
      return withHistory(state, doc);
    }

    case "toggleHidden": {
      const doc = updateItem(state.doc, action.id, (item) => ({ ...item, hidden: !item.hidden })) as Document;
      return { ...withHistory(state, doc, true), focusedId: state.focusedId };
    }

    case "setSliderValue": {
      const doc = updateItem(state.doc, action.id, (item) =>
        item.kind === "slider" ? { ...item, value: action.value } : item,
      ) as Document;
      return withHistory(state, doc, true);
    }

    case "setPoint": {
      const doc = updateItem(state.doc, action.id, (item) =>
        item.kind === "point" ? { ...item, x: action.x, y: action.y } : item,
      ) as Document;
      return withHistory(state, doc, true);
    }

    case "select":
      return {
        ...state,
        selectedIds: action.ids,
        focusedId: action.focus !== undefined ? action.focus : (action.ids[0] ?? state.focusedId),
      };

    case "focus":
      return { ...state, focusedId: action.id };

    case "setViewport":
      return { ...state, doc: { ...state.doc, viewport: action.viewport } };

    case "resetViewport":
      return {
        ...withHistory(state, { ...state.doc, viewport: { ...DEFAULT_VIEWPORT } }, true),
      };

    case "setSettings":
      return {
        ...withHistory(state, { ...state.doc, settings: { ...state.doc.settings, ...action.settings } }, true),
      };

    case "setPanel":
      return { ...state, panel: action.panel };

    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future].slice(0, MAX_HISTORY),
      };
    }

    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        doc: next,
        past: [...state.past, state.doc].slice(-MAX_HISTORY),
        future: state.future.slice(1),
      };
    }
  }
}

/* ------------------------------------------------------------- convenience */

export function addExpression(state: AppState, afterId?: string): AppState {
  const color = nextColor(state.doc);
  return reducer(state, { type: "addItem", item: makeItem("expression", color), afterId });
}

export function addItemOfKind(state: AppState, kind: ItemKind, afterId?: string): AppState {
  return reducer(state, { type: "addItem", item: makeItem(kind, nextColor(state.doc)), afterId });
}

export { nextColor };

/** Slider items with a shared helper for the document layer. */
export function slidersOf(doc: Document): SliderItem[] {
  return doc.items.filter((item): item is SliderItem => item.kind === "slider");
}

export function pointsOf(doc: Document): PointItem[] {
  return doc.items.filter((item): item is PointItem => item.kind === "point");
}

export function tablesOf(doc: Document): TableItem[] {
  return doc.items.filter((item): item is TableItem => item.kind === "table");
}

export function expressionsOf(doc: Document): ExpressionItem[] {
  return doc.items.filter((item): item is ExpressionItem => item.kind === "expression");
}