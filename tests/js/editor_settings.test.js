"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const settings = require("../../EDITOR/static/js/core/editor_settings.js");

test("editor settings expose one canonical tab and shortcut registry", () => {
  assert.deepEqual(settings.TAB_ORDER, ["node", "events", "options", "content", "stats", "graph", "validation"]);
  assert.deepEqual(Object.values(settings.TAB_SHORTCUT_ACTIONS), settings.TAB_ORDER);
  assert.equal(settings.DEFAULT_SHORTCUTS.tabGraph, "mod+6");
  assert.equal(settings.DEFAULT_SHORTCUTS.undo, "mod+z");
  assert.equal(settings.DEFAULT_SHORTCUTS.delete, "mod+backspace");
});

test("normalization clamps numeric values and preserves language and custom shortcuts", () => {
  const result = settings.normalizeEditorSettings({
    version: 8,
    language: "en",
    autosave: false,
    autosaveDelay: 20,
    gridSize: 999,
    shortcuts: { save: "mod+shift+s" },
  });
  assert.equal(result.version, settings.SETTINGS_VERSION);
  assert.equal(result.language, "en");
  assert.equal(result.autosave, false);
  assert.equal(result.autosaveDelay, 200);
  assert.equal(result.gridSize, 160);
  assert.equal(result.shortcuts.save, "mod+shift+s");
  assert.deepEqual(result.tabOrder, settings.TAB_ORDER);
});

test("workspace tab order keeps valid creator order and appends missing tabs", () => {
  assert.deepEqual(
    settings.normalizeTabOrder(["graph", "node", "graph", "unknown", "events"]),
    ["graph", "node", "events", "options", "content", "stats", "validation"],
  );
  assert.deepEqual(
    settings.normalizeEditorSettings({ version: 11, tabOrder: ["content", "node"] }).tabOrder,
    ["content", "node", "events", "options", "stats", "graph", "validation"],
  );
});

test("invalid or missing language falls back to zh-Hant", () => {
  const result1 = settings.normalizeEditorSettings({ language: "invalid-lang" });
  assert.equal(result1.language, "zh-Hant");

  const result2 = settings.normalizeEditorSettings({});
  assert.equal(result2.language, "zh-Hant");
});

test("the new undo default does not steal an existing custom shortcut", () => {
  const result = settings.normalizeEditorSettings({
    version: 9,
    shortcuts: { save: "mod+z" },
  });
  assert.equal(result.shortcuts.save, "mod+z");
  assert.equal(result.shortcuts.undo, "");
});

test("the new delete default does not steal an existing custom shortcut", () => {
  const result = settings.normalizeEditorSettings({
    version: 10,
    shortcuts: { create: "mod+backspace" },
  });
  assert.equal(result.shortcuts.create, "mod+backspace");
  assert.equal(result.shortcuts.delete, "");
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
  assert.equal(result.version, 12);
  assert.equal(result.language, "zh-Hant");
  assert.equal(result.autosave, true);
  assert.equal(result.autosaveDelay, 700);
  assert.deepEqual(result.tabOrder, settings.TAB_ORDER);
  assert.deepEqual(result.shortcuts, { ...settings.DEFAULT_SHORTCUTS });
});
