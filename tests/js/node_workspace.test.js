"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createController,
  createViewModel,
  groupConnections,
  registeredMemoryTags,
  renderHtml,
} = require("../../EDITOR/static/js/workspaces/node_workspace.js");

test("node overview groups repeated flow links without changing their direction", () => {
  const edges = [
    { source: "root", target: "child", endUp: "GOTO" },
    { source: "root", target: "child", endUp: "GOTO" },
    { source: "root", target: "child", endUp: "REPLACE" },
  ];
  assert.deepEqual(groupConnections(edges, "out"), [
    { relatedNode: "child", endUp: "GOTO", count: 2 },
    { relatedNode: "child", endUp: "REPLACE", count: 1 },
  ]);
  assert.deepEqual(groupConnections(edges, "in")[0], {
    relatedNode: "root", endUp: "GOTO", count: 2,
  });
});

test("node overview derives metrics, names, and lifecycle counts from project state", () => {
  const model = createViewModel({
    detail: {
      node: { ID: "branch", Name: "Branch" },
      events: [
        { data: { Trigger: "Auto:Enter" } },
        { data: { Trigger: "Auto:Node" } },
        { data: { Trigger: "Auto:Node" } },
      ],
      options: { Elements: [{}, {}] },
      contents: [{ labels: ["a", "b"] }, { labels: ["c"] }],
    },
    rootNodeId: "root",
    nodes: [{ id: "root", name: "Start" }, { id: "child", name: "Result" }],
    graph: { edges: [
      { source: "root", target: "branch", endUp: "GOTO" },
      { source: "branch", target: "child", endUp: "REPLACE" },
    ] },
  });
  assert.equal(model.eventCount, 3);
  assert.equal(model.optionsCount, 2);
  assert.equal(model.labelCount, 3);
  assert.equal(model.flowLinkCount, 1);
  assert.deepEqual(model.lifecycle, { enter: 1, node: 2, exit: 0 });
  assert.equal(model.incomingConnections[0].name, "Start");
  assert.equal(model.outgoingConnections[0].name, "Result");
});

test("node overview groups registered Memory Tags by creator-facing bank", () => {
  const events = [
    {
      Effects: [
        { type: "memory", bank: "memory", id: "key_found", op: "add" },
        { type: "memory", bank: "chapter", id: "intro_seen", op: "add" },
        { type: "memory", bank: "memory", id: "key_found", op: "add" },
        { type: "memory", bank: "memory", id: "not_registered", op: "remove" },
      ],
    },
    { Effects: [{ type: "tag", id: "legacy_tag", op: "add" }] },
  ];
  assert.deepEqual(registeredMemoryTags(events, {
    memory: { Name: "Memory" },
    chapter: { Name: "章節記錄" },
  }), [
    { id: "memory", name: "Memory", tags: ["key_found", "legacy_tag"] },
    { id: "chapter", name: "章節記錄", tags: ["intro_seen"] },
  ]);

  const html = renderHtml(createViewModel({
    detail: { node: { ID: "branch", Name: "Branch" }, events: events.map((data) => ({ data })) },
    memories: { memory: { Name: "Memory" }, chapter: { Name: "章節記錄" } },
  }));
  assert.match(html, /<strong>Registered Tags<\/strong>/);
  assert.match(html, /章節記錄/);
  assert.doesNotMatch(html, /<small>chapter<\/small>/);
  assert.match(html, /intro_seen/);
  assert.doesNotMatch(html, /not_registered/);
});

test("node template preserves root safety, global scope, and escaped creator names", () => {
  const root = createViewModel({
    detail: { node: { ID: "root", Name: "<Start>" } },
    rootNodeId: "root",
  });
  const rootHtml = renderHtml(root);
  assert.match(rootHtml, /value="&lt;Start&gt;"/);
  assert.match(rootHtml, />ROOT</);
  assert.match(rootHtml, /deleteNodeButton[^>]+disabled/);
  assert.doesNotMatch(rootHtml, /setRootNodeButton/);

  const globalHtml = renderHtml(createViewModel({
    detail: { node: { ID: "__global__", Name: "Global" }, isGlobal: true },
    isGlobal: true,
  }));
  assert.match(globalHtml, />GLOBAL</);
  assert.doesNotMatch(globalHtml, /deleteNodeButton|setRootNodeButton/);
});

test("node controller binds authoring callbacks only when a node exists", () => {
  const listeners = [];
  const form = { addEventListener: (type) => listeners.push(`form:${type}`) };
  const controls = {
    "#nodeForm": form,
    "#setRootNodeButton": { addEventListener: (type) => listeners.push(`root:${type}`) },
    "#deleteNodeButton": { addEventListener: (type) => listeners.push(`delete:${type}`) },
  };
  const panel = {
    innerHTML: "",
    querySelector: (selector) => controls[selector] || null,
  };
  const controller = createController({ panel });
  controller.render({ detail: null });
  assert.equal(panel.innerHTML, "");
  assert.deepEqual(listeners, []);

  controller.render({ detail: { node: { ID: "child", Name: "Child" } } });
  assert.deepEqual(listeners, ["form:submit", "form:input", "form:change", "root:click", "delete:click"]);
});
