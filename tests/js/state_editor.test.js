"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const SceneStateEditor = require("../../EDITOR/static/js/workspaces/state_editor.js");

test("Stats are grouped for management without changing stable IDs", () => {
  const stats = {
    money: { Name: "Money", Group: "Resources" },
    day: { Name: "Day", Group: "Time" },
    energy: { Name: "Energy", Group: "Resources" },
    legacy: { Name: "Legacy" },
  };

  assert.deepEqual(SceneStateEditor.groupedStatEntries(stats), [
    { group: "Normal", entries: [["legacy", stats.legacy]] },
    { group: "Resources", entries: [["money", stats.money], ["energy", stats.energy]] },
    { group: "Time", entries: [["day", stats.day]] },
  ]);
  assert.deepEqual(SceneStateEditor.groupedStatEntries({}), [
    { group: "Normal", entries: [] },
  ]);
});

test("Stat choices expose Group to Stat picker paths and keep leaf names", () => {
  assert.deepEqual(SceneStateEditor.statChoices({
    money: { Name: "Money", Group: "Resources/Main" },
    legacy: { Name: "Legacy" },
  }), [
    { id: "money", name: "Money", pickerPath: "Resources／Main/Money" },
    { id: "legacy", name: "Legacy", pickerPath: "Normal/Legacy" },
  ]);
  assert.equal(SceneStateEditor.normalizeGroup("  Time  "), "Time");
  assert.equal(SceneStateEditor.normalizeGroup(""), "Normal");
  assert.equal(SceneStateEditor.DEFAULT_GROUP, "Normal");
});
