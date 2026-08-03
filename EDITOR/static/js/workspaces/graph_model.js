"use strict";

(function exposeGraphModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGraphModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function relationships(nodes, edges = []) {
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const grouped = new Map();
    for (const edge of edges) {
      const source = String(edge.source || "");
      const target = String(edge.target || "");
      const endUp = edge.endUp === "REPLACE" ? "REPLACE" : "GOTO";
      const scope = edge.scope === "global" ? "global" : "node";
      if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
      const key = `${source}\u0000${target}\u0000${endUp}`;
      if (!grouped.has(key)) grouped.set(key, { source, target, endUp, scope, events: [] });
      grouped.get(key).events.push(edge);
    }
    const directRelationships = [...grouped.values()];
    const gotoParents = new Map();
    directRelationships
      .filter((relationship) => relationship.endUp === "GOTO" && relationship.scope !== "global")
      .forEach((relationship) => {
        if (!gotoParents.has(relationship.target)) gotoParents.set(relationship.target, new Set());
        gotoParents.get(relationship.target).add(relationship.source);
      });
    directRelationships.filter((relationship) => relationship.endUp === "REPLACE").forEach((relationship) => {
      for (const parent of gotoParents.get(relationship.source) || []) {
        const key = `${parent}\u0000${relationship.target}\u0000MANAGEMENT`;
        if (!grouped.has(key)) {
          grouped.set(key, { source: parent, target: relationship.target, endUp: "MANAGEMENT", scope: "node", events: [] });
        }
        relationship.events.forEach((event) => {
          grouped.get(key).events.push({ ...event, replacedNode: relationship.source });
        });
      }
    });
    return [...grouped.values()];
  }

  function layout(nodes, graphRelationships, rootNodeId = null) {
    const nodeWidth = 190;
    const nodeHeight = 72;
    const horizontalGap = 130;
    const verticalGap = 46;
    const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
    const adjacency = new Map(nodes.map((node) => [String(node.id), []]));
    const indegree = new Map(nodes.map((node) => [String(node.id), 0]));
    graphRelationships.forEach((edge) => {
      adjacency.get(edge.source)?.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    });

    const levels = new Map();
    const starts = [];
    if (rootNodeId && nodeById.has(String(rootNodeId))) starts.push(String(rootNodeId));
    [...nodes]
      .sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), "zh-Hant"))
      .forEach((node) => {
        const id = String(node.id);
        if ((indegree.get(id) || 0) === 0 && !starts.includes(id)) starts.push(id);
      });

    const visitFrom = (start, baseLevel = 0) => {
      if (!levels.has(start)) levels.set(start, baseLevel);
      const queue = [start];
      while (queue.length) {
        const source = queue.shift();
        const nextLevel = (levels.get(source) || 0) + 1;
        for (const target of adjacency.get(source) || []) {
          if (levels.has(target)) continue;
          levels.set(target, nextLevel);
          queue.push(target);
        }
      }
    };
    starts.forEach((start) => visitFrom(start));
    nodes.forEach((node) => {
      const id = String(node.id);
      if (!levels.has(id)) visitFrom(id);
    });

    const grouped = new Map();
    nodes.forEach((node) => {
      const level = levels.get(String(node.id)) || 0;
      if (!grouped.has(level)) grouped.set(level, []);
      grouped.get(level).push(node);
    });
    grouped.forEach((items) => items.sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id), "zh-Hant")));
    const maximumRows = Math.max(1, ...[...grouped.values()].map((items) => items.length));
    const maximumLevel = Math.max(0, ...grouped.keys());
    const positions = new Map();
    grouped.forEach((items, level) => {
      const offset = (maximumRows - items.length) * (nodeHeight + verticalGap) / 2;
      items.forEach((node, index) => {
        positions.set(String(node.id), {
          x: 70 + level * (nodeWidth + horizontalGap),
          y: 70 + offset + index * (nodeHeight + verticalGap),
        });
      });
    });
    return {
      nodeWidth,
      nodeHeight,
      positions,
      width: Math.max(760, 140 + (maximumLevel + 1) * nodeWidth + maximumLevel * horizontalGap),
      height: Math.max(480, 140 + maximumRows * nodeHeight + Math.max(0, maximumRows - 1) * verticalGap),
    };
  }

  function edgePath(source, target, graphLayout, index, endUp) {
    const laneOffset = endUp === "MANAGEMENT" ? 12 : endUp === "REPLACE" ? 5 : -5;
    const sourceCenterY = source.y + graphLayout.nodeHeight / 2 + laneOffset;
    const targetCenterY = target.y + graphLayout.nodeHeight / 2 + laneOffset;
    if (target.x > source.x) {
      const startX = source.x + graphLayout.nodeWidth;
      const endX = target.x;
      const middleX = (startX + endX) / 2;
      return `M ${startX} ${sourceCenterY} C ${middleX} ${sourceCenterY}, ${middleX} ${targetCenterY}, ${endX} ${targetCenterY}`;
    }
    const lift = 58 + (index % 4) * 24;
    const startX = source.x + graphLayout.nodeWidth * 0.7;
    const endX = target.x + graphLayout.nodeWidth * 0.3;
    return `M ${startX} ${source.y + laneOffset} C ${startX + 70} ${source.y - lift + laneOffset}, ${endX - 70} ${target.y - lift + laneOffset}, ${endX} ${target.y + laneOffset}`;
  }

  return { edgePath, layout, relationships };
});
