"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const contract = require("../../EDITOR/static/js/core/state_rule_contract.js");

test("state rule contract publishes every Condition and Effect operation", () => {
  assert.deepEqual(contract.RULE_TYPES, ["stat", "memory"]);
  assert.deepEqual(contract.CONDITION_TYPES, ["stat", "memory"]);
  assert.deepEqual(contract.EFFECT_TYPES, ["stat", "memory", "option"]);
  assert.deepEqual(contract.conditionOperators("stat"), [">", ">=", "<", "<=", "==", "!="]);
  assert.deepEqual(contract.conditionOperators("memory"), ["has", "not_has"]);
  assert.deepEqual(contract.effectOperators("stat"), ["set", "+", "-", "*", "/"]);
  assert.deepEqual(contract.effectOperators("memory"), ["add", "remove", "clear"]);
  assert.deepEqual(contract.effectOperators("option"), ["enable", "disable"]);
});

test("legacy tag rules normalize to the Memory editor contract", () => {
  assert.equal(contract.normalizeRuleType("tag"), "memory");
  assert.deepEqual(contract.conditionOperators("tag"), ["has", "not_has"]);
  assert.deepEqual(contract.effectOperators("tag"), ["add", "remove", "clear"]);
});

test("default rules preserve the current saved JSON shapes", () => {
  assert.deepEqual(
    contract.defaultCondition("stat", { statId: "money" }),
    { type: "stat", id: "money", op: ">=", value: 0 },
  );
  assert.deepEqual(
    contract.defaultCondition("memory", { memoryBank: "daily" }),
    { type: "memory", bank: "daily", id: "新標籤", op: "has" },
  );
  assert.deepEqual(
    contract.defaultEffect("stat", { statId: "money" }),
    { type: "stat", id: "money", op: "+", value: 0 },
  );
  assert.deepEqual(
    contract.defaultEffect("memory", { memoryBank: "daily" }),
    { type: "memory", bank: "daily", id: "新標籤", op: "add" },
  );
  assert.deepEqual(
    contract.defaultEffect("option", {
      optionTarget: { target: "item", node: "shop", element: "actions", item: "buy" },
    }),
    { type: "option", op: "enable", target: "item", node: "shop", element: "actions", item: "buy" },
  );
  assert.equal(contract.defaultCondition("stat"), null);
  assert.equal(contract.defaultEffect("stat"), null);
  assert.equal(contract.defaultEffect("option"), null);
});

test("Memory clear is the only Effect form that omits an ID", () => {
  assert.equal(contract.effectUsesId("stat", "set"), true);
  assert.equal(contract.effectUsesId("memory", "add"), true);
  assert.equal(contract.effectUsesId("memory", "remove"), true);
  assert.equal(contract.effectUsesId("memory", "clear"), false);
});
