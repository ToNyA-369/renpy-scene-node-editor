"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const settings = require("../../EDITOR/static/js/core/editor_settings.js");

test("editor settings expose one canonical tab and shortcut registry", () => {
  assert.deepEqual(settings.TAB_ORDER, ["node", "events", "options", "content", "stats", "graph", "validation"]);
  assert.deepEqual(Object.values(settings.TAB_SHORTCUT_ACTIONS), settings.TAB_ORDER);
  assert.equal(settings.DEFAULT_SHORTCUTS.tabGraph, "mod+6");
});

test("normalization clamps numeric values and preserves custom shortcuts", () => {
  const result = settings.normalizeEditorSettings({
    version: 8,
    autosave: false,
    autosaveDelay: 20,
    gridSize: 999,
    shortcuts: { save: "mod+shift+s" },
  });
  assert.equal(result.version, settings.SETTINGS_VERSION);
  assert.equal(result.autosave, false);
  assert.equal(result.autosaveDelay, 200);
  assert.equal(result.gridSize, 160);
  assert.equal(result.shortcuts.save, "mod+shift+s");
});

test("legacy Screen and Options-only shortcuts are removed", () => {
  const result = settings.normalizeEditorSettings({
    version: 4,
    shortcuts: {
      tabScreens: "mod+5",
      optionElements: "alt+1",
      optionInspector: "alt+2",
      optionFormMode: "alt+3",
      optionCanvasMode: "alt+4",
    },
  });
  assert.equal(Object.hasOwn(result.shortcuts, "tabScreens"), false);
  assert.equal(Object.hasOwn(result.shortcuts, "optionElements"), false);
  assert.equal(Object.hasOwn(result.shortcuts, "optionInspector"), false);
  assert.equal(Object.hasOwn(result.shortcuts, "optionFormMode"), false);
  assert.equal(Object.hasOwn(result.shortcuts, "optionCanvasMode"), false);
});

test("invalid settings fall back to a complete safe value", () => {
  const result = settings.normalizeEditorSettings([]);
  assert.equal(result.autosave, true);
  assert.equal(result.autosaveDelay, 700);
  assert.deepEqual(result.shortcuts, { ...settings.DEFAULT_SHORTCUTS });
});
