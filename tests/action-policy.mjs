import assert from "node:assert/strict";
import {
  toolbarActions,
  actionLimitError,
  MAX_COLLAPSED_ACTIONS,
  MAX_ACTIONS,
} from "../action-policy.js";
const actions = Array.from({ length: MAX_ACTIONS }, (_, index) => ({
  id: String(index),
  quick: index % 3 !== 0,
}));
const enabled = actions.filter((action) => action.quick);
assert.equal(actionLimitError(actions), null);
assert.equal(
  actionLimitError([...actions, { id: "extra", quick: false }]),
  "actionLimit",
);
assert.deepEqual(
  toolbarActions(actions, false),
  enabled.slice(0, MAX_COLLAPSED_ACTIONS),
);
assert.deepEqual(toolbarActions(actions, true), enabled);
const reordered = [actions[19], ...actions.slice(0, 19)];
assert.equal(toolbarActions(reordered, false)[0].id, "19");
assert.deepEqual(
  toolbarActions(
    actions.map((action) => ({ ...action, quick: false })),
    true,
  ),
  [],
);
assert.deepEqual(toolbarActions([], false), []);
assert.deepEqual(
  actions.map((action) => action.id),
  Array.from({ length: MAX_ACTIONS }, (_, index) => String(index)),
  "Reading toolbar actions never mutates the saved order",
);
console.log(
  "PASS: toolbar visibility follows enablement and saved order; first three collapsed, all enabled expanded, no shortcut quota.",
);
