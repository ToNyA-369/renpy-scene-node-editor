"use strict";

(function exposeStateRuleContract(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStateRuleContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const CONDITION_TYPES = Object.freeze(["stat", "memory"]);
  const EFFECT_TYPES = Object.freeze(["stat", "memory", "option"]);
  const RULE_TYPES = CONDITION_TYPES;
  const NUMERIC_OPERATORS = Object.freeze(["+", "-", "*", "/", "%"]);
  const CONDITION_OPERATORS = Object.freeze({
    stat: Object.freeze([">", ">=", "<", "<=", "==", "!="]),
    memory: Object.freeze(["has", "not_has", "empty", "not_empty"]),
  });
  const EFFECT_OPERATORS = Object.freeze({
    stat: Object.freeze(["set", "+", "-", "*", "/"]),
    memory: Object.freeze(["add", "remove", "clear"]),
    option: Object.freeze(["enable", "disable"]),
  });

  function normalizeRuleType(value) {
    const type = String(value || "stat").toLocaleLowerCase();
    return type === "tag" ? "memory" : type;
  }

  function conditionOperators(type) {
    return CONDITION_OPERATORS[normalizeRuleType(type)] || [];
  }

  function effectOperators(type) {
    return EFFECT_OPERATORS[normalizeRuleType(type)] || [];
  }

  function defaultCondition(type, { statId = "", memoryBank = "memory", tagId = "新標籤" } = {}) {
    const normalized = normalizeRuleType(type);
    if (normalized === "stat") {
      return statId ? { type: "stat", id: statId, op: ">=", value: 0 } : null;
    }
    if (normalized === "memory") {
      return { type: "memory", bank: memoryBank || "memory", id: tagId, op: "has" };
    }
    return null;
  }

  function defaultEffect(type, { statId = "", memoryBank = "memory", tagId = "新標籤", optionTarget = null } = {}) {
    const normalized = normalizeRuleType(type);
    if (normalized === "stat") {
      return statId ? { type: "stat", id: statId, op: "+", value: 0 } : null;
    }
    if (normalized === "memory") {
      return { type: "memory", bank: memoryBank || "memory", id: tagId, op: "add" };
    }
    if (normalized === "option" && optionTarget) {
      const result = {
        type: "option",
        op: "enable",
        target: optionTarget.target,
        node: optionTarget.node,
        element: optionTarget.element,
      };
      if (optionTarget.target === "item") result.item = optionTarget.item;
      return result;
    }
    return null;
  }

  function effectUsesId(type, operation) {
    const normalized = normalizeRuleType(type);
    return normalized === "stat" || (normalized === "memory" && operation !== "clear");
  }

  function conditionUsesId(type, operation) {
    const normalized = normalizeRuleType(type);
    return normalized === "stat" || (normalized === "memory" && ["has", "not_has"].includes(operation));
  }

  return {
    CONDITION_OPERATORS,
    CONDITION_TYPES,
    EFFECT_OPERATORS,
    EFFECT_TYPES,
    RULE_TYPES,
    NUMERIC_OPERATORS,
    conditionOperators,
    conditionUsesId,
    defaultCondition,
    defaultEffect,
    effectOperators,
    effectUsesId,
    normalizeRuleType,
  };
});
