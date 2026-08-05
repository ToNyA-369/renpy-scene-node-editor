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

  function groupedStatEntries(stats) {
    const groups = new Map([[DEFAULT_GROUP, []]]);
    Object.entries(stats || {}).forEach(([id, values]) => {
      const group = normalizeGroup(values?.Group);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([id, values || {}]);
    });
    return [...groups].map(([group, entries]) => ({ group, entries }));
  }

  function statChoices(stats) {
    return Object.entries(stats || {}).map(([id, values]) => {
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
    statChoices,
  };
});
