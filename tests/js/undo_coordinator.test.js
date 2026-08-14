"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createUndoCoordinator, isNativeUndoTarget } = require("../../EDITOR/static/js/core/undo_coordinator.js");

function target({ field = null, editable = false, monaco = false } = {}) {
  return {
    closest(selector) {
      if (selector.includes("contenteditable") || selector.includes("monaco-editor")) {
        return editable || monaco ? {} : null;
      }
      if (!field) return null;
      if (selector === "input, textarea") return field;
      return null;
    },
  };
}

test("native text editors retain their own undo stack", () => {
  assert.equal(isNativeUndoTarget(target({ field: { tagName: "TEXTAREA" } })), true);
  assert.equal(isNativeUndoTarget(target({ field: { tagName: "INPUT", type: "text" } })), true);
  assert.equal(isNativeUndoTarget(target({ editable: true })), true);
  assert.equal(isNativeUndoTarget(target({ monaco: true })), true);
  assert.equal(isNativeUndoTarget(target({ field: { tagName: "INPUT", type: "checkbox" } })), false);
  assert.equal(isNativeUndoTarget(target()), false);
});

test("undo flushes, restores, and refreshes in one serialized operation", async () => {
  const calls = [];
  const states = [];
  const coordinator = createUndoCoordinator({
    flush: async () => { calls.push("flush"); return true; },
    hasUnsaved: () => false,
    requestUndo: async () => { calls.push("undo"); },
    refresh: async () => { calls.push("refresh"); },
    onState: (...args) => states.push(args),
    onError: () => assert.fail("undo should not fail"),
  });

  assert.equal(await coordinator.undo(), true);
  assert.deepEqual(calls, ["flush", "undo", "refresh"]);
  assert.equal(states.at(-1)[0], "已返回上一步");
});

test("undo does not call the server when pending data cannot be flushed", async () => {
  let requested = false;
  let failure = null;
  const coordinator = createUndoCoordinator({
    flush: async () => false,
    hasUnsaved: () => true,
    requestUndo: async () => { requested = true; },
    refresh: async () => {},
    onState: () => {},
    onError: (error) => { failure = error; },
  });

  assert.equal(await coordinator.undo(), false);
  assert.equal(requested, false);
  assert.equal(failure.message, "儲存失敗");
});
