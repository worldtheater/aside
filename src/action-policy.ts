import type { Action } from "./types.js";

// Preset identity survives edits; `builtin` only controls default display/instruction resolution.
export const PRESET_ACTION_IDS = [
  "translate",
  "plain",
  "explain",
  "summary",
  "qa",
] as const;
export const isPresetAction = (action: Pick<Action, "id">) =>
  PRESET_ACTION_IDS.some((id) => id === action.id);

export const MAX_ACTIONS = 20;
export const MAX_COLLAPSED_ACTIONS = 3;

export function actionLimitError(actions: readonly unknown[]) {
  return actions.length > MAX_ACTIONS ? "actionLimit" : null;
}

export function toolbarActions(actions: Action[], expanded: boolean) {
  const enabled = actions.filter((action) => action.quick);
  return expanded ? enabled : enabled.slice(0, MAX_COLLAPSED_ACTIONS);
}
