"use strict";

(function exposeStateRuleContract(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStateRuleContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const RULE_TYPES = Object.freeze(["stat", "memory"]);
  const CONDITION_OPERATORS = Object.freeze({
    stat: Object.freeze([">", ">=", "<", "<=", "==", "!="]),
    memory: Object.freeze(["has", "not_has"]),
  });
  const EFFECT_OPERATORS = Object.freeze({
    stat: Object.freeze(["set", "+", "-", "*", "/"]),
    memory: Object.freeze(["add", "remove", "clear"]),
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

  function defaultEffect(type, { statId = "", memoryBank = "memory", tagId = "新標籤" } = {}) {
    const normalized = normalizeRuleType(type);
    if (normalized === "stat") {
      return statId ? { type: "stat", id: statId, op: "+", value: 0 } : null;
    }
    if (normalized === "memory") {
      return { type: "memory", bank: memoryBank || "memory", id: tagId, op: "add" };
    }
    return null;
  }

  function effectUsesId(type, operation) {
    const normalized = normalizeRuleType(type);
    return normalized === "stat" || (normalized === "memory" && operation !== "clear");
  }

  return {
    CONDITION_OPERATORS,
    EFFECT_OPERATORS,
    RULE_TYPES,
    conditionOperators,
    defaultCondition,
    defaultEffect,
    effectOperators,
    effectUsesId,
    normalizeRuleType,
  };
});
