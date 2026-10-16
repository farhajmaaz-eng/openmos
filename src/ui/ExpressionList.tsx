import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { BuildResult } from "../document/build";
import type { Document, ExpressionItem, PointItem, SliderItem, TableItem } from "../document/types";
import { formatNumber, roundTo } from "../math/format";
import { MODEL_LABELS, MODEL_ORDER, fitModel } from "../document/regression";
import { useDispatch } from "../state/useStore";
import { addExpression, addItemOfKind } from "../state/actions";
import { ColorMenu, Latex } from "./ColorMenu";
import { MathField } from "./MathField";
import { IconArrowDown, IconArrowUp, IconCopy, IconEye, IconEyeOff, IconPoint, IconSlider, IconTable, IconTrash } from "./Icon";

/* -------------------------------------------------------------------- shell */

interface RowShellProps {
  index: number;
  selected: boolean;
  hidden: boolean;
  color: string;
  showVisibility: boolean;
  onSelect: () => void;
  onColor: (color: string) => void;
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
          <ColorMenu color={color} onChange={onColor} />
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
}: {
  item: ExpressionItem;
  index: number;
  latex: string;
  error: string | undefined;
  selected: boolean;
  focused: boolean;
}) {
  const dispatch = useDispatch();

  return (
    <RowShell
      index={index}
      selected={selected}
      hidden={item.hidden === true}
      color={item.color}
      showVisibility
      onSelect={() => dispatch({ type: "select", ids: [item.id], focus: item.id })}
      onColor={(color) => dispatch({ type: "setColor", id: item.id, color })}
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
      </div>
    </RowShell>
  );
});

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

  const setValue = useCallback(
    (raw: number) => {
      if (!Number.isFinite(raw)) return;
      dispatch({ type: "setSliderValue", id: item.id, value: clampToSlider(item, raw) });
    },
    [dispatch, item],
  );

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
}: {
  build: BuildResult;
  items: Document["items"];
  selectedIds: string[];
  focusedId: string | null;
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