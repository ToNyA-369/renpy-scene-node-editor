"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const reorder = require("../../EDITOR/static/js/ui/workspace_tab_reorder.js");

test("horizontal geometry preserves the grab point and stays inside the Bar", () => {
  assert.deepEqual(
    reorder.horizontalGeometry(260, 90, 100, 100, 500),
    { start: 170, center: 220, end: 270 },
  );
  assert.deepEqual(
    reorder.horizontalGeometry(600, 50, 100, 105, 495),
    { start: 395, center: 445, end: 495 },
  );
});

test("target position follows the dragged element geometry rather than the pointer", () => {
  const siblings = [
    { left: 100, width: 80 },
    { left: 180, width: 120 },
    { left: 300, width: 90 },
  ];
  assert.equal(
    reorder.targetIndexForGeometry({ start: 195, center: 245, end: 295 }, siblings, 100, 390),
    2,
  );
  assert.equal(
    reorder.targetIndexForGeometry({ start: 290, center: 340, end: 390 }, siblings, 100, 390),
    3,
  );
});

test("reordered IDs commit only the final slot", () => {
  assert.deepEqual(
    reorder.reorderedIds(["node", "events", "options", "graph"], 3, 1),
    ["node", "graph", "events", "options"],
  );
  assert.deepEqual(
    reorder.reorderedIds(["node", "events", "options", "graph"], 0, 3),
    ["events", "options", "graph", "node"],
  );
});
