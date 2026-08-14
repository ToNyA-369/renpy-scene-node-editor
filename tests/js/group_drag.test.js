"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const SceneGroupDrag = require("../../EDITOR/static/js/ui/group_drag.js");

test("group intent dwell is brief without becoming an accidental hover", () => {
  assert.equal(SceneGroupDrag.DEFAULT_DWELL_MS, 500);
});

test("dwelling one ungrouped item over another creates a unique group", () => {
  const items = [
    { id: "a", group: "Normal" },
    { id: "b", group: "Normal" },
    { id: "c", group: "New Group" },
  ];
  assert.deepEqual(SceneGroupDrag.planGroupDrop(items, {
    sourceId: "a",
    targetId: "b",
    newGroupName: "New Group",
  }), {
    assignments: { b: "New Group 2", a: "New Group 2" },
    destination: "New Group 2",
    createdGroup: "New Group 2",
    order: ["b", "a", "c"],
  });
});

test("moving out of a two-item group dissolves the singleton", () => {
  const items = [
    { id: "a", group: "Story" },
    { id: "b", group: "Story" },
    { id: "c", group: "Other" },
    { id: "d", group: "Other" },
  ];
  assert.deepEqual(SceneGroupDrag.planGroupDrop(items, {
    sourceId: "a",
    targetGroup: "Other",
  }), {
    assignments: { a: "Other", b: "Normal" },
    destination: "Other",
    createdGroup: null,
    order: ["b", "c", "d", "a"],
  });
});

test("semantic groups can retain a singleton when an item moves out", () => {
  const items = [
    { id: "a", group: "and_1" },
    { id: "b", group: "and_1" },
    { id: "c", group: "__or__" },
  ];
  assert.deepEqual(SceneGroupDrag.planReorder(items, {
    sourceId: "b",
    targetId: "c",
    targetGroup: "__or__",
    position: "before",
    defaultGroup: "__or__",
    dissolveSingleton: false,
  }), {
    assignments: { b: "__or__" },
    destination: "__or__",
    createdGroup: null,
    order: ["a", "b", "c"],
  });
});

test("dropping a grouped item onto an ungrouped item creates a new group and dissolves its source", () => {
  const items = [
    { id: "a", group: "Story" },
    { id: "b", group: "Story" },
    { id: "c", group: "Normal" },
  ];
  assert.deepEqual(SceneGroupDrag.planGroupDrop(items, {
    sourceId: "a",
    targetId: "c",
    newGroupName: "Group",
  }), {
    assignments: { c: "Group", a: "Group", b: "Normal" },
    destination: "Group",
    createdGroup: "Group",
    order: ["b", "c", "a"],
  });
});

test("a quick drop reorders and can move an item out of its group", () => {
  const items = [
    { id: "a", group: "Story" },
    { id: "b", group: "Story" },
    { id: "c", group: "Normal" },
    { id: "d", group: "Normal" },
  ];
  assert.deepEqual(SceneGroupDrag.planReorder(items, {
    sourceId: "a",
    targetId: "d",
    position: "before",
  }), {
    assignments: { a: "Normal", b: "Normal" },
    destination: "Normal",
    createdGroup: null,
    order: ["b", "c", "a", "d"],
  });
});

test("dropping on container whitespace appends within the same group", () => {
  const items = [
    { id: "a", group: "Normal" },
    { id: "b", group: "Story" },
    { id: "c", group: "Story" },
    { id: "d", group: "Normal" },
  ];
  assert.deepEqual(SceneGroupDrag.planReorder(items, {
    sourceId: "b",
    targetGroup: "Story",
  }).order, ["a", "c", "b", "d"]);
});

test("a loose-flow boundary can order beside a group without joining it", () => {
  const items = [
    { id: "a", group: "Other" },
    { id: "b", group: "Other" },
    { id: "c", group: "Story" },
    { id: "d", group: "Story" },
  ];
  assert.deepEqual(SceneGroupDrag.planReorder(items, {
    sourceId: "a",
    targetId: "c",
    targetGroup: "Normal",
    position: "before",
  }), {
    assignments: { a: "Normal", b: "Normal" },
    destination: "Normal",
    createdGroup: null,
    order: ["b", "a", "c", "d"],
  });
});

test("same-item and same-group drops are no-ops", () => {
  const items = [{ id: "a", group: "Story" }, { id: "b", group: "Story" }];
  assert.equal(SceneGroupDrag.planGroupDrop(items, { sourceId: "a", targetId: "a" }), null);
  assert.equal(SceneGroupDrag.planGroupDrop(items, { sourceId: "a", targetGroup: "Story" }), null);
});

test("an Event group moves as one stable block without changing membership", () => {
  const items = [
    { id: "a", group: "Story" },
    { id: "b", group: "Story" },
    { id: "c", group: "Normal" },
    { id: "d", group: "Other" },
    { id: "e", group: "Other" },
  ];
  assert.deepEqual(SceneGroupDrag.planGroupBlockReorder(items, {
    sourceGroup: "Story",
    targetId: "e",
    position: "after",
  }), {
    assignments: {},
    destination: "Story",
    createdGroup: null,
    order: ["c", "d", "e", "a", "b"],
  });
});

test("insertion hysteresis keeps a settled side until the pointer clearly crosses", () => {
  const rect = { top: 100, height: 50 };
  assert.equal(SceneGroupDrag.insertionPosition(124, rect), "before");
  assert.equal(SceneGroupDrag.insertionPosition(126, rect), "after");
  assert.equal(SceneGroupDrag.insertionPosition(130, rect, "before"), "before");
  assert.equal(SceneGroupDrag.insertionPosition(120, rect, "after"), "after");
  assert.equal(SceneGroupDrag.insertionPosition(140, rect, "before"), "after");
  assert.equal(SceneGroupDrag.insertionPosition(110, rect, "after"), "before");
});

test("edge auto-scroll accelerates smoothly and stays idle in the center", () => {
  assert.equal(SceneGroupDrag.edgeScrollDelta(200, 100, 500), 0);
  assert(SceneGroupDrag.edgeScrollDelta(110, 100, 500) < 0);
  assert(SceneGroupDrag.edgeScrollDelta(490, 100, 500) > 0);
  assert(Math.abs(SceneGroupDrag.edgeScrollDelta(100, 100, 500)) > Math.abs(SceneGroupDrag.edgeScrollDelta(140, 100, 500)));
});
