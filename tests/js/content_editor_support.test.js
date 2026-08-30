"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const support = require("../../EDITOR/static/js/workspaces/content_editor_support.js");

test("official snippets are normalized for four-space Ren'Py indentation", () => {
  const snippets = support.normalizeSnippets({
    Label: { prefix: ["label", "lbl"], body: ["label ${1:name}:", "\t$0"], description: "A label" },
  });

  assert.deepEqual(snippets.map((item) => item.label), ["label", "lbl"]);
  assert.equal(snippets[0].insertText, "label ${1:name}:\n    $0");
  assert.equal(snippets[0].documentation, "A label");
});

test("completion context distinguishes labels, assets, and ordinary code", () => {
  assert.equal(support.completionContext("    jump ending"), "label");
  assert.equal(support.completionContext('    play music "audio/'), "audio");
  assert.equal(support.completionContext("    show eileen happy"), "image");
  assert.equal(support.completionContext("    $ scene_"), "general");
});

test("project completions keep stable references and remove duplicates", () => {
  const labels = support.projectSuggestions("label", {
    labels: [{ id: "arrival", name: "Arrival" }, "arrival", "ending"],
  });
  assert.deepEqual(labels.map((item) => item.insertText), ["arrival", "ending"]);

  const images = support.projectSuggestions("image", { images: ["images/bg/room.webp"] });
  assert.equal(images[0].insertText, "images bg room");

  const general = support.projectSuggestions("general", {});
  assert.deepEqual(general.map((item) => item.label), [
    "scene_get_stat",
    "scene_change_stat",
    "scene_current_node_id",
    "scene_current_node_name",
    "scene_memory_has",
    "scene_memory_tags",
    "scene_memory_add",
    "scene_memory_remove",
    "scene_memory_clear",
  ]);
  assert.ok(general.find((item) => item.label === "scene_change_stat").detail.includes("prefer Event Effects"));
  assert.ok(!general.some((item) => item.label === "scene_apply_stat_effect"));
});
