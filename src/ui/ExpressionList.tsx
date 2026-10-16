import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BuildResult, Drawable } from "../document/build";
import type { Area, Document, ExpressionItem, PointItem, SliderItem, TableItem, Viewport } from "../document/types";
import { formatNumber, roundTo } from "../math/format";
import { MODEL_LABELS, MODEL_ORDER, fitModel } from "../document/regression";
import { useDispatch } from "../state/useStore";
import { addExpression, addItemOfKind } from "../state/actions";
import { ColorMenu, Latex, StyleMenu } from "./ColorMenu";
import { MathField } from "./MathField";
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconIntegral,
  IconPause,
  IconPlay,
  IconPoint,
  IconSlider,
  IconTable,
  IconTangent,
  IconTrash,
} from "./Icon";

/* -------------------------------------------------------------------- shell */

interface RowShellProps {
  index: number;
  selected: boolean;
  hidden: boolean;
  color: string;
  showVisibility: boolean;
  onSelect: () => void;
  onColor: (color: string) => void;
  /** Replaces the plain colour swatch for rows that have more to offer. */
  styleMenu?: ReactNode;
  /** Sits between the swatch and the body, for row-specific controls. */
  leading?: ReactNode;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  onToggleHidden: () => void;
  children: ReactNode;
}

const RowShell = memo(function RowShell({
  index,
  selected,
  hidden,
  color,
  showVisibility,
  onSelect,
  onColor,
  styleMenu,
  leading,
  onDelete,
  onDuplicate,
  onMove,
  onToggleHidden,
  children,
}: RowShellProps) {
  return (
    <div
      className={`row${selected ? " is-selected" : ""}${hidden ? " is-hidden" : ""}`}
      onPointerDown={onSelect}
      onDoubleClick={onDuplicate}
    >
      <div className="row-gutter">
        <span className="row-index">{index + 1}</span>
      </div>
      <div className="row-body">
        <div className="row-main">
          {styleMenu ?? <ColorMenu color={color} onChange={onColor} />}
          {leading}
          {children}
        </div>
      </div>
      <div className="row-actions">
        {showVisibility ? (
          <RowButton label={hidden ? "Show" : "Hide"} onSelect={onToggleHidden}>
            {hidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </RowButton>
        ) : null}
        <RowButton label="Move up" onSelect={() => onMove(-1)} disabled={index === 0}>
          <IconArrowUp size={15} />
        </RowButton>
        <RowButton label="Move down" onSelect={() => onMove(1)}>
          <IconArrowDown size={15} />
        </RowButton>
        <RowButton label="Duplicate" onSelect={onDuplicate}>
          <IconCopy size={15} />
        </RowButton>
        <RowButton label="Delete" onSelect={onDelete}>
          <IconTrash size={15} />
        </RowButton>
      </div>
    </div>
  );
});

function RowButton({
  label,
  onSelect,
  disabled = false,
  children,
}: {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- expression */

const ExpressionRow = memo(function ExpressionRow({
  item,
  index,
  latex,
  error,
  selected,
  focused,
  kind,
  areaValue,
  viewport,
}: {
  item: ExpressionItem;
  index: number;
  latex: string;
  error: string | undefined;
  selected: boolean;
  focused: boolean;
  kind: Drawable["kind"];
  areaValue: number | undefined;
  viewport: Viewport;
}) {
  const dispatch = useDispatch();

  const set = useCallback(
    (field: string, value: string | number | boolean | Area | null, transient?: boolean) =>
      dispatch({ type: "setField", id: item.id, field, value, transient }),
    [dispatch, item.id],
  );

  const lineStyle = item.lineStyle ?? "solid";
  // A region always shades its inside; `none` only makes sense for a curve.
  const fill = item.fill ?? (kind === "region" ? "semi" : "none");

  // Turning the area on starts it over what is on screen, which is nearly
  // always what the user means by "the area under this".
  const toggleArea = useCallback(() => {
    if (item.area) {
      set("area", null);
      return;
    }
    // Half the width of the window, to the nearest tenth.
    const half = Math.round(viewport.scale * 200 * 10) / 10;
    const middle = Math.round(viewport.x * 10) / 10;
    set("area", [middle - half, middle + half]);
  }, [item.area, set, viewport]);

  const setAreaBound = useCallback(
    (which: 0 | 1, value: number) => {
      if (!item.area) return;
      const next: [number, number] = [...item.area] as [number, number];
      next[which] = value;
      // Typed one key at a time, so it must be a single undo step.
      set("area", next, true);
    },
    [item.area, set],
  );

  return (
    <RowShell
      index={index}
      selected={selected}
      hidden={item.hidden === true}
      color={item.color}
      showVisibility
      onSelect={() => dispatch({ type: "select", ids: [item.id], focus: item.id })}
      onColor={(color) => dispatch({ type: "setColor", id: item.id, color })}
      styleMenu={
        <StyleMenu
          color={item.color}
          lineStyle={lineStyle}
          fill={fill}
          fillOptional={kind === "implicit"}
          onColor={(color) => dispatch({ type: "setColor", id: item.id, color })}
          onLineStyle={(value) => set("lineStyle", value)}
          onFill={(value) => set("fill", value)}
        />
      }
      onDelete={() => dispatch({ type: "removeItem", id: item.id })}
      onDuplicate={() => dispatch({ type: "duplicateItem", id: item.id })}
      onMove={(delta) => dispatch({ type: "moveItem", id: item.id, delta })}
      onToggleHidden={() => dispatch({ type: "toggleHidden", id: item.id })}
    >
      <div>
        <MathField
          value={item.source}
          latex={latex}
          invalid={Boolean(error)}
          ariaLabel={`Expression ${index + 1}`}
          placeholder="Type an expression"
          autoFocus={focused && item.source.length === 0}
          onChange={(value) => dispatch({ type: "setSource", id: item.id, source: value })}
          onSubmit={() => dispatch(addExpression(item.id))}
          onCancel={() => dispatch({ type: "select", ids: [], focus: null })}
          onDelete={() => dispatch({ type: "removeItem", id: item.id })}
          onArrowDown={() => dispatch({ type: "moveItem", id: item.id, delta: 1 })}
          onArrowUp={() => dispatch({ type: "moveItem", id: item.id, delta: -1 })}
        />
        {error ? <div className="row-message">{error}</div> : null}

        {kind === "curve" ? (
          <div className="row-tools">
            <button
              type="button"
              className={`chip${item.area ? " is-on" : ""}`}
              aria-pressed={Boolean(item.area)}
              aria-label={item.area ? "Area: on" : "Area: off"}
              title="Shade the area under the curve"
              onClick={toggleArea}
            >
              <IconIntegral size={14} />
            </button>
            <button
              type="button"
              className={`chip${item.tangent ? " is-on" : ""}`}
              aria-pressed={item.tangent === true}
              aria-label={item.tangent ? "Tangent: on" : "Tangent: off"}
              title="Draw the tangent line where the pointer is"
              onClick={() => set("tangent", item.tangent !== true)}
            >
              <IconTangent size={14} />
            </button>

            {item.area ? (
              <div className="area-controls">
                <NumberField
                  className="area-input"
                  ariaLabel="Area from x"
                  value={item.area[0]}
                  onChange={(value) => setAreaBound(0, value)}
                />
                <span className="area-dash">to</span>
                <NumberField
                  className="area-input"
                  ariaLabel="Area to x"
                  value={item.area[1]}
                  onChange={(value) => setAreaBound(1, value)}
                />
                <span className="area-value">
                  {areaValue === undefined ? "…" : formatNumber(areaValue, 4)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </RowShell>
  );
});

/**
 * A number input that can actually be typed into.
 *
 * Writing the formatted value straight back means every keystroke is replaced
 * by it, so a decimal point can never be entered: `-3` is reformatted to `-3`
 * and the `.` is lost. The text being typed is therefore held locally and only
 * tidied up when the field is left.
 */
function NumberField({
  className,
  ariaLabel,
  value,
  onChange,
}: {
  className: string;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatAreaBound(value);

  return (
    <input
      className={className}
      value={shown}
      aria-label={ariaLabel}
      inputMode="decimal"
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const parsed = Number.parseFloat(text);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function formatAreaBound(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number.parseFloat(value.toFixed(6)));
}


/* ------------------------------------------------------------------ slider */

/** Decimal places implied by the slider step, so 0.1 shows as 0.1 not 0.10. */
function decimalsFor(item: SliderItem): number {
  const step = Math.abs(item.step);
  if (step >= 1) return 0;
  return Math.min(10, Math.max(0, Math.ceil(-Math.log10(step))));
}

function clampToSlider(item: SliderItem, value: number): number {
  const clamped = Math.min(item.max, Math.max(item.min, value));
  return roundTo(clamped, decimalsFor(item) + 2);
}

const SliderRow = memo(function SliderRow({
  item,
  index,
  selected,
}: {
  item: SliderItem;
  index: number;
  selected: boolean;
}) {
  const dispatch = useDispatch();
  const decimals = useMemo(() => decimalsFor(item), [item]);
  const [playing, setPlaying] = useState(false);

  const setValue = useCallback(
    (raw: number) => {
      if (!Number.isFinite(raw)) return;
      dispatch({ type: "setSliderValue", id: item.id, value: clampToSlider(item, raw) });
    },
    [dispatch, item],
  );

  // Animation walks the value rather than the frames, so a slow machine takes
  // the same time over the range as a fast one.
  useEffect(() => {
    if (!playing) return undefined;
    const span = item.max - item.min;
    if (!(span > 0)) {
      setPlaying(false);
      return undefined;
    }

    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;
      // A full sweep of the range every four seconds.
      const next = item.value + (elapsed * span) / 4;
      dispatch({
        type: "setSliderValue",
        id: item.id,
        value: next > item.max ? item.min : clampToSlider(item, next),
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dispatch, item.id, item.max, item.min, item.value, playing]);

  return (
    <RowShell
      index={index}
      selected={selected}
      hidden={item.hidden === true}
      color={item.color}
      showVisibility={false}
      leading={
        <button
          type="button"
          className={`chip chip-icon${playing ? " is-on" : ""}`}
          aria-pressed={playing}
          aria-label={`Animate ${item.variable}`}
          title={playing ? "Stop" : "Animate"}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
        </button>
      }
      onSelect={() => dispatch({ type: "select", ids: [item.id], focus: item.id })}
      onColor={(color) => dispatch({ type: "setColor", id: item.id, color })}
      onDelete={() => dispatch({ type: "removeItem", id: item.id })}
      onDuplicate={() => dispatch({ type: "duplicateItem", id: item.id })}
      onMove={(delta) => dispatch({ type: "moveItem", id: item.id, delta })}
      onToggleHidden={() => dispatch({ type: "toggleHidden", id: item.id })}
    >
      <div className="slider-row">
        <div className="slider-head">
          <span className="slider-variable">{item.variable}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
            {formatNumber(item.min, 4)} … {formatNumber(item.max, 4)}
          </span>
          <span className="slider-value">
            =
            <input
              value={formatNumber(item.value, decimals)}
              aria-label={`Value of ${item.variable}`}
              inputMode="decimal"
              onChange={(event) => setValue(Number.parseFloat(event.target.value))}
            />
          </span>
        </div>
        <input
          type="range"
          min={item.min}
          max={item.max}
          step={item.step}
          value={item.value}
          aria-label={`${item.variable} slider`}
          onChange={(event) => setValue(Number.parseFloat(event.target.value))}
        />
      </div>
    </RowShell>
  );
});

/* -------------------------------------------------------------------- point */

const PointRow = memo(function PointRow({
  item,
  index,
  selected,
}: {
  item: PointItem;
  index: number;
  selected: boolean;
}) {
  const dispatch = useDispatch();

  return (
    <RowShell
      index={index}
      selected={selected}
      hidden={item.hidden === true}
      color={item.color}
      showVisibility={false}
      onSelect={() => dispatch({ type: "select", ids: [item.id], focus: item.id })}
      onColor={(color) => dispatch({ type: "setColor", id: item.id, color })}
      onDelete={() => dispatch({ type: "removeItem", id: item.id })}
      onDuplicate={() => dispatch({ type: "duplicateItem", id: item.id })}
      onMove={(delta) => dispatch({ type: "moveItem", id: item.id, delta })}
      onToggleHidden={() => dispatch({ type: "toggleHidden", id: item.id })}
    >
      <div className="point-row">
        <span className="point-coord">
          <Dim>(</Dim>
          <input
            value={formatNumber(item.x, 6)}
            aria-label="x coordinate"
            inputMode="decimal"
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              if (Number.isFinite(parsed)) dispatch({ type: "setPoint", id: item.id, x: parsed, y: item.y });
            }}
          />
          <Dim>,</Dim>
          <input
            value={formatNumber(item.y, 6)}
            aria-label="y coordinate"
            inputMode="decimal"
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value);
              if (Number.isFinite(parsed)) dispatch({ type: "setPoint", id: item.id, x: item.x, y: parsed });
            }}
          />
          <Dim>)</Dim>
        </span>
      </div>
    </RowShell>
  );
});

function Dim({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--text-faint)" }}>{children}</span>;
}

/* -------------------------------------------------------------------- table */

const TableRow = memo(function TableRow({
  item,
  index,
  selected,
  table,
  onFit,
}: {
  item: TableItem;
  index: number;
  selected: boolean;
  table: BuildResult["tables"][number] | undefined;
  onFit: (latex: string, color: string) => void;
}) {
  const dispatch = useDispatch();
  const columns = table?.columns ?? [];

  const fits = useMemo(() => {
    if (columns.length < 2) return [];
    const xs = columns[0]!.values;
    const ys = columns[1]!.values;
    const length = Math.min(xs.length, ys.length);
    if (length < 2) return [];
    const series = { x: xs.slice(0, length), y: ys.slice(0, length) };
    return MODEL_ORDER.map((model) => fitModel(series, model))
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .slice(0, 4);
  }, [columns]);

  const rowCount = columns[0]?.values.length ?? 0;

  return (
    <div
      className={`row${selected ? " is-selected" : ""}`}
      onPointerDown={() => dispatch({ type: "select", ids: [item.id], focus: item.id })}
    >
      <div className="row-gutter">
        <span className="row-index">{index + 1}</span>
      </div>
      <div className="row-body">
        <div className="row-main">
          <ColorMenu color={item.color} onChange={(color) => dispatch({ type: "setColor", id: item.id, color })} />
          <MathField
            value={item.source}
            ariaLabel={`Table ${index + 1}`}
            placeholder="[1, 2, 3], [1, 4, 9]"
            onChange={(value) => dispatch({ type: "setSource", id: item.id, source: value })}
            onSubmit={() => dispatch(addExpression(item.id))}
          />
        </div>

        <div className="table-block">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((column, columnIndex) => (
                    <th key={`${column.header}-${columnIndex}`} scope="col">
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowCount === 0 ? (
                  <tr>
                    <td className="is-nan" colSpan={Math.max(1, columns.length)}>
                      {emptyTableNote(item.source)}
                    </td>
                  </tr>
                ) : (
                  Array.from({ length: rowCount }, (_, rowIndex) => (
                    <tr key={rowIndex}>
                      {columns.map((column, columnIndex) => {
                        const value = column.values[rowIndex];
                        const missing = value === undefined || !Number.isFinite(value);
                        return (
                          <td key={columnIndex} className={missing ? "is-nan" : undefined}>
                            {missing ? "—" : formatNumber(value, 6)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {fits.length > 0 ? (
            <div className="regression-list">
              {fits.map((result) => (
                <button
                  key={result.name}
                  type="button"
                  className="regression-item"
                  title={`Add the ${MODEL_LABELS[result.name]} fit to the graph`}
                  onClick={() => onFit(result.latex, item.color)}
                >
                  <Latex latex={result.latex} />
                  <span className="regression-r2">R²{result.r2.toFixed(3)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="row-actions">
        <RowButton label="Delete" onSelect={() => dispatch({ type: "removeItem", id: item.id })}>
          <IconTrash size={15} />
        </RowButton>
      </div>
    </div>
  );
});

function emptyTableNote(source: string): string {
  if (source.trim().length === 0) return "Add a list to see values";
  return "No usable numbers in this list";
}

/* -------------------------------------------------------------------- list */

export function ExpressionList({
  build,
  items,
  selectedIds,
  focusedId,
  viewport,
}: {
  build: BuildResult;
  items: Document["items"];
  selectedIds: string[];
  focusedId: string | null;
  viewport: Viewport;
}) {
  const dispatch = useDispatch();

  const onFit = useCallback(
    (latex: string, color: string) => {
      const source = latex.replace(/^y\s*=\s*/, "");
      const item: ExpressionItem = {
        id: `fit${Math.random().toString(36).slice(2, 9)}`,
        kind: "expression",
        color,
        source: `y=${source}`,
      };
      dispatch({ type: "addItem", item });
    },
    [dispatch],
  );

  return (
    <div className="list">
      {items.map((item, index) => {
        const selected = selectedIds.includes(item.id);

        switch (item.kind) {
          case "slider":
            return <SliderRow key={item.id} item={item} index={index} selected={selected} />;

          case "point":
            return <PointRow key={item.id} item={item} index={index} selected={selected} />;

          case "table":
            return (
              <TableRow
                key={item.id}
                item={item}
                index={index}
                selected={selected}
                table={build.tables.find((table) => table.id === item.id)}
                onFit={onFit}
              />
            );

          default:
            return (
              <ExpressionRow
                key={item.id}
                item={item}
                index={index}
                latex={build.latex.get(item.id) ?? ""}
                error={build.errors.get(item.id)}
                selected={selected}
                focused={focusedId === item.id && selected}
                kind={build.drawables.find((entry) => entry.id === item.id)?.kind ?? "bad"}
                areaValue={build.areas.get(item.id)}
                viewport={viewport}
              />
            );
        }
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- add menu */

export function AddButton({ afterId }: { afterId: string | undefined }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);

  const choose = (run: () => void) => {
    run();
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="add-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span aria-hidden="true" style={{ display: "inline-flex", fontSize: 15, lineHeight: 1 }}>
          +
        </span>
        Add
      </button>
      {open ? (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: 0,
              zIndex: 21,
              display: "grid",
              gap: 1,
              minWidth: 182,
              padding: 5,
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              background: "var(--bg-raised)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <AddMenuItem
              label="Expression"
              hint="y = x^2"
              icon={<span style={{ fontFamily: "var(--font-math)", fontStyle: "italic", fontSize: 16 }}>ƒ</span>}
              onSelect={() => choose(() => dispatch(addExpression(afterId)))}
            />
            <AddMenuItem
              label="Slider"
              hint="a = 5"
              icon={<IconSlider size={16} />}
              onSelect={() => choose(() => dispatch(addItemOfKind("slider", afterId)))}
            />
            <AddMenuItem
              label="Point"
              hint="(1, 2)"
              icon={<IconPoint size={16} />}
              onSelect={() => choose(() => dispatch(addItemOfKind("point", afterId)))}
            />
            <AddMenuItem
              label="Table"
              hint="[1, 2, 3]"
              icon={<IconTable size={16} />}
              onSelect={() => choose(() => dispatch(addItemOfKind("table", afterId)))}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddMenuItem({
  label,
  hint,
  icon,
  onSelect,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="add-menu-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "6px 8px",
        border: 0,
        borderRadius: 5,
        background: "transparent",
        textAlign: "left",
      }}
    >
      <span style={{ color: "var(--text-muted)", display: "inline-flex", width: 16, justifyContent: "center" }}>{icon}</span>
      <span>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-math)" }}>
        {hint}
      </span>
    </button>
  );
}