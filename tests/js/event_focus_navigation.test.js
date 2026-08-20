"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { navigationStep } = require("../../EDITOR/static/js/workspaces/event_focus_navigation.js");

test("Event child navigation stays within fields until a hierarchy boundary", () => {
  assert.deepEqual(navigationStep(0, 4, 1), { type: "field", index: 1 });
  assert.deepEqual(navigationStep(2, 4, -1), { type: "field", index: 1 });
  assert.deepEqual(navigationStep(3, 4, 1), { type: "next-section" });
  assert.deepEqual(navigationStep(0, 4, -1), { type: "section" });
});
