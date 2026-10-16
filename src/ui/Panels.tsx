import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GridStyle, Settings, ThemeName } from "../document/types";
import { FUNCTIONS } from "../math/functions";
import { useDispatch } from "../state/useStore";
import { emptyDocument } from "../state/store";
import { sanitize, shareUrl } from "../state/persist";
import { Latex } from "./ColorMenu";
import { IconClose, IconCopy, IconCheck, IconDownload, IconUpload } from "./Icon";
import { store } from "../state/useStore";

/* ------------------------------------------------------------------ dialog */

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  return (
    <div className="scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
      >
        <div className="dialog-header">
          <h2 className="dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            style={{ marginLeft: "auto" }}
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="dialog-body" ref={bodyRef} tabIndex={-1}>
          {children}
        </div>
        {footer ? <div className="dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const dispatch = useDispatch();
  const update = (patch: Partial<Settings>) => dispatch({ type: "setSettings", settings: patch });

  return (
    <Dialog
      title="Graph settings"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              store.replace(emptyDocument());
              onClose();
            }}
          >
            Clear everything
          </button>
          <button type="button" className="text-button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="section-label">Appearance</div>

      <Setting label="Theme">
        <Segmented<ThemeName>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "Auto" },
          ]}
        />
      </Setting>

      <Setting label="Grid">
        <Segmented<GridStyle>
          label="Grid"
          value={settings.grid}
          onChange={(grid) => update({ grid })}
          options={[
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
            { value: "dotted", label: "Dotted" },
            { value: "none", label: "None" },
          ]}
        />
      </Setting>

      <div className="section-label">Axes</div>

      <Setting label="Show axes" hint="Draw the x and y axes">
        <Switch label="Show axes" checked={settings.showAxes} onChange={(showAxes) => update({ showAxes })} />
      </Setting>
      <Setting label="Show numbers" hint="Label ticks along each axis">
        <Switch
          label="Show numbers"
          checked={settings.showNumbers}
          onChange={(showNumbers) => update({ showNumbers })}
        />
      </Setting>
      <Setting label="Show the origin" hint="Mark (0, 0)">
        <Switch
          label="Show the origin"
          checked={settings.showOrigin}
          onChange={(showOrigin) => update({ showOrigin })}
        />
      </Setting>
      <Setting label="Angle unit" hint="How sin, cos and tan read their input">
        <Segmented
          label="Angle unit"
          value={settings.degrees ? "deg" : "rad"}
          onChange={(unit) => update({ degrees: unit === "deg" })}
          options={[
            { value: "rad", label: "Radians" },
            { value: "deg", label: "Degrees" },
          ]}
        />
      </Setting>

      <div className="section-label">Work area</div>

      <Setting label="Coordinate readout" hint="Show x and y while the pointer is over the graph">
        <Switch
          label="Coordinate readout"
          checked={settings.showDragHint}
          onChange={(showDragHint) => update({ showDragHint })}
        />
      </Setting>
    </Dialog>
  );
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <span className="setting-label">
        {label}
        {hint ? <span className="setting-hint">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- shortcuts */

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["Enter"], description: "Start a new expression below" },
  { keys: ["Backspace"], description: "Delete an empty row" },
  { keys: ["Alt", "↑"], description: "Move the focused row up" },
  { keys: ["Alt", "↓"], description: "Move the focused row down" },
  { keys: ["Drag"], description: "Pan the graph" },
  { keys: ["Scroll"], description: "Zoom toward the pointer" },
  { keys: ["Shift", "Scroll"], description: "Pan sideways" },
  { keys: ["Drag point"], description: "Move a point on the graph" },
  { keys: ["←", "→", "↑", "↓"], description: "Pan the graph (graph focused)" },
  { keys: ["+", "−"], description: "Zoom in and out (graph focused)" },
  { keys: ["Ctrl", "Z"], description: "Undo" },
  { keys: ["Ctrl", "Shift", "Z"], description: "Redo" },
  { keys: ["Ctrl", "D"], description: "Duplicate the focused row" },
  { keys: ["?"], description: "Open this list" },
];

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard and pointer" onClose={onClose} width={460}>
      <dl className="shortcut-grid">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.description} style={{ display: "contents" }}>
            <dt>{shortcut.description}</dt>
            <dd>
              {shortcut.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ share */

export function SharePanel({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState(() => shareUrl(store.getState().doc));
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be blocked; the field is selectable either way.
      setUrl((value) => value);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(store.getState().doc, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "openmos.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const upload = async (file: File) => {
    try {
      store.replace(sanitize(JSON.parse(await file.text()) as unknown));
      onClose();
    } catch {
      // Leave the document alone if the file is not valid openmos JSON.
    }
  };

  return (
    <Dialog
      title="Share and export"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="text-button" onClick={download}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <IconDownload size={15} />
              Download
            </span>
          </button>
          <button type="button" className="text-button" onClick={() => fileRef.current?.click()}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <IconUpload size={15} />
              Open file
            </span>
          </button>
          <button type="button" className="text-button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />

      <p className="share-note">
        This link carries the whole document — every expression, slider, point and the current view — so
        opening it reproduces what you see now.
      </p>

      <div className="share-row">
        <input className="share-input" readOnly value={url} aria-label="Share link" onFocus={(event) => event.target.select()} />
        <button type="button" className="text-button primary" onClick={copy}>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>

      <div className="section-label">Snapshot</div>
      <p className="share-note" style={{ margin: 0 }}>
        Save the document as JSON to keep it around, or open one you saved earlier. Nothing is uploaded: the
        file stays on your machine.
      </p>
    </Dialog>
  );
}

/* --------------------------------------------------------------- functions */

interface FunctionEntry {
  name: string;
  latex: string;
  signature: string;
}

const FUNCTION_ORDER = [
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "sqrt", "cbrt", "nthroot", "abs", "sign", "floor", "ceil", "round",
  "exp", "ln", "lg", "log", "min", "max", "mean", "median", "stddev",
  "gcd", "lcm", "nCr", "nPr", "mod", "rem",
  "sum", "length", "sort", "reverse", "unique", "range", "linspace",
  "rand", "randInt",
];

const SIGNATURES: Record<string, string> = {
  sqrt: "sqrt(x)", cbrt: "cbrt(x)", nthroot: "nthroot(n, x)", abs: "abs(x)",
  sign: "sign(x)", floor: "floor(x)", ceil: "ceil(x)", round: "round(x) or round(x, n)",
  sin: "sin(x)", cos: "cos(x)", tan: "tan(x)", asin: "asin(x)", acos: "acos(x)", atan: "atan(x)",
  sinh: "sinh(x)", cosh: "cosh(x)", tanh: "tanh(x)",
  exp: "exp(x)", ln: "ln(x)", lg: "lg(x)", log: "log(x) or log(b, x)",
  min: "min(a, b, …)", max: "max(a, b, …)", mean: "mean(list)", median: "median(list)",
  stddev: "stddev(list)", gcd: "gcd(a, b)", lcm: "lcm(a, b)", nCr: "nCr(n, r)", nPr: "nPr(n, r)",
  mod: "mod(a, b)", rem: "rem(a, b)", sum: "sum(list)", length: "length(list)",
  sort: "sort(list)", reverse: "reverse(list)", unique: "unique(list)",
  range: "range(a, b) or range(a, b, step)", linspace: "linspace(a, b, n)",
  rand: "rand() or rand(max)", randInt: "randInt(a, b)",
};

function latexFor(name: string): string {
  switch (name) {
    case "asin": return "\\arcsin\\left(x\\right)";
    case "acos": return "\\arccos\\left(x\\right)";
    case "atan": return "\\arctan\\left(x\\right)";
    case "lg": return "\\log_{2}\\left(x\\right)";
    case "sqrt": return "\\sqrt{x}";
    case "cbrt": return "\\sqrt[3]{x}";
    case "nthroot": return "\\sqrt[n]{x}";
    case "abs": return "\\left|x\\right|";
    case "sign": return "\\operatorname{sign}\\left(x\\right)";
    case "floor": return "\\left\\lfloor x\\right\\rfloor";
    case "ceil": return "\\left\\lceil x\\right\\rceil";
    case "round": return "\\operatorname{round}\\left(x\\right)";
    case "exp": return "e^{x}";
    case "ln": return "\\ln\\left(x\\right)";
    case "log": return "\\log\\left(x\\right)";
    case "min": return "\\min\\left(a,b\\right)";
    case "max": return "\\max\\left(a,b\\right)";
    case "mean": return "\\operatorname{mean}\\left(L\\right)";
    case "median": return "\\operatorname{median}\\left(L\\right)";
    case "stddev": return "\\operatorname{stddev}\\left(L\\right)";
    case "gcd": return "\\gcd\\left(a,b\\right)";
    case "lcm": return "\\operatorname{lcm}\\left(a,b\\right)";
    case "nCr": return "{n\\choose r}";
    case "nPr": return "\\operatorname{nPr}\\left(n,r\\right)";
    case "mod": return "\\operatorname{mod}\\left(a,b\\right)";
    case "rem": return "\\operatorname{rem}\\left(a,b\\right)";
    case "sum": return "\\sum L";
    case "length": return "\\operatorname{length}\\left(L\\right)";
    case "sort": return "\\operatorname{sort}\\left(L\\right)";
    case "reverse": return "\\operatorname{reverse}\\left(L\\right)";
    case "unique": return "\\operatorname{unique}\\left(L\\right)";
    case "range": return "\\operatorname{range}\\left(a,b\\right)";
    case "linspace": return "\\operatorname{linspace}\\left(a,b,n\\right)";
    case "rand": return "\\operatorname{rand}\\left(\\right)";
    case "randInt": return "\\operatorname{randInt}\\left(a,b\\right)";
    default: return `\\operatorname{${name}}\\left(x\\right)`;
  }
}

export function FunctionPanel({ onClose, onInsert }: { onClose: () => void; onInsert: (text: string) => void }) {
  const entries = useMemo<FunctionEntry[]>(
    () =>
      FUNCTION_ORDER.filter((name) => FUNCTIONS.has(name)).map((name) => ({
        name,
        latex: latexFor(name),
        signature: SIGNATURES[name] ?? `${name}(…)`,
      })),
    [],
  );

  return (
    <Dialog title="Functions" onClose={onClose} width={560}>
      <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
        Click a function to add it to the focused row. Angles follow the unit chosen in graph settings.
      </p>
      <div className="function-grid">
        {entries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="function-chip"
            onClick={() => {
              onInsert(entry.signature.replace(/\)$/, "").replace(/\($/, "("));
              onClose();
            }}
          >
            <Latex latex={entry.latex} />
            <span className="function-signature">{entry.signature}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}