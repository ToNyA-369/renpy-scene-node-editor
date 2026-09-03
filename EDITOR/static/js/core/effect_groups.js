"use strict";

(function exposeEffectGroups(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneEffectGroups = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const LOOSE = "__effects__";
  const isGroup = (effect) => effect?.type === "random";

  // Addresses are render-local, not persisted IDs. Only containers alter execution.
  function entries(effects = []) {
    return effects.flatMap((effect, index) => isGroup(effect)
      ? (effect.choices || []).map((choice, child) => ({
        id: `${index}.${child}`, group: `random:${index}`, effect: choice.effect, weight: choice.weight ?? 1,
      }))
      : [{ id: String(index), group: LOOSE, effect, weight: 1 }]);
  }

  function assemble(items) {
    const groups = new Map();
    const effects = [];
    items.forEach(({ effect, group = LOOSE, weight = 1 }) => {
      if (group === LOOSE) effects.push(effect);
      else {
        if (!groups.has(group)) {
          const block = { type: "random", choices: [] };
          groups.set(group, block);
          effects.push(block);
        }
        groups.get(group).choices.push({ weight, effect });
      }
    });
    return effects;
  }

  function replace(effects, address, effect) {
    const [index, child] = String(address).split(".").map(Number);
    if (child === undefined) effects[index] = effect;
    else effects[index].choices[child].effect = effect;
  }

  function remove(effects, address) {
    return assemble(entries(effects).filter((item) => item.id !== String(address)));
  }

  function percentages(weights) {
    if (weights.some((weight) => typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0)) return weights.map(() => null);
    const max = weights.reduce((largest, weight) => Math.max(largest, weight), 0);
    const scaled = weights.map((weight) => weight / max);
    const total = scaled.reduce((sum, weight) => sum + weight, 0);
    return scaled.map((weight) => 100 * weight / total);
  }

  function percentageLabel(value) {
    if (value === null) return "—";
    if (value > 0 && value < 0.1) return "<0.1%";
    if (value < 100 && value > 99.9) return ">99.9%";
    return `${Number(value.toFixed(1))}%`;
  }

  function applyDrop(groupDrag, effects, detail) {
    const items = entries(effects);
    const settings = { ...detail, defaultGroup: LOOSE, dissolveSingleton: false };
    let plan = detail.sourceGroup
      ? groupDrag.planGroupBlockReorder(items, settings)
      : detail.mode === "group"
        ? groupDrag.planGroupDrop(items, { ...settings, newGroupName: "random" })
        : groupDrag.planReorder(items, settings);
    if (!plan && !detail.sourceGroup && detail.mode === "group") plan = groupDrag.planReorder(items, settings);
    if (!plan) return null;
    const byId = new Map(items.map((item) => [item.id, item]));
    return assemble(plan.order.map((id) => ({ ...byId.get(id), group: plan.assignments[id] ?? byId.get(id).group })));
  }

  return Object.freeze({ LOOSE, isGroup, entries, assemble, replace, remove, percentages, percentageLabel, applyDrop });
});
