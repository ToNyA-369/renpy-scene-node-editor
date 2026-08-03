"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../../EDITOR/static/js/core/event_contract.js");

test("event contract publishes every supported trigger and End up mode", () => {
  assert.deepEqual(contract.EVENT_TRIGGER_MODES.map((item) => item.id), ["Auto", "Action", "Keyboard", "Mouse"]);
  assert.deepEqual(contract.AUTO_TRIGGER_CHOICES.map((item) => item.id), ["Auto:Enter", "Auto:Node", "Auto:Exit"]);
  assert.deepEqual(contract.END_UP_CHOICES, ["REDO", "GOTO", "REPLACE", "EXIT"]);
});

test("only GOTO and REPLACE require Next Node", () => {
  assert.equal(contract.endUpUsesNextNode("GOTO"), true);
  assert.equal(contract.endUpUsesNextNode("REPLACE"), true);
  assert.equal(contract.endUpUsesNextNode("EXIT"), false);
  assert.equal(contract.endUpUsesNextNode("REDO"), false);
});

test("trigger names preserve the saved Action contract while showing Option names", () => {
  assert.equal(contract.actionTriggerValue("查看房間"), "Action:查看房間");
  assert.equal(contract.actionTriggerName("Action:查看房間"), "查看房間");
  assert.equal(contract.eventTriggerMode("Action:查看房間"), "Action");
  assert.equal(contract.eventTriggerDisplayName("Action:查看房間"), "查看房間");
});

test("keyboard capture and display use Ren'Py keysyms", () => {
  const keysym = contract.keyboardKeysymFromEvent({
    code: "KeyK", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true,
  });
  assert.equal(keysym, "meta_shift_K_k");
  assert.equal(contract.keyboardKeysymDisplay(keysym, "MacIntel"), "⌘⇧K");
  assert.equal(contract.eventTriggerDisplayName("Mouse:WheelDown"), "滾輪向下");
});

test("On Enter and On Exit are lifecycle triggers while On Node remains interactive", () => {
  assert.equal(contract.isLifecycleTrigger("Auto:Enter"), true);
  assert.equal(contract.isLifecycleTrigger("Auto:Exit"), true);
  assert.equal(contract.isLifecycleTrigger("Auto:Node"), false);
});
