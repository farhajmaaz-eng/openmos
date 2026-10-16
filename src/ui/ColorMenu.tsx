import { memo, useEffect, useRef, useState } from "react";
import katex from "katex";
import { PALETTE, type FillStyle, type LineStyle } from "../document/types";

/* ------------------------------------------------------------------ popover */

function useDismiss(open: boolean, close: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [close, open]);

  return rootRef;
}

/* ---------------------------------------------------------------- colour */

interface ColorMenuProps {
  color: string;
  onChange: (color: string) => void;
}

/** The colour picker for a row: a swatch that opens a small grid. */
export const ColorMenu = memo(function ColorMenu({ color, onChange }: ColorMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rootRef = useDismiss(open, close);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "grid", placeItems: "center" }}>
      <button
        type="button"
        className="swatch"
        style={{ background: color, color }}
        aria-label="Change colour"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      />
      {open ? (
        <div
          role="menu"
          className="swatch-grid"
          onClick={(event) => event.stopPropagation()}
        >
          {PALETTE.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option.toLowerCase() === color.toLowerCase()}
              aria-label={option}
              onClick={() => {
                onChange(option);
                close();
              }}
              style={{
                background: option,
                outline: option.toLowerCase() === color.toLowerCase() ? "2px solid var(--accent)" : "none",
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ style */

const LINE_STYLES: { value: LineStyle; label: string; dash: string }[] = [
  { value: "solid", label: "Solid", dash: "" },
  { value: "dashed", label: "Dashed", dash: "7,5" },
  { value: "dotted", label: "Dotted", dash: "2,4" },
];

const FILL_STYLES: { value: FillStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "semi", label: "Light" },
  { value: "solid", label: "Solid" },
];

export interface StyleMenuProps {
  color: string;
  lineStyle: LineStyle;
  fill: FillStyle;
  onColor: (color: string) => void;
  onLineStyle: (style: LineStyle) => void;
  onFill: (fill: FillStyle) => void;
  /** Regions always have an inside, so there is nothing to turn off. */
  fillOptional: boolean;
}

/**
 * Colour, line style and fill for one row.
 *
 * All three live behind the swatch rather than taking up a row of their own,
 * which matters on a phone where every row of controls is another row of the
 * graph the user cannot see.
 */
export const StyleMenu = memo(function StyleMenu({
  color,
  lineStyle,
  fill,
  onColor,
  onLineStyle,
  onFill,
  fillOptional,
}: StyleMenuProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const rootRef = useDismiss(open, close);

  return (
    <div ref={rootRef} className="style-menu">
      <button
        type="button"
        className="swatch"
        style={{ background: color, color }}
        aria-label="Colour, line style and fill"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      />
      {open ? (
        <div className="style-popover" onClick={(event) => event.stopPropagation()}>
          <div className="style-group">
            <span className="style-label">Colour</span>
            <div className="swatch-grid">
              {PALETTE.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.toLowerCase() === color.toLowerCase()}
                  aria-label={option}
                  className="swatch-dot"
                  style={{
                    background: option,
                    outline: option.toLowerCase() === color.toLowerCase() ? "2px solid var(--accent)" : "none",
                  }}
                  onClick={() => onColor(option)}
                />
              ))}
            </div>
          </div>

          <div className="style-group">
            <span className="style-label">Line</span>
            <div className="segmented">
              {LINE_STYLES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="segment"
                  aria-pressed={lineStyle === option.value}
                  onClick={() => onLineStyle(option.value)}
                >
                  <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
                    <line
                      x1="1"
                      y1="5"
                      x2="21"
                      y2="5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={option.dash || undefined}
                    />
                  </svg>
                  <span className="visually-hidden">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="style-group">
            <span className="style-label">Fill</span>
            <div className="segmented">
              {FILL_STYLES.filter((option) => fillOptional || option.value !== "none").map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="segment segment-text"
                  aria-pressed={fill === option.value}
                  onClick={() => onFill(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------- latex */

/** Small inline LaTeX preview, used in tables and the share panel. */
export const Latex = memo(function Latex({ latex, className }: { latex: string; className?: string }) {
  const html = renderLatex(latex);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

export function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      output: "html",
      displayMode: false,
      strict: false,
    });
  } catch {
    return latex.replace(/[<>&]/g, "");
  }
}