"use strict";

(function exposeEventEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEventEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_EVENT_GROUP = "Normal";
  const DEFAULT_CONDITION_CLAUSE = "and_1";
  const CONDITION_OR_GROUP = "__or__";
  const CONDITION_CLAUSE_GROUP_PREFIX = "clause:";

  function pickerSegment(value) {
    return String(value || "").replaceAll("/", "／");
  }

  function nextNodeChoices(nodes) {
    return (nodes || []).map((node) => {
      const id = String(node?.id || node?.path || "");
      const name = String(node?.name || node?.Name || id);
      const group = normalizeEventGroup(node?.group ?? node?.Group);
      return {
        id,
        name,
        pickerPath: group === DEFAULT_EVENT_GROUP
          ? ""
          : `${pickerSegment(group)}/${pickerSegment(name)}`,
      };
    });
  }

  function conditionDragGroup(clause) {
    const value = String(clause || "").trim();
    return value ? `${CONDITION_CLAUSE_GROUP_PREFIX}${value}` : CONDITION_OR_GROUP;
  }

  function conditionClauseFromDragGroup(group) {
    const value = String(group || "");
    if (value === CONDITION_OR_GROUP) return null;
    return value.startsWith(CONDITION_CLAUSE_GROUP_PREFIX)
      ? value.slice(CONDITION_CLAUSE_GROUP_PREFIX.length)
      : value;
  }

  function normalizeConditions(conditions) {
    const items = (conditions || []).map((condition) => ({ ...condition }));
    const legacy = items.length > 0 && items.every((condition) => !Object.hasOwn(condition, "clause"));
    return items.map((condition) => ({
      ...condition,
      clause: legacy ? DEFAULT_CONDITION_CLAUSE : (String(condition.clause || "").trim() || null),
    }));
  }

  function conditionBlocks(conditions) {
    const items = normalizeConditions(conditions);
    const grouped = new Map();
    items.forEach((condition, index) => {
      if (!condition.clause) return;
      if (!grouped.has(condition.clause)) grouped.set(condition.clause, []);
      grouped.get(condition.clause).push({ condition, index });
    });
    const emitted = new Set();
    const blocks = [];
    items.forEach((condition, index) => {
      if (!condition.clause) {
        blocks.push({ type: "condition", condition, index });
      } else if (!emitted.has(condition.clause)) {
        emitted.add(condition.clause);
        blocks.push({ type: "group", clause: condition.clause, items: grouped.get(condition.clause) || [] });
      }
    });
    return blocks;
  }

  function appendCondition(conditions, condition) {
    const items = normalizeConditions(conditions);
    const groupedClauses = [...new Set(items.map((item) => item.clause).filter(Boolean))];
    const looseCount = items.filter((item) => !item.clause).length;
    const onlyAndGroup = groupedClauses.length === 1 && looseCount === 0;
    return [...items, { ...condition, clause: items.length === 0
      ? DEFAULT_CONDITION_CLAUSE
      : onlyAndGroup ? groupedClauses[0] : null }];
  }

  function applyConditionPlan(conditions, plan) {
    const items = normalizeConditions(conditions);
    if (!plan) return items;
    const byId = new Map(items.map((condition, index) => [String(index), { ...condition }]));
    Object.entries(plan.assignments || {}).forEach(([id, group]) => {
      const condition = byId.get(String(id));
      if (condition) condition.clause = conditionClauseFromDragGroup(group);
    });
    return (plan.order || items.map((_item, index) => String(index)))
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
  }

  function planConditionDrop(groupDrag, conditions, { mode, sourceId, targetId, targetGroup, position }) {
    const items = normalizeConditions(conditions).map((condition, index) => ({
      id: String(index),
      group: conditionDragGroup(condition.clause),
    }));
    const settings = {
      sourceId,
      targetId,
      targetGroup,
      position,
      defaultGroup: CONDITION_OR_GROUP,
      dissolveSingleton: false,
    };
    let plan = mode === "group"
      ? groupDrag.planGroupDrop(items, { ...settings, newGroupName: "clause:and" })
      : groupDrag.planReorder(items, settings);
    if (!plan && mode === "group") plan = groupDrag.planReorder(items, settings);
    return plan;
  }

  function normalizeEventGroup(value) {
    return String(value || DEFAULT_EVENT_GROUP).trim() || DEFAULT_EVENT_GROUP;
  }

  function groupEvents(events) {
    const groups = new Map([[DEFAULT_EVENT_GROUP, []]]);
    (events || []).forEach((event) => {
      const group = normalizeEventGroup(event?.Group);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(event);
    });
    return [...groups.entries()]
      .sort(([left], [right]) => {
        if (left === DEFAULT_EVENT_GROUP) return -1;
        if (right === DEFAULT_EVENT_GROUP) return 1;
        return left.localeCompare(right);
      })
      .map(([name, items]) => ({ name, events: items }));
  }

  function eventPoolBlocks(events) {
    const ordered = events || [];
    const grouped = new Map();
    ordered.forEach((event) => {
      const group = normalizeEventGroup(event?.Group);
      if (group === DEFAULT_EVENT_GROUP) return;
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(event);
    });
    const emitted = new Set();
    const blocks = [];
    ordered.forEach((event) => {
      const group = normalizeEventGroup(event?.Group);
      if (group === DEFAULT_EVENT_GROUP) {
        blocks.push({ type: "item", event });
      } else if (!emitted.has(group)) {
        emitted.add(group);
        blocks.push({ type: "group", name: group, events: grouped.get(group) || [] });
      }
    });
    return blocks;
  }

  function choiceEntries(value) {
    if (value === null || value === undefined || value === "") return [];
    if (typeof value === "string") return [[value, 1]];
    return Object.entries(value);
  }

  function removeWeightedChoice(value, index) {
    const entries = choiceEntries(value);
    entries.splice(Number(index), 1);
    return entries.length ? Object.fromEntries(entries) : null;
  }

  function addWeightedChoice(value, choices, fallbackId) {
    const current = Object.fromEntries(choiceEntries(value));
    const id = choices.find((item) => !Object.hasOwn(current, item.id))?.id || fallbackId;
    current[id] = 1;
    return current;
  }

  function createEventEditor({
    contentPickerHtml,
    effectTypeChoices = () => stateRuleContract.EFFECT_TYPES,
    escapeHtml,
    memoryChoices,
    namedOptionTags,
    nodeChoices,
    numberValue,
    optionEffectChoices,
    optionEffectOptionTags,
    optionTags,
    stateRuleContract,
    statChoices,
  }) {
    const {
      CONDITION_TYPES,
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
        optionTarget: optionEffectChoices()[0]?.target || null,
      };
      return kind === "condition" ? defaultCondition(type, settings) : defaultEffect(type, settings);
    }

    function replaceRuleType(draft, kind, index, type) {
      const rule = newRule(kind, type);
      if (!rule) return false;
      const key = kind === "condition" ? "Conditions" : "Effects";
      if (kind === "condition") rule.clause = draft[key][Number(index)]?.clause ?? null;
      draft[key][Number(index)] = rule;
      return true;
    }

    function tr(key, params) {
      return typeof SceneI18n !== "undefined" ? SceneI18n.t(key, params) : key;
    }

    function conditionRowHtml(condition, index, { loose = false } = {}) {
        const type = normalizeRuleType(condition.type);
        const isMemory = type === "memory";
        return `
          <div class="repeat-row condition-row group-drag-item${loose ? " condition-logic-block" : ""}" data-event-nav-item data-index="${index}" data-condition-id="${index}" data-condition-clause="${escapeHtml(condition.clause || "")}" data-condition-type="${escapeHtml(type)}" aria-grabbed="false">
            <label class="field"><span class="visually-hidden">${tr("條件類型")}</span><select name="conditionType" aria-label="${tr("條件類型")}">${optionTags(CONDITION_TYPES, type)}</select></label>
            ${isMemory ? `
              <label class="field"><span class="visually-hidden">${tr("記憶庫")}</span><select name="conditionBank" aria-label="${tr("記憶庫")}">${namedOptionTags(memoryChoices(), condition.bank || "memory")}</select></label>
              <label class="field"><span class="visually-hidden">${tr("記憶標籤")}</span><input name="conditionId" data-memory-tag-input aria-label="${tr("記憶標籤")}" value="${escapeHtml(condition.id || "")}" placeholder="${tr("標籤")}"></label>
              <label class="field"><span class="visually-hidden">${tr("判斷")}</span><select name="conditionOp" aria-label="${tr("判斷")}">${optionTags(conditionOperators(type), condition.op)}</select></label>
            ` : `
              <label class="field"><span class="visually-hidden">Stat</span><select name="conditionId" aria-label="Stat">${namedOptionTags(statChoices(), condition.id)}</select></label>
              <label class="field"><span class="visually-hidden">${tr("判斷")}</span><select name="conditionOp" aria-label="${tr("判斷")}">${optionTags(conditionOperators(type), condition.op)}</select></label>
              <label class="field"><span class="visually-hidden">${tr("值")}</span><input name="conditionValue" aria-label="${tr("值")}" type="number" step="any" value="${escapeHtml(condition.value ?? 0)}"></label>
            `}
            <button class="row-button" type="button" data-remove-condition="${index}" title="${tr("移除條件")}" aria-label="${tr("移除條件")}">×</button>
          </div>
        `;
    }

    function conditionRowsHtml(conditions) {
      if (!conditions.length) return `<div class="row-empty">${tr("沒有條件，這個 Event 會作為無條件候選。")}</div>`;
      return conditionBlocks(conditions).map((block) => {
        if (block.type === "condition") return conditionRowHtml(block.condition, block.index, { loose: true });
        return `
          <section class="condition-and-group condition-logic-block" data-condition-group="${escapeHtml(block.clause)}">
            <div class="condition-and-header"><span>${tr("全部符合")}</span><strong>AND</strong></div>
            <div class="condition-group-items">${block.items.map(({ condition, index }) => conditionRowHtml(condition, index)).join("")}</div>
          </section>
        `;
      }).join("");
    }

    function effectRowsHtml(effects) {
      if (!effects.length) return `<div class="row-empty">${tr("尚未設定 Effect。")}</div>`;
      return effects.map((effect, index) => {
        const type = normalizeRuleType(effect.type);
        const isStat = type === "stat";
        const isOption = type === "option";
        const opItems = effectOperators(type);
        if (isOption) {
          return `
            <div class="repeat-row effect-row option-effect-row list-reorder-item" data-event-nav-item data-index="${index}" data-reorder-id="${index}" data-effect-type="${escapeHtml(type)}" aria-grabbed="false">
              <label class="field option-effect-type-field"><span class="visually-hidden">${tr("效果類型")}</span><select name="effectType" aria-label="${tr("效果類型")}">${optionTags(effectTypeChoices(), type)}</select></label>
              <label class="field option-effect-target-field"><span class="visually-hidden">${tr("Option 目標")}</span><select name="effectOptionTarget" aria-label="${tr("Option 目標")}">${optionEffectOptionTags(effect)}</select></label>
              <label class="field option-effect-operation-field"><span class="visually-hidden">${tr("操作")}</span><select name="effectOp" aria-label="${tr("操作")}">${optionTags(opItems, effect.op)}</select></label>
              <button class="row-button" type="button" data-remove-effect="${index}" title="${tr("移除 Effect")}" aria-label="${tr("移除 Effect")}">×</button>
            </div>
          `;
        }
        const valueField = isStat
          ? `<label class="field"><span class="visually-hidden">${tr("值")}</span><input name="effectValue" aria-label="${tr("值")}" type="number" step="any" value="${escapeHtml(effect.value ?? 0)}"></label>`
          : `<label class="field"><span class="visually-hidden">${tr("記憶標籤")}</span><input name="effectId" data-memory-tag-input aria-label="${tr("記憶標籤")}" value="${escapeHtml(effect.id || "")}" placeholder="${effect.op === "clear" ? tr("清空整個記憶庫") : tr("標籤")}" ${effectUsesId(type, effect.op) ? "" : "disabled"}></label>`;
        const resourceField = isStat
          ? `<select name="effectId" aria-label="Stat">${namedOptionTags(statChoices(), effect.id)}</select>`
          : `<select name="effectBank" aria-label="${tr("記憶庫")}">${namedOptionTags(memoryChoices(), effect.bank || "memory")}</select>`;
        return `
          <div class="repeat-row effect-row list-reorder-item" data-event-nav-item data-index="${index}" data-reorder-id="${index}" data-effect-type="${escapeHtml(type)}" aria-grabbed="false">
            <label class="field"><span class="visually-hidden">${tr("效果類型")}</span><select name="effectType" aria-label="${tr("效果類型")}">${optionTags(effectTypeChoices(), type)}</select></label>
            <label class="field"><span class="visually-hidden">${isStat ? "Stat" : tr("記憶庫")}</span>${resourceField}</label>
            <label class="field"><span class="visually-hidden">${tr("操作")}</span><select name="effectOp" aria-label="${tr("操作")}">${optionTags(opItems, effect.op)}</select></label>
            ${valueField}
            <button class="row-button" type="button" data-remove-effect="${index}" title="${tr("移除 Effect")}" aria-label="${tr("移除 Effect")}">×</button>
          </div>
        `;
      }).join("");
    }

    function weightedRowsHtml(value, kind) {
      const rows = choiceEntries(value);
      if (!rows.length) return `<div class="row-empty">${tr("尚未加入權重項目。")}</div>`;
      const choices = kind === "content" ? [] : nodeChoices();
      return rows.map(([id, weight], index) => {
        const choiceControl = kind === "content"
          ? contentPickerHtml(id, index)
          : `<label class="field"><span class="visually-hidden">${tr("節點名稱")}</span><select name="nextWeightedId" aria-label="${tr("節點名稱")}">${namedOptionTags(choices, id)}</select></label>`;
        return `
          <div class="repeat-row weight-row list-reorder-item ${kind === "content" ? "content-weight-row" : ""}" data-event-nav-item data-index="${index}" data-reorder-id="${index}" data-weighted-kind="${kind}" aria-grabbed="false">
            ${choiceControl}
            <label class="field"><span class="visually-hidden">Weight</span><input name="${kind}WeightedValue" aria-label="${tr("權重")}" type="number" min="0.0001" step="any" value="${escapeHtml(weight)}"></label>
            <button class="row-button" type="button" data-remove-weighted="${kind}:${index}" title="${tr("移除項目")}" aria-label="${tr("移除項目")}">×</button>
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
        result.clause = String(row.dataset?.conditionClause || "").trim() || null;
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
        } else if (type === "option") {
          const target = JSON.parse(row.querySelector('[name="effectOptionTarget"]').value);
          result.target = target.target;
          result.node = target.node;
          result.element = target.element;
          if (target.target === "item") result.item = target.item;
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
    CONDITION_OR_GROUP,
    DEFAULT_CONDITION_CLAUSE,
    DEFAULT_EVENT_GROUP,
    addWeightedChoice,
    appendCondition,
    applyConditionPlan,
    choiceEntries,
    conditionBlocks,
    conditionDragGroup,
    createEventEditor,
    eventPoolBlocks,
    groupEvents,
    normalizeEventGroup,
    normalizeConditions,
    nextNodeChoices,
    planConditionDrop,
    removeWeightedChoice,
  };
});
