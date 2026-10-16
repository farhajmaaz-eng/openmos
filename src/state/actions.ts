import { makeItem, nextColor, type Action } from "./store";
import type { ItemKind } from "../document/types";
import { store } from "./useStore";

/**
 * Action creators that need to look at the current document, such as picking
 * the next free colour or variable name. They live apart from the reducer so
 * `store.ts` stays a pure state module.
 */

export function addExpression(afterId?: string): Action {
  return { type: "addItem", item: makeItem("expression", nextColor(store.getState().doc)), afterId };
}

export function addItemOfKind(kind: ItemKind, afterId?: string): Action {
  return { type: "addItem", item: makeItem(kind, nextColor(store.getState().doc)), afterId };
}