import { useCallback, useSyncExternalStore } from "react";
import { initialState, reducer, type Action, type AppState } from "./store";
import { initialDocument, saveStored } from "./persist";

/**
 * A tiny observable store rather than React context.
 *
 * The canvas redraws on every document change and must not be re-created when
 * an unrelated panel opens, so state lives outside the tree and components
 * subscribe to the slices they actually read.
 */

type Listener = () => void;

class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  /** The row a run of keystrokes is going into, for undo grouping. */
  private lastTyping: string | null = null;

  constructor() {
    this.state = initialState(initialDocument());
  }

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (action: Action): void => {
    let resolved = action;

    // A run of consecutive edits to the same row collapses into one undo step.
    // The run ends as soon as anything else happens, so undo never depends on
    // how fast someone was typing.
    if (action.type === "setSource") {
      resolved = { ...action, transient: this.lastTyping === action.id };
      this.lastTyping = action.id;
    } else {
      this.lastTyping = null;
    }

    const next = reducer(this.state, resolved);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
    saveStored(next.doc);
  };

  /** Replace the document wholesale, used by import and share links. */
  replace = (doc: AppState["doc"]): void => {
    this.state = reducer(this.state, { type: "load", doc });
    for (const listener of this.listeners) listener();
    saveStored(this.state.doc);
  };
}

export const store = new Store();

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useDispatch(): (action: Action) => void {
  return store.dispatch;
}

/**
 * Read a slice of the state with referential stability, so an effect that
 * depends on it does not re-run on every unrelated change.
 */
export function useSelector<T>(selector: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const select = useCallback(() => selector(store.getState()), [selector]);

  const getSnapshot = useCallback((): T => {
    const next = select();
    const previous = cache.get(select) as { value: T } | undefined;
    if (previous && isEqual(previous.value, next)) return previous.value;
    cache.set(select, { value: next });
    return next;
  }, [select, isEqual]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

const cache = new WeakMap<() => unknown, { value: unknown }>();