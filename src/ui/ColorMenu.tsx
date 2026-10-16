import { memo, useEffect, useRef, useState } from "react";
import katex from "katex";
import { PALETTE } from "../document/types";
import type { Item } from "../document/types";

interface ColorMenuProps {
  color: string;
  onChange: (color: string) => void;
}

/** The colour picker for an expression row: a swatch that opens a small grid. */
export const ColorMenu = memo(function ColorMenu({ color, onChange }: ColorMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            display: "grid",
            gridTemplateColumns: "repeat(5, 18px)",
            gap: 3,
            padding: 6,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            background: "var(--bg-raised)",
            boxShadow: "var(--shadow-md)",
          }}
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
                setOpen(false);
              }}
              style={{
                width: 18,
                height: 18,
                padding: 0,
                borderRadius: "50%",
                border: "1px solid rgba(0,0,0,0.14)",
                background: option,
                outline: option.toLowerCase() === color.toLowerCase() ? "2px solid var(--accent)" : "none",
                outlineOffset: 1,
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

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

/** A menu row button used by the item context menu. */
export function MenuAction({
  label,
  onSelect,
  children,
}: {
  label: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

export function itemTypeLabel(item: Item): string {
  switch (item.kind) {
    case "slider":
      return "Slider";
    case "point":
      return "Point";
    case "table":
      return "Table";
    default:
      return "Expression";
  }
}