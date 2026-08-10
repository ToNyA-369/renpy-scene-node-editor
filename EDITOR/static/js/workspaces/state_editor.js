"use strict";

(function exposeStateEditor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneStateEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DEFAULT_GROUP = "Normal";

  function normalizeGroup(value) {
    return String(value || "").trim() || DEFAULT_GROUP;
  }

  function pickerSegment(value) {
    return String(value || "").replaceAll("/", "／");
  }

  function orderedStatEntries(stats) {
    const entries = Object.entries(stats || {}).map(([id, values], index) => ({
      id, values: values || {},
      order: Number.isInteger(values?.Order) && values.Order >= 0 ? values.Order : index,
      index,
    }));
    entries.sort((left, right) => left.order - right.order || left.index - right.index);
    return entries.map(({ id, values }) => [id, values]);
  }

  function withStatOrders(stats) {
    return Object.fromEntries(orderedStatEntries(stats).map(([id, values], index) => [
      id, { ...values, Order: index },
    ]));
  }

  function groupedStatEntries(stats) {
    const groups = new Map([[DEFAULT_GROUP, []]]);
    orderedStatEntries(stats).forEach(([id, values]) => {
      const group = normalizeGroup(values?.Group);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([id, values || {}]);
    });
    return [...groups].map(([group, entries]) => ({ group, entries }));
  }

  function statPoolBlocks(stats) {
    const ordered = orderedStatEntries(stats);
    const grouped = new Map();
    ordered.forEach(([id, values]) => {
      const group = normalizeGroup(values?.Group);
      if (group === DEFAULT_GROUP) return;
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push([id, values || {}]);
    });
    const emitted = new Set();
    const blocks = [];
    ordered.forEach(([id, values]) => {
      const group = normalizeGroup(values?.Group);
      if (group === DEFAULT_GROUP) {
        blocks.push({ type: "item", id, values: values || {} });
      } else if (!emitted.has(group)) {
        emitted.add(group);
        blocks.push({ type: "group", group, entries: grouped.get(group) || [] });
      }
    });
    return blocks;
  }

  function statChoices(stats) {
    return orderedStatEntries(stats).map(([id, values]) => {
      const name = String(values?.Name || id);
      const group = normalizeGroup(values?.Group);
      return {
        id,
        name,
        pickerPath: group ? `${pickerSegment(group)}/${pickerSegment(name)}` : pickerSegment(name),
      };
    });
  }

  return {
    DEFAULT_GROUP,
    groupedStatEntries,
    normalizeGroup,
    statPoolBlocks,
    statChoices,
    withStatOrders,
  };
});
