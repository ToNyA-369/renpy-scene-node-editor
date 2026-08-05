"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const graph = require("../../EDITOR/static/js/workspaces/graph_model.js");

const nodes = [
  { id: "parent", name: "Parent" },
  { id: "child_a", name: "Child A" },
  { id: "child_b", name: "Child B" },
];

test("graph model groups direct GOTO and REPLACE references", () => {
  const result = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open" },
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open_again" },
    { source: "child_a", target: "child_b", endUp: "REPLACE", eventId: "swap" },
  ]);
  const goto = result.find((item) => item.source === "parent" && item.target === "child_a" && item.endUp === "GOTO");
  const replace = result.find((item) => item.source === "child_a" && item.target === "child_b" && item.endUp === "REPLACE");
  assert.equal(goto.events.length, 2);
  assert.equal(replace.events.length, 1);
});

test("REPLACE derives a parent-to-target management relationship without changing data", () => {
  const sourceEdges = [
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open" },
    { source: "child_a", target: "child_b", endUp: "REPLACE", eventId: "swap" },
  ];
  const result = graph.relationships(nodes, sourceEdges);
  const management = result.find((item) => item.endUp === "MANAGEMENT");
  assert.equal(management.source, "parent");
  assert.equal(management.target, "child_b");
  assert.equal(management.events[0].replacedNode, "child_a");
  assert.equal(Object.hasOwn(sourceEdges[1], "replacedNode"), false);
});

test("global GOTO edges do not establish static parent management", () => {
  const result = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO", scope: "global" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  assert.equal(result.some((item) => item.endUp === "MANAGEMENT"), false);
});

test("layout keeps the configured root in the first column", () => {
  const relationships = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(nodes, relationships, "parent");
  assert.ok(layout.positions.get("parent").x < layout.positions.get("child_a").x);
  assert.ok(layout.positions.get("parent").x < layout.positions.get("child_b").x);
});

test("edge paths reserve a distinct lane for REPLACE and management edges", () => {
  const layout = { nodeWidth: 190, nodeHeight: 72 };
  const source = { x: 0, y: 0 };
  const target = { x: 320, y: 0 };
  assert.notEqual(graph.edgePath(source, target, layout, 0, "GOTO"), graph.edgePath(source, target, layout, 0, "REPLACE"));
  assert.notEqual(graph.edgePath(source, target, layout, 0, "REPLACE"), graph.edgePath(source, target, layout, 0, "MANAGEMENT"));
});
