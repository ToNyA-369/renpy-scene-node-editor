"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { LAYOUT, buildOptionHierarchy, hierarchyDepth } = require("../../EDITOR/static/js/ui/choice_picker.js");

test("choice picker exposes shared layout values to specialized pickers", () => {
  assert.equal(LAYOUT.menuWidth, 240);
  assert.equal(LAYOUT.submenuGap, 14);
  assert.ok(Object.isFrozen(LAYOUT));
});

test("choice picker preserves arbitrary directory depth", () => {
  const tree = buildOptionHierarchy([
    { value: "none", pickerPath: "" },
    { value: "deep", pickerPath: "a/b/c/d/e/asset.png" },
    { value: "sibling", pickerPath: "a/b/other.png" },
  ]);
  assert.equal(tree.leading[0].value, "none");
  assert.equal(tree.folders.get("a").folders.get("b").folders.get("c").folders.get("d").folders.get("e").options[0].value, "deep");
  assert.equal(tree.folders.get("a").folders.get("b").options[0].value, "sibling");
  assert.equal(hierarchyDepth(tree), 5);
});

test("choice picker keeps files in their own sibling folders", () => {
  const tree = buildOptionHierarchy([
    { value: "one", pickerPath: "music/day/one.ogg" },
    { value: "two", pickerPath: "music/night/two.ogg" },
  ]);
  const music = tree.folders.get("music");
  assert.deepEqual([...music.folders.keys()], ["day", "night"]);
  assert.equal(music.folders.get("day").options[0].value, "one");
  assert.equal(music.folders.get("night").options[0].value, "two");
});
