import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDocument } from "./document/build";
import { nextId } from "./document/types";
import { clearHash } from "./state/persist";
import { useAppState, useDispatch, store } from "./state/useStore";
import { addExpression } from "./state/actions";
import { ExpressionList, AddButton } from "./ui/ExpressionList";
import { GraphView } from "./ui/GraphView";
import { FunctionPanel, SettingsPanel, SharePanel, ShortcutsPanel } from "./ui/Panels";
import {
  IconFunction,
  IconKeyboard,
  IconRedo,
  IconSettings,
  IconShare,
  IconUndo,
} from "./ui/Icon";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export default function App() {
  const state = useAppState();
  const dispatch = useDispatch();
  const { doc, selectedIds, focusedId, panel, past, future } = state;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------- theming */

  const prefersDark = usePrefersDark(doc.settings.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
    document.documentElement.style.colorScheme = prefersDark ? "dark" : "light";
  }, [prefersDark]);

  /* --------------------------------------------------------------- build */

  const build = useMemo(() => buildDocument(doc), [doc]);
  const lastId = doc.items[doc.items.length - 1]?.id;

  /* ------------------------------------------------------------- toasts */

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable;
      const meta = event.ctrlKey || event.metaKey;

      if (event.key === "?" && !typing) {
        event.preventDefault();
        dispatch({ type: "setPanel", panel: panel === "shortcuts" ? "none" : "shortcuts" });
        return;
      }

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }

      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
        return;
      }

      if (typing) return;

      const firstId = selectedIds[0] ?? focusedId ?? doc.items[0]?.id;

      if (meta && event.key.toLowerCase() === "d" && firstId) {
        event.preventDefault();
        dispatch({ type: "duplicateItem", id: firstId });
        return;
      }

      if (event.key === "Enter" && !typing) {
        event.preventDefault();
        dispatch(addExpression(firstId));
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && firstId) {
        event.preventDefault();
        dispatch({ type: "removeItem", id: firstId });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, doc.items, focusedId, panel, selectedIds]);

  /* -------------------------------------------------- share link handling */

  useEffect(() => {
    if (window.location.hash.startsWith("#d=")) {
      const timer = setTimeout(clearHash, 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  /* ---------------------------------------------------------- panels */

  const insertFunction = useCallback(
    (text: string) => {
      const targetId = focusedId ?? selectedIds[0] ?? lastId;
      if (!targetId) {
        dispatch({ type: "addItem", item: { id: nextId("e"), kind: "expression", color: "#2f6feb", source: `${text}(` } });
        return;
      }
      const item = doc.items.find((entry) => entry.id === targetId);
      if (!item || item.kind !== "expression") return;
      dispatch({ type: "setSource", id: targetId, source: `${item.source}${text}` });
      notify(`Added ${text} to row ${doc.items.indexOf(item) + 1}`);
    },
    [dispatch, doc.items, focusedId, lastId, notify, selectedIds],
  );

  return (
    <div className="app">
      <aside className="panel">
        <header className="panel-header">
          <span className="wordmark">
            <span className="wordmark-dot" aria-hidden="true" />
            openmos
          </span>
          <div className="header-actions">
            <button
              type="button"
              className="icon-button"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              disabled={past.length === 0}
              onClick={() => dispatch({ type: "undo" })}
            >
              <IconUndo size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              disabled={future.length === 0}
              onClick={() => dispatch({ type: "redo" })}
            >
              <IconRedo size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Functions"
              aria-label="Functions"
              onClick={() => dispatch({ type: "setPanel", panel: panel === "functions" ? "none" : "functions" })}
            >
              <IconFunction size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Share"
              aria-label="Share"
              onClick={() => dispatch({ type: "setPanel", panel: panel === "share" ? "none" : "share" })}
            >
              <IconShare size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Shortcuts (?)"
              aria-label="Keyboard shortcuts"
              onClick={() => dispatch({ type: "setPanel", panel: panel === "shortcuts" ? "none" : "shortcuts" })}
            >
              <IconKeyboard size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Settings"
              aria-label="Settings"
              onClick={() => dispatch({ type: "setPanel", panel: panel === "settings" ? "none" : "settings" })}
            >
              <IconSettings size={17} />
            </button>
          </div>
        </header>

        <div className="panel-wrap">
          <div className="panel-scroll">
            {doc.items.length === 0 ? (
              <p className="empty-note">
                Nothing here yet. Add an expression to start plotting.
              </p>
            ) : (
              <ExpressionList
                build={build}
                items={doc.items}
                selectedIds={selectedIds}
                focusedId={focusedId}
              />
            )}
          </div>

          <div className="panel-footer">
            <AddButton afterId={lastId} />
          </div>
        </div>
      </aside>

      <GraphView
        build={build}
        viewport={doc.viewport}
        settings={doc.settings}
        focusedId={focusedId}
        dark={prefersDark}
      />

      {panel === "settings" ? (
        <SettingsPanel settings={doc.settings} onClose={() => dispatch({ type: "setPanel", panel: "none" })} />
      ) : null}
      {panel === "shortcuts" ? (
        <ShortcutsPanel onClose={() => dispatch({ type: "setPanel", panel: "none" })} />
      ) : null}
      {panel === "share" ? <SharePanel onClose={() => dispatch({ type: "setPanel", panel: "none" })} /> : null}
      {panel === "functions" ? (
        <FunctionPanel onClose={() => dispatch({ type: "setPanel", panel: "none" })} onInsert={insertFunction} />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function usePrefersDark(theme: "light" | "dark" | "system"): boolean {
  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(DARK_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (theme === "light") return false;
  if (theme === "dark") return true;
  return systemDark;
}

/** Keep the browser tab title in step with what is on screen. */
export function useDocumentTitle(): void {
  const state = useAppState();
  const expressionCount = state.doc.items.filter((item) => item.kind === "expression").length;
  useEffect(() => {
    document.title = expressionCount > 0 ? "openmos — graphing calculator" : "openmos";
  }, [expressionCount]);
}

export { store };