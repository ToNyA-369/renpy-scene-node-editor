"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const SceneEventEditor = require("../../EDITOR/static/js/workspaces/event_editor.js");
const SceneGroupDrag = require("../../EDITOR/static/js/ui/group_drag.js");
const stateRuleContract = require("../../EDITOR/static/js/core/state_rule_contract.js");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function optionTags(items, current) {
  return items.map((item) => `<option${String(item) === String(current) ? " selected" : ""}>${item}</option>`).join("");
}

function namedOptionTags(items, current) {
  return items.map((item) => `<option value="${item.id}"${item.id === current ? " selected" : ""}>${item.name}</option>`).join("");
}

function createEditor({ stats = [{ id: "money", name: "Money" }], effectTypes } = {}) {
  const optionTargets = [{
    target: { target: "item", node: "shop", element: "actions", item: "buy" },
    value: JSON.stringify({ target: "item", node: "shop", element: "actions", item: "buy" }),
  }];
  return SceneEventEditor.createEventEditor({
    contentPickerHtml: (id, index) => `<content-picker data-id="${id}" data-index="${index}"></content-picker>`,
    effectTypeChoices: () => effectTypes || stateRuleContract.EFFECT_TYPES,
    escapeHtml,
    memoryChoices: () => [{ id: "memory", name: "Memory" }, { id: "daily", name: "Daily" }],
    namedOptionTags,
    nodeChoices: () => [{ id: "root", name: "Root" }, { id: "branch", name: "Branch" }],
    numberValue: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    optionEffectChoices: () => optionTargets,
    optionEffectOptionTags: (effect) => `<option value='${JSON.stringify({ target: effect.target, node: effect.node, element: effect.element, item: effect.item })}'>Buy</option>`,
    optionTags,
    stateRuleContract,
    statChoices: () => stats,
  });
}

function fakeRow(values, clause = "") {
  return {
    dataset: { conditionClause: clause },
    querySelector(selector) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      if (!Object.hasOwn(values, name)) throw new Error(`Unexpected field: ${name}`);
      return { value: String(values[name]) };
    },
  };
}

test("weighted Event choices preserve string and map representations", () => {
  const editor = createEditor();
  const singleForm = {
    elements: { contentRepresentation: { value: "single" } },
    querySelectorAll(selector) {
      if (selector.includes("contentWeightedId")) return [{ value: "intro" }];
      if (selector.includes("contentWeightedValue")) return [{ value: "1" }];
      return [];
    },
  };
  const weightedForm = {
    elements: { nextRepresentation: { value: "weighted" } },
    querySelectorAll(selector) {
      if (selector.includes("nextWeightedId")) return [{ value: "root" }, { value: "branch" }];
      if (selector.includes("nextWeightedValue")) return [{ value: "1" }, { value: "2.5" }];
      return [];
    },
  };

  assert.equal(editor.readChoice(singleForm, "content"), "intro");
  assert.deepEqual(editor.readChoice(weightedForm, "next"), { root: 1, branch: 2.5 });
  assert.deepEqual(SceneEventEditor.choiceEntries("intro"), [["intro", 1]]);
  assert.deepEqual(SceneEventEditor.removeWeightedChoice({ root: 1, branch: 2 }, 0), { branch: 2 });
  assert.equal(SceneEventEditor.removeWeightedChoice("show_intro", 0), null);
  assert.deepEqual(
    SceneEventEditor.addWeightedChoice("root", [{ id: "root" }, { id: "branch" }], "missingNode"),
    { root: 1, branch: 1 },
  );
});

test("Next Node choices mirror Node authoring groups without changing stable IDs", () => {
  assert.deepEqual(SceneEventEditor.nextNodeChoices([
    { id: "root", name: "起點" },
    { id: "market", name: "商店／白天", group: "探索/城鎮" },
    { path: "inn", name: "旅店", group: "探索/城鎮" },
  ]), [
    { id: "root", name: "起點", pickerPath: "" },
    { id: "market", name: "商店／白天", pickerPath: "探索／城鎮/商店／白天" },
    { id: "inn", name: "旅店", pickerPath: "探索／城鎮/旅店" },
  ]);
});

test("Event groups keep Normal first and preserve flat Event order", () => {
  const events = [
    { ID: "b", Group: "Story" },
    { ID: "a" },
    { ID: "d", Group: "Story" },
    { ID: "c", Group: "System" },
    { ID: "e", Group: "   " },
  ];

  assert.deepEqual(SceneEventEditor.groupEvents(events), [
    { name: "Normal", events: [events[1], events[4]] },
    { name: "Story", events: [events[0], events[2]] },
    { name: "System", events: [events[3]] },
  ]);
  assert.equal(SceneEventEditor.normalizeEventGroup(null), "Normal");
  assert.equal(SceneEventEditor.normalizeEventGroup("  Story  "), "Story");
});

test("Event pool blocks keep loose items at their ordered positions", () => {
  const events = [
    { ID: "a" },
    { ID: "b", Group: "Story" },
    { ID: "c", Group: "Story" },
    { ID: "d" },
  ];
  assert.deepEqual(SceneEventEditor.eventPoolBlocks(events), [
    { type: "item", event: events[0] },
    { type: "group", name: "Story", events: [events[1], events[2]] },
    { type: "item", event: events[3] },
  ]);
});

test("legacy Conditions become one AND clause while later additions follow branch intent", () => {
  const legacy = [
    { type: "stat", id: "money", op: ">=", value: 10 },
    { type: "memory", bank: "memory", id: "member", op: "has" },
  ];
  const normalized = SceneEventEditor.normalizeConditions(legacy);
  assert.deepEqual(normalized.map((item) => item.clause), ["and_1", "and_1"]);
  assert.equal(SceneEventEditor.conditionBlocks(normalized)[0].type, "group");

  const addedToDefault = SceneEventEditor.appendCondition(normalized, { type: "stat", id: "phase" });
  assert.equal(addedToDefault[2].clause, "and_1");
  const withOr = SceneEventEditor.applyConditionPlan(addedToDefault, {
    assignments: { 2: SceneEventEditor.CONDITION_OR_GROUP },
    order: ["0", "1", "2"],
  });
  const addedAsOr = SceneEventEditor.appendCondition(withOr, { type: "stat", id: "hour" });
  assert.equal(addedAsOr[2].clause, null);
  assert.equal(addedAsOr[3].clause, null);
});

test("Condition clause plans preserve a one-item AND group", () => {
  const conditions = [
    { type: "stat", id: "a", clause: "and_1" },
    { type: "stat", id: "b", clause: "and_1" },
    { type: "stat", id: "c", clause: null },
  ];
  const moved = SceneEventEditor.applyConditionPlan(conditions, {
    assignments: { 1: SceneEventEditor.CONDITION_OR_GROUP },
    order: ["0", "1", "2"],
  });
  assert.equal(moved[0].clause, "and_1");
  assert.equal(moved[1].clause, null);
});

test("a long dwell inside the same AND group still reorders", () => {
  const conditions = [
    { type: "stat", id: "a", clause: "and_1" },
    { type: "stat", id: "b", clause: "and_1" },
  ];
  const plan = SceneEventEditor.planConditionDrop(SceneGroupDrag, conditions, {
    mode: "group",
    sourceId: "1",
    targetId: "0",
    targetGroup: SceneEventEditor.conditionDragGroup("and_1"),
    position: "before",
  });
  assert.deepEqual(plan.order, ["1", "0"]);
  assert.deepEqual(plan.assignments, {});
});

test("Condition and Effect DOM values map to the stable Event JSON contract", () => {
  const editor = createEditor();
  const conditions = [
    fakeRow({ conditionType: "stat", conditionId: "money", conditionOp: ">=", conditionValue: "12" }),
    fakeRow({ conditionType: "memory", conditionBank: "daily", conditionId: "visited", conditionOp: "not_has" }),
  ];
  const effects = [
    fakeRow({ effectType: "stat", effectId: "money", effectOp: "+", effectValue: "3" }),
    fakeRow({ effectType: "memory", effectBank: "daily", effectOp: "clear" }),
    fakeRow({
      effectType: "option",
      effectOp: "enable",
      effectOptionTarget: JSON.stringify({ target: "item", node: "shop", element: "actions", item: "buy" }),
    }),
  ];
  const form = {
    querySelectorAll(selector) {
      if (selector === ".condition-row") return conditions;
      if (selector === ".effect-row") return effects;
      return [];
    },
  };

  assert.deepEqual(editor.readRules(form), {
    conditions: [
      { type: "stat", id: "money", op: ">=", value: 12, clause: null },
      { type: "memory", id: "visited", op: "not_has", bank: "daily", clause: null },
    ],
    effects: [
      { type: "stat", op: "+", id: "money", value: 3 },
      { type: "memory", op: "clear", bank: "daily" },
      { type: "option", op: "enable", target: "item", node: "shop", element: "actions", item: "buy" },
    ],
  });
});

test("rule type changes use centralized defaults and fail safely without a Stat", () => {
  const draft = { Conditions: [{ type: "memory" }], Effects: [{ type: "stat" }] };
  const editor = createEditor();
  assert.equal(editor.replaceRuleType(draft, "condition", 0, "stat"), true);
  assert.deepEqual(draft.Conditions[0], { type: "stat", id: "money", op: ">=", value: 0, clause: null });
  assert.equal(editor.replaceRuleType(draft, "effect", 0, "memory"), true);
  assert.deepEqual(draft.Effects[0], { type: "memory", bank: "memory", id: "新標籤", op: "add" });
  assert.equal(editor.replaceRuleType(draft, "effect", 0, "option"), true);
  assert.deepEqual(draft.Effects[0], {
    type: "option", op: "enable", target: "item", node: "shop", element: "actions", item: "buy",
  });

  const noStatsEditor = createEditor({ stats: [] });
  assert.equal(noStatsEditor.replaceRuleType(draft, "condition", 0, "stat"), false);
});

test("Event row rendering keeps current selectors and Memory clear semantics", () => {
  const editor = createEditor();
  const conditionHtml = editor.conditionRowsHtml([
    { type: "memory", bank: "daily", id: "visited", op: "not_has" },
  ]);
  const effectHtml = editor.effectRowsHtml([
    { type: "memory", bank: "daily", op: "clear" },
    { type: "option", op: "disable", target: "item", node: "shop", element: "actions", item: "buy" },
  ]);
  const contentHtml = editor.choiceBlockHtml("intro", "content");

  assert.match(conditionHtml, /data-condition-type="memory"/);
  assert.match(conditionHtml, /name="conditionBank"/);
  assert.match(conditionHtml, /name="conditionId" data-memory-tag-input/);
  assert.match(effectHtml, /data-effect-type="memory"/);
  assert.match(effectHtml, /name="effectId" data-memory-tag-input[^>]*disabled/);
  assert.match(effectHtml, /data-effect-type="option"/);
  assert.match(effectHtml, /name="effectOptionTarget"/);
  assert.match(effectHtml, /option-effect-operation-field/);
  assert.doesNotMatch(effectHtml, /effect-option-spacer/);
  assert.match(contentHtml, /name="contentRepresentation"[^>]*value="single"/);
  assert.match(contentHtml, /<content-picker data-id="intro" data-index="0">/);
});

test("Event Effect choices honor a caller-provided restricted type list", () => {
  const editor = createEditor({ effectTypes: ["stat", "memory"] });
  const effectHtml = editor.effectRowsHtml([
    { type: "stat", id: "money", op: "+", value: 1 },
  ]);

  assert.match(effectHtml, /<option selected>stat<\/option>/);
  assert.match(effectHtml, /<option>memory<\/option>/);
  assert.doesNotMatch(effectHtml, /<option>option<\/option>/);
});
