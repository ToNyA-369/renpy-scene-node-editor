"use strict";

(function exposeEventEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEventEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function choiceEntries(value) {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "string") return [[value, 1]];
    return Object.entries(value);
  }

  function removeWeightedChoice(value, index) {
    const entries = choiceEntries(value);
    entries.splice(Number(index), 1);
    return Object.fromEntries(entries);
  }

  function addWeightedChoice(value, choices, fallbackId) {
    const current = Object.fromEntries(choiceEntries(value));
    const id = choices.find((item) => !Object.hasOwn(current, item.id))?.id || fallbackId;
    current[id] = 1;
    return current;
  }

  function createEventEditor({
    contentPickerHtml,
    escapeHtml,
    memoryChoices,
    namedOptionTags,
    nodeChoices,
    numberValue,
    optionTags,
    stateRuleContract,
    statChoices,
  }) {
    const {
      RULE_TYPES,
      conditionOperators,
      defaultCondition,
      defaultEffect,
      effectOperators,
      effectUsesId,
      normalizeRuleType,
    } = stateRuleContract;

    function newRule(kind, type) {
      const settings = {
        statId: statChoices()[0]?.id,
        memoryBank: memoryChoices()[0]?.id || "memory",
      };
      return kind === "condition" ? defaultCondition(type, settings) : defaultEffect(type, settings);
    }

    function replaceRuleType(draft, kind, index, type) {
      const rule = newRule(kind, type);
      if (!rule) return false;
      const key = kind === "condition" ? "Conditions" : "Effects";
      draft[key][Number(index)] = rule;
      return true;
    }

    function conditionRowsHtml(conditions) {
      if (!conditions.length) return `<div class="row-empty">沒有條件，這個 Event 會作為無條件候選。</div>`;
      return conditions.map((condition, index) => {
        const type = normalizeRuleType(condition.type);
        const isMemory = type === "memory";
        return `
          <div class="repeat-row condition-row" data-index="${index}" data-condition-type="${escapeHtml(type)}">
            <label class="field"><span class="visually-hidden">類型</span><select name="conditionType" aria-label="條件類型">${optionTags(RULE_TYPES, type)}</select></label>
            ${isMemory ? `
              <label class="field"><span class="visually-hidden">記憶庫</span><select name="conditionBank" aria-label="記憶庫">${namedOptionTags(memoryChoices(), condition.bank || "memory")}</select></label>
              <label class="field"><span class="visually-hidden">記憶標籤</span><input name="conditionId" aria-label="記憶標籤" value="${escapeHtml(condition.id || "")}" placeholder="標籤"></label>
              <label class="field"><span class="visually-hidden">判斷</span><select name="conditionOp" aria-label="判斷">${optionTags(conditionOperators(type), condition.op)}</select></label>
            ` : `
              <label class="field"><span class="visually-hidden">Stat</span><select name="conditionId" aria-label="Stat">${namedOptionTags(statChoices(), condition.id)}</select></label>
              <label class="field"><span class="visually-hidden">判斷</span><select name="conditionOp" aria-label="判斷">${optionTags(conditionOperators(type), condition.op)}</select></label>
              <label class="field"><span class="visually-hidden">值</span><input name="conditionValue" aria-label="值" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}"></label>
            `}
            <button class="row-button" type="button" data-remove-condition="${index}" title="移除條件" aria-label="移除條件">×</button>
          </div>
        `;
      }).join("");
    }

    function effectRowsHtml(effects) {
      if (!effects.length) return `<div class="row-empty">尚未設定 Effect。</div>`;
      return effects.map((effect, index) => {
        const type = normalizeRuleType(effect.type);
        const isStat = type === "stat";
        const opItems = effectOperators(type);
        const valueField = isStat
          ? `<label class="field"><span class="visually-hidden">值</span><input name="effectValue" aria-label="值" type="number" step="any" value="${escapeHtml(effect.value ?? 0)}"></label>`
          : `<label class="field"><span class="visually-hidden">記憶標籤</span><input name="effectId" aria-label="記憶標籤" value="${escapeHtml(effect.id || "")}" placeholder="${effect.op === "clear" ? "清空整個記憶庫" : "標籤"}" ${effectUsesId(type, effect.op) ? "" : "disabled"}></label>`;
        const resourceField = isStat
          ? `<select name="effectId" aria-label="Stat">${namedOptionTags(statChoices(), effect.id)}</select>`
          : `<select name="effectBank" aria-label="記憶庫">${namedOptionTags(memoryChoices(), effect.bank || "memory")}</select>`;
        return `
          <div class="repeat-row effect-row" data-index="${index}" data-effect-type="${escapeHtml(type)}">
            <label class="field"><span class="visually-hidden">類型</span><select name="effectType" aria-label="效果類型">${optionTags(RULE_TYPES, type)}</select></label>
            <label class="field"><span class="visually-hidden">${isStat ? "Stat" : "記憶庫"}</span>${resourceField}</label>
            <label class="field"><span class="visually-hidden">操作</span><select name="effectOp" aria-label="操作">${optionTags(opItems, effect.op)}</select></label>
            ${valueField}
            <button class="row-button" type="button" data-remove-effect="${index}" title="移除 Effect" aria-label="移除 Effect">×</button>
          </div>
        `;
      }).join("");
    }

    function weightedRowsHtml(value, kind) {
      const rows = choiceEntries(value);
      if (!rows.length) return `<div class="row-empty">尚未加入權重項目。</div>`;
      const choices = kind === "content" ? [] : nodeChoices();
      return rows.map(([id, weight], index) => {
        const choiceControl = kind === "content"
          ? contentPickerHtml(id, index)
          : `<label class="field"><span class="visually-hidden">節點名稱</span><select name="nextWeightedId" aria-label="節點名稱">${namedOptionTags(choices, id)}</select></label>`;
        return `
          <div class="repeat-row weight-row ${kind === "content" ? "content-weight-row" : ""}" data-index="${index}">
            ${choiceControl}
            <label class="field"><span class="visually-hidden">Weight</span><input name="${kind}WeightedValue" aria-label="權重" type="number" min="0.0001" step="any" value="${escapeHtml(weight)}"></label>
            <button class="row-button" type="button" data-remove-weighted="${kind}:${index}" title="移除項目" aria-label="移除項目">×</button>
          </div>
        `;
      }).join("");
    }

    function choiceBlockHtml(value, kind) {
      const representation = typeof value === "string" ? "single" : "weighted";
      return `
        <div class="weighted-choice-table">
          <input name="${kind}Representation" type="hidden" value="${representation}">
          <div class="repeat-list">${weightedRowsHtml(value, kind)}</div>
        </div>
      `;
    }

    function readWeighted(form, kind) {
      const result = {};
      const ids = [...form.querySelectorAll(`[name="${kind}WeightedId"]`)];
      const weights = [...form.querySelectorAll(`[name="${kind}WeightedValue"]`)];
      ids.forEach((input, index) => {
        const id = input.value.trim();
        if (id) result[id] = numberValue(weights[index]?.value, 1);
      });
      return result;
    }

    function readChoice(form, kind) {
      const value = readWeighted(form, kind);
      const entries = Object.entries(value);
      if (!entries.length) return null;
      const representation = form.elements[`${kind}Representation`]?.value;
      if (representation === "single" && entries.length === 1 && entries[0][1] === 1) return entries[0][0];
      return value;
    }

    function readRules(form) {
      const conditions = [...form.querySelectorAll(".condition-row")].map((row) => {
        const type = row.querySelector('[name="conditionType"]').value;
        const result = {
          type,
          id: row.querySelector('[name="conditionId"]').value.trim(),
          op: row.querySelector('[name="conditionOp"]').value,
        };
        if (type === "stat") result.value = numberValue(row.querySelector('[name="conditionValue"]').value);
        if (type === "memory") result.bank = row.querySelector('[name="conditionBank"]').value;
        return result;
      });
      const effects = [...form.querySelectorAll(".effect-row")].map((row) => {
        const type = row.querySelector('[name="effectType"]').value;
        const result = { type, op: row.querySelector('[name="effectOp"]').value };
        if (type === "stat") {
          result.id = row.querySelector('[name="effectId"]').value.trim();
          result.value = numberValue(row.querySelector('[name="effectValue"]').value);
        } else if (type === "memory") {
          result.bank = row.querySelector('[name="effectBank"]').value;
          if (result.op !== "clear") result.id = row.querySelector('[name="effectId"]').value.trim();
        }
        return result;
      });
      return { conditions, effects };
    }

    return {
      choiceBlockHtml,
      conditionRowsHtml,
      effectRowsHtml,
      newRule,
      readChoice,
      readRules,
      replaceRuleType,
      weightedRowsHtml,
    };
  }

  return {
    addWeightedChoice,
    choiceEntries,
    createEventEditor,
    removeWeightedChoice,
  };
});
