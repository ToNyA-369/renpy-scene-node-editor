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
