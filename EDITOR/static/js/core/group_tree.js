"use strict";

(function exposeGroupTree(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGroupTree = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_DEPTH = 3;
  const ROOT = "Normal";

  function path(record) {
    const explicit = record?.["Group Path"] ?? record?.groupPath;
    if (Array.isArray(explicit)) return explicit.map(String);
    const name = String(record?.Group ?? record?.group ?? ROOT).trim() || ROOT;
    return name === ROOT ? [] : [name];
  }
  const key = (parts) => parts.length ? JSON.stringify(parts) : ROOT;
  const fromKey = (value) => value && value !== ROOT ? JSON.parse(value) : [];
  const within = (parts, parent) => parent.every((part, index) => parts[index] === part);
  const ancestorKeys = (parts) => parts.map((_part, index) => key(parts.slice(0, index + 1)));

  function blocks(records) {
    const root = { blocks: [], groups: new Map() };
    for (const record of records || []) {
      let parent = root;
      const parts = path(record);
      parts.forEach((name, index) => {
        if (!parent.groups.has(name)) {
          const groupPath = parts.slice(0, index + 1);
          const group = { type: "group", name, path: groupPath, key: key(groupPath), blocks: [], events: [], groups: new Map() };
          parent.groups.set(name, group);
          parent.blocks.push(group);
        }
        parent = parent.groups.get(name);
        parent.events.push(record);
      });
      parent.blocks.push({ type: "item", event: record });
    }
    const clean = (entries) => entries.map((entry) => {
      if (entry.type === "item") return entry;
      const { groups, ...group } = entry;
      return { ...group, blocks: clean(group.blocks) };
    });
    return clean(root.blocks);
  }

  function ordered(records) {
    const flatten = (entries) => entries.flatMap((entry) => entry.type === "item" ? [entry.event] : flatten(entry.blocks));
    return flatten(blocks(records));
  }

  function uniqueName(records, parent, preferred, excluded = new Set()) {
    const names = new Set(records.filter((record) => !excluded.has(record.id))
      .map(path).filter((parts) => parts.length > parent.length && within(parts, parent))
      .map((parts) => parts[parent.length].toLocaleLowerCase()));
    const base = String(preferred || "New Group").trim().slice(0, 80);
    let result = base;
    for (let suffix = 2; names.has(result.toLocaleLowerCase()) || result === ROOT; suffix += 1) {
      result = `${base.slice(0, 75)} ${suffix}`;
    }
    return result;
  }

  function rename(records, sourceKey, name) {
    const source = fromKey(sourceKey);
    const trimmed = String(name || "").trim();
    if (!source.length || !trimmed || trimmed === ROOT || trimmed.length > 80) return null;
    const destination = [...source.slice(0, -1), trimmed];
    if (key(destination) !== sourceKey && records.some((record) => within(path(record), destination))) return null;
    return Object.fromEntries(records.filter((record) => within(path(record), source))
      .map((record) => [record.id, [...destination, ...path(record).slice(source.length)]]));
  }

  function planDrop(records, { sourceId, sourceGroup, targetId = null, targetGroup = ROOT, position = "before", mode = "reorder", newGroupName = "New Group" }) {
    const items = ordered(records);
    const sourcePath = sourceGroup ? fromKey(sourceGroup) : null;
    const members = sourcePath ? items.filter((item) => within(path(item), sourcePath)) : items.filter((item) => item.id === sourceId);
    if (!members.length || sourcePath && !sourcePath.length) return null;
    const memberIds = new Set(members.map((item) => item.id));
    if (targetId && memberIds.has(targetId)) return null;
    const target = targetId ? items.find((item) => item.id === targetId) : null;
    if (targetId && !target) return null;
    let parent = fromKey(targetGroup);
    if (sourcePath && within(parent, sourcePath)) return null;
    const assignments = {};
    let createdGroup = null;
    if (mode === "group" && target) {
      parent = [...parent, uniqueName(items, parent, newGroupName)];
      createdGroup = key(parent);
      assignments[target.id] = parent;
    }
    const destination = sourcePath
      ? [...parent, uniqueName(items, parent, sourcePath.at(-1), memberIds)]
      : parent;
    if (destination.length > MAX_DEPTH) return null;
    for (const item of members) {
      const next = sourcePath ? [...destination, ...path(item).slice(sourcePath.length)] : destination;
      if (next.length > MAX_DEPTH) return null;
      if (key(next) !== key(path(item))) assignments[item.id] = next;
    }
    const rest = items.filter((item) => !memberIds.has(item.id));
    const order = rest.map((item) => item.id);
    let index = order.length;
    if (target) index = order.indexOf(target.id) + (position === "after" ? 1 : 0);
    else if (parent.length) {
      const last = rest.findLastIndex((item) => within(path(item), parent));
      if (last >= 0) index = last + 1;
    }
    order.splice(index, 0, ...members.map((item) => item.id));
    if (!Object.keys(assignments).length && order.every((id, i) => id === items[i].id)) return null;
    return { assignments, order, destination: key(destination), createdGroup };
  }

  return { MAX_DEPTH, ROOT, path, key, fromKey, within, ancestorKeys, blocks, ordered, rename, planDrop };
});
