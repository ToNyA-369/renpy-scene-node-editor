"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { LAYOUT, normalizeItems, prefixMatches } = require("../../EDITOR/static/js/ui/prefix_picker.js");

test("prefix picker shares the canonical choice menu dimensions", () => {
  assert.deepEqual(LAYOUT, {
    menuMaxHeight: 320,
    menuWidth: 240,
    viewportEdge: 12,
    triggerGap: 7,
  });
});

test("prefix picker deduplicates values and matches case-insensitive ID prefixes", () => {
  const items = [
    "test_key",
    { id: "test_key", name: "Duplicate" },
    { value: "Test_Session", label: "Test Session" },
    "global_checkpoint",
    "",
  ];

  assert.deepEqual(normalizeItems(items), [
    { value: "test_key", label: "test_key" },
    { value: "Test_Session", label: "Test Session" },
    { value: "global_checkpoint", label: "global_checkpoint" },
  ]);
  assert.deepEqual(prefixMatches(items, "TEST_"), [
    { value: "test_key", label: "test_key" },
    { value: "Test_Session", label: "Test Session" },
  ]);
  assert.deepEqual(prefixMatches(items, "checkpoint"), []);
});
