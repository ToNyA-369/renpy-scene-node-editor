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

test("Stat Order is optional, stable, and normalized only for Editor persistence", () => {
  const stats = {
    late: { Name: "Late", Order: 8 },
    first: { Name: "First", Order: 1 },
    legacy: { Name: "Legacy" },
  };
  assert.deepEqual(Object.keys(SceneStateEditor.withStatOrders(stats)), ["first", "legacy", "late"]);
  assert.deepEqual(
    Object.values(SceneStateEditor.withStatOrders(stats)).map((values) => values.Order),
    [0, 1, 2],
  );
});

test("Stat pool blocks share one ordered flow for loose rows and groups", () => {
  const stats = {
    loose_a: { Name: "A", Group: "Normal", Order: 0 },
    grouped_a: { Name: "B", Group: "Story", Order: 1 },
    grouped_b: { Name: "C", Group: "Story", Order: 2 },
    loose_b: { Name: "D", Group: "Normal", Order: 3 },
  };
  assert.deepEqual(SceneStateEditor.statPoolBlocks(stats), [
    { type: "item", id: "loose_a", values: stats.loose_a },
    { type: "group", group: "Story", entries: [["grouped_a", stats.grouped_a], ["grouped_b", stats.grouped_b]] },
    { type: "item", id: "loose_b", values: stats.loose_b },
  ]);
});
