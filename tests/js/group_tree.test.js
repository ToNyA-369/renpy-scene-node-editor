"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tree = require("../../EDITOR/static/js/core/group_tree.js");
const editor = require("../../EDITOR/static/js/workspaces/event_editor.js");
const item = (id, groupPath = []) => ({ id, groupPath });
const apply = (items, plan) => plan.order.map((id) => ({ ...items.find((entry) => entry.id === id), groupPath: plan.assignments[id] ?? tree.path(items.find((entry) => entry.id === id)) }));

test("legacy names stay whole and explicit paths preserve singleton ancestors", () => {
  assert.deepEqual(tree.path({ Group: "Act/Room" }), ["Act/Room"]);
  assert.deepEqual(tree.path({ Group: "old", "Group Path": [] }), []);
  const blocks = tree.blocks([item("a", ["Act", "Town", "Shop"])]);
  assert.equal(blocks[0].blocks[0].blocks[0].blocks[0].event.id, "a");
  assert.deepEqual(tree.ancestorKeys(["A", "B"]), ['["A"]', '["A","B"]']);
});

test("nested grouping creates one child at a time and rejects a fourth level", () => {
  let items = [item("a", ["A", "B"]), item("b", ["A", "B"])];
  const settings = { sourceId: "a", targetId: "b", targetGroup: tree.key(["A", "B"]), mode: "group", newGroupName: "C" };
  const plan = tree.planDrop(items, settings);
  assert.deepEqual(plan.assignments, { a: ["A", "B", "C"], b: ["A", "B", "C"] });
  items = apply(items, plan);
  assert.equal(tree.planDrop(items, { ...settings, targetGroup: tree.key(["A", "B", "C"]) }), null);
});

test("moving a whole subtree preserves order and blocks cycles and excess depth", () => {
  const items = [item("x", ["A"]), item("b", ["B"]), item("c", ["B", "C"]), item("z")];
  const plan = tree.planDrop(items, { sourceGroup: tree.key(["B"]), targetGroup: tree.key(["A"]), targetId: "x", position: "after" });
  assert.deepEqual(plan.assignments, { b: ["A", "B"], c: ["A", "B", "C"] });
  assert.deepEqual(plan.order, ["x", "b", "c", "z"]);
  assert.equal(tree.planDrop(items, { sourceGroup: tree.key(["B"]), targetGroup: tree.key(["B", "C"]) }), null);
  assert.equal(tree.planDrop(items, { sourceGroup: tree.key(["B"]), targetGroup: tree.key(["A", "D"]) }), null);
  const lifted = tree.planDrop(apply(items, plan), { sourceGroup: tree.key(["A", "B"]), targetGroup: tree.ROOT });
  assert.deepEqual(lifted.assignments, { b: ["B"], c: ["B", "C"] });
});

test("moving out keeps the remaining singleton and moving the last member removes empty groups", () => {
  const items = [item("a", ["A"]), item("b", ["A"])];
  const plan = tree.planDrop(items, { sourceId: "b", targetGroup: tree.ROOT });
  assert.deepEqual(plan.assignments, { b: [] });
  const next = apply(items, plan);
  assert.equal(tree.blocks(next)[0].events.length, 1);
  const emptied = apply(next, tree.planDrop(next, { sourceId: "a", targetGroup: tree.ROOT }));
  assert.ok(tree.blocks(emptied).every((block) => block.type === "item"));
});

test("rename isolates identical leaves under different parents and rejects sibling collision", () => {
  const items = [item("a", ["A", "Common", "Child"]), item("b", ["B", "Common"]), item("c", ["A", "Taken"])];
  assert.deepEqual(tree.rename(items, tree.key(["A", "Common"]), "New"), { a: ["A", "New", "Child"] });
  assert.equal(tree.rename(items, tree.key(["A", "Common"]), "Taken"), null);
});

test("node picker follows three groups while retaining stable IDs and literal slashes", () => {
  const result = editor.nextNodeChoices([{ id: "n", name: "Door", groupPath: ["A/B", "Town", "Room"] }]);
  assert.deepEqual(result, [{ id: "n", name: "Door", pickerPath: "A／B/Town/Room/Door" }]);
});
