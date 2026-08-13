"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const graph = require("../../EDITOR/static/js/workspaces/graph_model.js");
const client = require("../../EDITOR/static/js/workspaces/graph_layout_client.js");

const nodes = [
  { id: "root", path: "root", name: "ROOT" },
  { id: "child", path: "child", name: "Child" },
];
const relationships = graph.relationships(nodes, [
  { source: "root", target: "child", endUp: "GOTO" },
]);

test("graph topology signatures include the configured root", () => {
  assert.notEqual(
    client.signature(nodes, relationships, "root"),
    client.signature(nodes, relationships, "child"),
  );
});

test("graph computation falls back safely and returns a compact layout", async () => {
  const task = client.createTask(nodes, relationships, "root", {
    model: graph,
    WorkerConstructor: null,
    schedule: (callback) => callback(),
  });
  const result = await task.layoutPromise;

  assert.equal(result.source, "main-thread-fallback");
  assert.equal(result.layout.positions.size, nodes.length);
  assert.equal(result.layout.hierarchyDepths, undefined);
  assert.equal(await task.diagnosticsPromise, 0);
});

test("a pending graph computation can be cancelled without running fallback work", async () => {
  const scheduled = [];
  const task = client.createTask(nodes, relationships, "root", {
    model: graph,
    WorkerConstructor: null,
    schedule: (callback) => scheduled.push(callback),
  });
  task.cancel();

  await assert.rejects(task.layoutPromise, (error) => error.name === "AbortError");
  assert.equal(await task.diagnosticsPromise, null);
  scheduled.forEach((callback) => callback());
});
