"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const reorder = require("../../EDITOR/static/js/ui/list_reorder.js");

test("reorderIds moves an item before or after a stable target", () => {
  assert.deepEqual(reorder.reorderIds(["a", "b", "c", "d"], "d", "b", "before"), ["a", "d", "b", "c"]);
  assert.deepEqual(reorder.reorderIds(["a", "b", "c", "d"], "a", "c", "after"), ["b", "c", "a", "d"]);
});

test("reorderIds appends when the list tail is targeted", () => {
  assert.deepEqual(reorder.reorderIds(["a", "b", "c"], "a"), ["b", "c", "a"]);
});

test("reorderIds leaves unknown sources and targets unchanged", () => {
  assert.deepEqual(reorder.reorderIds(["a", "b"], "missing", "a"), ["a", "b"]);
  assert.deepEqual(reorder.reorderIds(["a", "b"], "a", "missing"), ["a", "b"]);
});

test("insertion hysteresis resists midpoint jitter", () => {
  const rect = { top: 100, height: 50 };
  assert.equal(reorder.insertionPosition(128, rect, "before"), "before");
  assert.equal(reorder.insertionPosition(122, rect, "after"), "after");
  assert.equal(reorder.insertionPosition(140, rect, "before"), "after");
});

test("the insertion model also supports projected horizontal coordinates", () => {
  const horizontalRect = { top: 200, height: 80 };
  assert.equal(reorder.insertionPosition(225, horizontalRect), "before");
  assert.equal(reorder.insertionPosition(270, horizontalRect), "after");
});

test("horizontal drag geometry follows the element instead of the pointer grab point", () => {
  const grabbedNearRightEdge = reorder.horizontalDragGeometry(260, 90, 100, 100, 500);
  const grabbedNearLeftEdge = reorder.horizontalDragGeometry(180, 10, 100, 100, 500);
  assert.deepEqual(grabbedNearRightEdge, { start: 170, center: 220, end: 270 });
  assert.deepEqual(grabbedNearLeftEdge, { start: 170, center: 220, end: 270 });
});

test("horizontal drag geometry keeps the whole element inside the track", () => {
  assert.deepEqual(
    reorder.horizontalDragGeometry(20, 50, 100, 105, 495),
    { start: 105, center: 155, end: 205 },
  );
  assert.deepEqual(
    reorder.horizontalDragGeometry(600, 50, 100, 105, 495),
    { start: 395, center: 445, end: 495 },
  );
});
