"use strict";

// A numeric value is a literal, a Stat reference, or one binary calculation.
const SceneNumericField = (() => {
  function modeOf(value) {
    return value && typeof value === "object" ? value.type : "number";
  }

  function switchSource(value, mode, statId = "") {
    const leaf = modeOf(value) === "calc" ? value.left : value;
    if (mode === "calc") return { type: "calc", op: "+", left: leaf, right: 0 };
    if (mode === "stat") return modeOf(leaf) === "stat" ? leaf : { type: "stat", id: statId };
    return typeof leaf === "number" ? leaf : 0;
  }

  function create({ escapeHtml, namedOptionTags, statChoices, operators, tr }) {
    function render(value, name, label, allowCalculation = true) {
      const mode = modeOf(value);
      const choices = [["number", tr("固定值"), "123"], ["stat", "Stat", "Stat"]];
      if (allowCalculation) choices.push(["calc", tr("簡單運算"), "ƒx"]);
      const source = `<label class="field numeric-source type-badge"><span class="visually-hidden">${escapeHtml(label)} ${tr("數值來源")}</span><select name="${name}Source" data-numeric-source data-type-badge aria-label="${escapeHtml(label)} ${tr("數值來源")}">${choices.map(([id, text, compact]) => `<option value="${id}" data-picker-label="${compact}"${mode === id ? " selected" : ""}${id === "stat" && !statChoices().length ? " disabled" : ""}>${text}</option>`).join("")}</select></label>`;
      let control;
      if (mode === "calc") {
        control = `<div class="numeric-calculation">${render(value.left, `${name}Left`, tr("左運算元"), false)}<label class="field numeric-operator"><span class="visually-hidden">${tr("算術運算子")}</span><select name="${name}Operator" aria-label="${tr("算術運算子")}">${operators.map((op) => `<option value="${op}"${op === value.op ? " selected" : ""}>${op === "*" ? "×" : op === "/" ? "÷" : op}</option>`).join("")}</select></label>${render(value.right, `${name}Right`, tr("右運算元"), false)}</div>`;
      } else {
        const missing = mode === "stat" && !statChoices().some((stat) => stat.id === value.id);
        const input = mode === "stat"
          ? `<select name="${name}" aria-label="${escapeHtml(label)}">${missing ? `<option value="${escapeHtml(value.id)}" selected>${tr("找不到 Stat")} · ${escapeHtml(value.id)}</option>` : ""}${namedOptionTags(statChoices(), value.id)}</select>`
          : `<input name="${name}" aria-label="${escapeHtml(label)}" type="number" step="any" required value="${escapeHtml(value ?? 0)}">`;
        control = `<label class="field numeric-value"><span class="visually-hidden">${escapeHtml(label)}</span>${input}</label>`;
      }
      return `<div class="numeric-field type-badge-scope" data-numeric-field="${name}" data-numeric-mode="${mode}" data-numeric-label="${escapeHtml(label)}" data-numeric-calculation="${allowCalculation}"><span class="type-badge-cover" aria-hidden="true"></span>${source}${control}</div>`;
    }

    function read(scope, name) {
      const mode = scope.querySelector(`[name="${name}Source"]`)?.value || "number";
      if (mode === "calc") return { type: "calc", op: scope.querySelector(`[name="${name}Operator"]`).value, left: read(scope, `${name}Left`), right: read(scope, `${name}Right`) };
      const value = scope.querySelector(`[name="${name}"]`).value.trim();
      if (mode === "stat") return { type: "stat", id: value };
      // Leave an empty required field invalid; never silently turn it into zero.
      return value === "" ? "" : Number(value);
    }

    function changeSource(target) {
      if (!target.matches("[data-numeric-source]")) return false;
      const mode = target.value;
      const field = target.closest("[data-numeric-field]");
      target.value = field.dataset.numericMode;
      const value = switchSource(read(field, field.dataset.numericField), mode, statChoices()[0]?.id);
      field.outerHTML = render(value, field.dataset.numericField, field.dataset.numericLabel, field.dataset.numericCalculation === "true");
      return true;
    }

    return { render, read, changeSource };
  }

  return { create, modeOf, switchSource };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SceneNumericField;
