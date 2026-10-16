import { DEFAULT_SETTINGS, DEFAULT_VIEWPORT, type Document, type Item } from "../document/types";
import { emptyDocument } from "./store";

/**
 * Persistence.
 *
 * Two channels: localStorage for the working copy, and the URL hash for
 * anything the user explicitly shares. The hash wins when it is present, so a
 * shared link always opens what the sender saw.
 */

const STORAGE_KEY = "openmos.document.v1";
const HASH_KEY = "d=";

const ITEM_KINDS = new Set(["expression", "table", "slider", "point"]);

/* ------------------------------------------------------------------- codec */

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): string {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * A trimmed document: hidden flags and other defaults are dropped so share
 * links stay short. `sanitize` puts back anything that goes missing.
 */
function compact(doc: Document): Document {
  const items = doc.items.map((item) => {
    const base: Record<string, unknown> = { ...item };
    delete base.hidden;
    return base;
  });
  return sanitize({ items, viewport: doc.viewport, settings: doc.settings, seed: doc.seed });
}

export function encodeDocument(doc: Document): string {
  return toBase64(JSON.stringify(compact(doc)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeDocument(encoded: string): Document {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const json = fromBase64(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return sanitize(JSON.parse(json) as unknown);
}

/**
 * Rebuild a document from untrusted JSON. Anything malformed falls back to the
 * fields we recognise rather than throwing, so a mangled link still opens.
 */
export function sanitize(value: unknown): Document {
  const input = (value ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(input.items) ? input.items : [];

  const items: Item[] = rawItems
    .map((raw) => sanitizeItem(raw))
    .filter((item): item is Item => item !== null);

  return {
    items,
    viewport: sanitizeViewport(input.viewport),
    settings: sanitizeSettings(input.settings),
    seed: typeof input.seed === "number" ? input.seed : items.length + 1,
  };
}

function sanitizeItem(raw: unknown): Item | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const kind = input.kind;
  if (typeof kind !== "string" || !ITEM_KINDS.has(kind)) return null;

  const id = typeof input.id === "string" && input.id.length > 0 ? input.id : `i${Math.random().toString(36).slice(2, 9)}`;
  const color = typeof input.color === "string" && /^#[0-9a-f]{3,8}$/i.test(input.color) ? input.color : "#2f6feb";
  const hidden = input.hidden === true ? { hidden: true } : {};

  const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
  const pair = (value: unknown): [number, number] | undefined =>
    Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
      ? [value[0] as number, value[1] as number]
      : undefined;

  if (kind === "slider") {
    const min = number(input.min, 0);
    const max = number(input.max, 10);
    return {
      id,
      kind,
      color,
      ...hidden,
      variable: /^[A-Za-z][A-Za-z0-9_]*$/.test(text(input.variable, "")) ? (input.variable as string) : "a",
      min,
      max: max > min ? max : min + 1,
      step: Math.max(1e-9, number(input.step, 1)),
      value: number(input.value, min),
    };
  }

  if (kind === "point") {
    return {
      id,
      kind,
      color,
      ...hidden,
      x: number(input.x, 0),
      y: number(input.y, 0),
      label: typeof input.label === "string" ? input.label : undefined,
    };
  }

  if (kind === "table") {
    return { id, kind, color, ...hidden, source: text(input.source, "") };
  }

  const lineStyle = input.lineStyle;
  const fill = input.fill;
  return {
    id,
    kind: "expression",
    color,
    ...hidden,
    source: text(input.source, ""),
    label: typeof input.label === "string" && input.label.length > 0 ? input.label : undefined,
    lineStyle: lineStyle === "dashed" || lineStyle === "dotted" ? lineStyle : undefined,
    fill: fill === "solid" || fill === "semi" || fill === "none" ? fill : undefined,
    domain: pair(input.domain),
    parameterDomain: pair(input.parameterDomain),
    labelHidden: input.labelHidden === true ? true : undefined,
  };
}

function sanitizeViewport(value: unknown): Document["viewport"] {
  const input = (value ?? {}) as Record<string, unknown>;
  const number = (fallback: number) => {
    const candidate = input.scale;
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0
      ? Math.min(1e6, Math.max(1e-9, candidate))
      : fallback;
  };
  return {
    x: typeof input.x === "number" && Number.isFinite(input.x) ? input.x : DEFAULT_VIEWPORT.x,
    y: typeof input.y === "number" && Number.isFinite(input.y) ? input.y : DEFAULT_VIEWPORT.y,
    scale: number(DEFAULT_VIEWPORT.scale),
  };
}

function sanitizeSettings(value: unknown): Document["settings"] {
  const input = (value ?? {}) as Record<string, unknown>;
  const settings = { ...DEFAULT_SETTINGS };
  const flag = (key: keyof typeof settings, fallback: boolean) =>
    typeof input[key] === "boolean" ? (input[key] as boolean) : fallback;

  return {
    theme: input.theme === "light" || input.theme === "dark" || input.theme === "system" ? input.theme : settings.theme,
    grid: input.grid === "solid" || input.grid === "dashed" || input.grid === "dotted" || input.grid === "none"
      ? input.grid
      : settings.grid,
    degrees: flag("degrees", settings.degrees),
    showAxes: flag("showAxes", settings.showAxes),
    showNumbers: flag("showNumbers", settings.showNumbers),
    showOrigin: flag("showOrigin", settings.showOrigin),
    showDragHint: flag("showDragHint", settings.showDragHint),
  };
}

/* ------------------------------------------------------------------- URLs */

export function shareUrl(doc: Document): string {
  if (typeof window === "undefined") return "";
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${HASH_KEY}${encodeDocument(doc)}`;
}

export function readHashDocument(): Document | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith(HASH_KEY)) return null;
  try {
    return decodeDocument(hash.slice(HASH_KEY.length));
  } catch {
    return null;
  }
}

export function clearHash(): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (hash.startsWith(`#${HASH_KEY}`)) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

/* -------------------------------------------------------------- local store */

export function loadStored(): Document | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStored(doc: Document): void {
  if (typeof localStorage === "undefined") return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compact(doc)));
    } catch {
      // A full or unavailable store is not worth interrupting the session.
    }
  }, 400);
}

/**
 * The document a fresh visit should show. A shared link always wins, then the
 * last session, and otherwise an empty document — no sample graph, so the
 * first thing on screen is whatever the user typed.
 */
export function initialDocument(): Document {
  return readHashDocument() ?? loadStored() ?? emptyDocument();
}