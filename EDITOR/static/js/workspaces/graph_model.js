"use strict";

(function exposeGraphModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGraphModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const BASE_NODE_RADIUS = 19;
  const MAX_NODE_RADIUS = 32;
  const DESCENDANT_DECAY = 0.68;
  const COLUMN_GAP = 360;
  const ROW_GAP = 132;
  const COMPONENT_MICRO_SPAN = 140;
  const REPLACE_MICRO_SPAN = 160;
  const SUBTREE_GAP = 54;
  const GRAPH_MARGIN_X = 190;
  const GRAPH_MARGIN_Y = 170;
  const DETACHED_GAP = 250;
  const ARROW_LENGTH = 20;
  const ARROW_HALF_WIDTH = 7;
  const IDLE_MOTION_X = 2.6;
  const IDLE_MOTION_Y = 1.8;
  const LOCAL_FORCE_RANGE = 210;
  const LOCAL_REPULSION = 72;
  const LINK_OFFSET_SPRING = 3.2;
  const MOTION_ANCHOR_SPRING = 18;
  const MOTION_DAMPING = 8.5;
  const MAX_IDLE_DISPLACEMENT = 7;

  function relationshipKey(relationship) {
    return `${relationship.source}\u0000${relationship.target}\u0000${relationship.endUp}`;
  }

  function nodeLabel(node) {
    return String(node?.name || node?.id || "");
  }

  function compareNodes(left, right) {
    return nodeLabel(left).localeCompare(nodeLabel(right), "zh-Hant")
      || String(left.id).localeCompare(String(right.id));
  }

  function stableUnit(value, salt = "") {
    const text = `${salt}:${String(value)}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function cross(left, right) {
    return left.x * right.y - left.y * right.x;
  }

  function segmentIntersection(first, second) {
    const firstVector = {
      x: first.end.x - first.start.x,
      y: first.end.y - first.start.y,
    };
    const secondVector = {
      x: second.end.x - second.start.x,
      y: second.end.y - second.start.y,
    };
    const denominator = cross(firstVector, secondVector);
    if (Math.abs(denominator) < 0.000001) return null;
    const offset = {
      x: second.start.x - first.start.x,
      y: second.start.y - first.start.y,
    };
    const firstRatio = cross(offset, secondVector) / denominator;
    const secondRatio = cross(offset, firstVector) / denominator;
    const endpointMargin = 0.025;
    if (
      firstRatio <= endpointMargin || firstRatio >= 1 - endpointMargin
      || secondRatio <= endpointMargin || secondRatio >= 1 - endpointMargin
    ) return null;
    return {
      x: first.start.x + firstVector.x * firstRatio,
      y: first.start.y + firstVector.y * firstRatio,
      firstRatio,
      secondRatio,
      angleFactor: Math.abs(denominator)
        / Math.max(1, Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y)),
    };
  }

  function crossingPairs(graphRelationships, pointForNode) {
    const segments = graphRelationships
      .filter((relationship) => relationship.scope !== "global" && relationship.source !== relationship.target)
      .map((relationship) => {
        const start = pointForNode(relationship.source);
        const end = pointForNode(relationship.target);
        if (!start || !end) return null;
        return {
          relationship,
          start,
          end,
          minimumX: Math.min(start.x, end.x),
          maximumX: Math.max(start.x, end.x),
          minimumY: Math.min(start.y, end.y),
          maximumY: Math.max(start.y, end.y),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.minimumX - right.minimumX
        || left.minimumY - right.minimumY
        || relationshipKey(left.relationship).localeCompare(relationshipKey(right.relationship)));
    const crossings = [];
    for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
      const first = segments[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
        const second = segments[secondIndex];
        if (second.minimumX > first.maximumX) break;
        if (second.maximumY < first.minimumY || second.minimumY > first.maximumY) continue;
        const sharedEndpoint = [first.relationship.source, first.relationship.target]
          .some((nodeId) => nodeId === second.relationship.source || nodeId === second.relationship.target);
        if (sharedEndpoint) continue;
        const intersection = segmentIntersection(first, second);
        if (intersection) crossings.push({ first, second, intersection });
      }
    }
    return crossings;
  }

  function countEdgeCrossings(graphRelationships, graphLayout) {
    return crossingPairs(graphRelationships, (nodeId) => {
      const position = graphLayout.positions.get(String(nodeId));
      return position ? nodeCenter(position, graphLayout, nodeId) : null;
    }).length;
  }

  function stableRouteLane(relationship) {
    const key = relationshipKey(relationship);
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return hash % 2 === 0 ? -1 : 1;
  }

  function stablePairLane(relationship) {
    const [source, target] = [relationship.source, relationship.target].sort();
    return stableRouteLane({ source, target, endUp: relationship.endUp });
  }

  function hierarchyChildren(nodes, graphRelationships) {
    const children = new Map(nodes.map((node) => [String(node.id), new Set()]));
    graphRelationships.forEach((relationship) => {
      if (relationship.scope === "global" || !["GOTO", "MANAGEMENT"].includes(relationship.endUp)) return;
      children.get(relationship.source)?.add(relationship.target);
    });
    return children;
  }

  function descendantMetrics(nodeId, children) {
    const visited = new Set([nodeId]);
    const depths = new Map();
    const queue = [...(children.get(nodeId) || [])].map((childId) => ({ nodeId: childId, depth: 1 }));
    let inheritedLoad = 0;
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.nodeId)) continue;
      visited.add(current.nodeId);
      depths.set(current.nodeId, current.depth);
      inheritedLoad += DESCENDANT_DECAY ** (current.depth - 1);
      (children.get(current.nodeId) || []).forEach((childId) => {
        if (!visited.has(childId)) queue.push({ nodeId: childId, depth: current.depth + 1 });
      });
    }
    return { descendantCount: visited.size - 1, inheritedLoad, depths };
  }

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
    const replaceBySource = new Map();
    directRelationships
      .filter((relationship) => relationship.endUp === "REPLACE" && relationship.scope !== "global")
      .forEach((relationship) => {
        if (!replaceBySource.has(relationship.source)) replaceBySource.set(relationship.source, []);
        replaceBySource.get(relationship.source).push(relationship);
      });

    // A GOTO establishes the runtime parent for every node reachable through
    // the destination's REPLACE chain. These are visual management references
    // only: they never add a static Parent field to project data.
    directRelationships
      .filter((relationship) => relationship.endUp === "GOTO" && relationship.scope !== "global")
      .forEach((gotoRelationship) => {
        const visited = new Set([gotoRelationship.target]);
        const queue = [{ nodeId: gotoRelationship.target, path: [gotoRelationship.target] }];
        while (queue.length) {
          const current = queue.shift();
          for (const replaceRelationship of replaceBySource.get(current.nodeId) || []) {
            const target = replaceRelationship.target;
            if (visited.has(target)) continue;
            visited.add(target);
            const replacePath = [...current.path, target];
            const key = `${gotoRelationship.source}\u0000${target}\u0000MANAGEMENT`;
            if (!grouped.has(key)) {
              grouped.set(key, {
                source: gotoRelationship.source,
                target,
                endUp: "MANAGEMENT",
                scope: "node",
                events: [],
              });
            }
            replaceRelationship.events.forEach((event) => {
              grouped.get(key).events.push({
                ...event,
                replacedNode: gotoRelationship.target,
                replacePath,
              });
            });
            queue.push({ nodeId: target, path: replacePath });
          }
        }
      });

    // A reciprocal REPLACE pair is one visual relationship with arrowheads at
    // both ends. Directional Event data stays attached for tooltips and never
    // changes the saved project representation.
    const output = [];
    const consumedReplacePairs = new Set();
    for (const relationship of grouped.values()) {
      if (relationship.endUp === "REPLACE" && relationship.scope !== "global") {
        const pair = [relationship.source, relationship.target].sort();
        const pairKey = `${pair[0]}\u0000${pair[1]}\u0000REPLACE`;
        const reverse = grouped.get(`${relationship.target}\u0000${relationship.source}\u0000REPLACE`);
        if (reverse && reverse !== relationship) {
          if (consumedReplacePairs.has(pairKey)) continue;
          consumedReplacePairs.add(pairKey);
          const forward = grouped.get(`${pair[0]}\u0000${pair[1]}\u0000REPLACE`);
          const backward = grouped.get(`${pair[1]}\u0000${pair[0]}\u0000REPLACE`);
          output.push({
            source: pair[0],
            target: pair[1],
            endUp: "REPLACE",
            scope: "node",
            bidirectional: true,
            events: [
              ...forward.events.map((event) => ({ ...event, directionSource: pair[0], directionTarget: pair[1] })),
              ...backward.events.map((event) => ({ ...event, directionSource: pair[1], directionTarget: pair[0] })),
            ],
          });
          continue;
        }
      }
      if (relationship.endUp === "GOTO" && relationship.scope !== "global") {
        const reverse = grouped.get(`${relationship.target}\u0000${relationship.source}\u0000GOTO`);
        output.push({ ...relationship, cycle: Boolean(reverse && reverse !== relationship) });
        continue;
      }
      output.push(relationship);
    }
    return output;
  }

  function layout(nodes, graphRelationships, rootNodeId = null) {
    const realNodes = nodes
      .filter((node) => !node.isGlobal && String(node.id) !== "__global__")
      .sort(compareNodes);
    const nodeById = new Map(realNodes.map((node) => [String(node.id), node]));
    const requestedRoot = String(rootNodeId || "");
    const configuredRoot = nodeById.has(requestedRoot) ? requestedRoot : String(realNodes[0]?.id || "");
    const childTargets = hierarchyChildren(realNodes, graphRelationships);
    const hierarchyMetrics = new Map(realNodes.map((node) => {
      const nodeId = String(node.id);
      return [nodeId, descendantMetrics(nodeId, childTargets)];
    }));
    const nodeSizes = new Map(realNodes.map((node) => {
      const nodeId = String(node.id);
      const directChildCount = childTargets.get(nodeId)?.size || 0;
      const { descendantCount, inheritedLoad } = hierarchyMetrics.get(nodeId);
      const compressedLoad = Math.log2(1 + inheritedLoad);
      return [nodeId, {
        radius: Math.min(MAX_NODE_RADIUS, BASE_NODE_RADIUS + compressedLoad * 3.25),
        childCount: descendantCount,
        directChildCount,
        descendantCount,
        inheritedLoad,
      }];
    }));

    // REPLACE preserves Stack depth. Collapse every REPLACE family into one
    // layout unit before assigning GOTO depth, so later routing cannot pull
    // same-depth alternatives into a misleading parent/child position.
    const unionParent = new Map(realNodes.map((node) => [String(node.id), String(node.id)]));
    const find = (nodeId) => {
      let current = nodeId;
      while (unionParent.get(current) !== current) current = unionParent.get(current);
      let cursor = nodeId;
      while (unionParent.get(cursor) !== current) {
        const next = unionParent.get(cursor);
        unionParent.set(cursor, current);
        cursor = next;
      }
      return current;
    };
    const unite = (leftId, rightId) => {
      const left = find(leftId);
      const right = find(rightId);
      if (left === right) return;
      const [parent, child] = left.localeCompare(right) <= 0 ? [left, right] : [right, left];
      unionParent.set(child, parent);
    };
    graphRelationships.forEach((relationship) => {
      if (
        relationship.scope !== "global"
        && relationship.endUp === "REPLACE"
        && nodeById.has(relationship.source)
        && nodeById.has(relationship.target)
      ) unite(relationship.source, relationship.target);
    });

    const componentMembers = new Map();
    realNodes.forEach((node) => {
      const componentId = find(String(node.id));
      if (!componentMembers.has(componentId)) componentMembers.set(componentId, []);
      componentMembers.get(componentId).push(String(node.id));
    });
    componentMembers.forEach((memberIds) => memberIds.sort((left, right) => (
      compareNodes(nodeById.get(left), nodeById.get(right))
    )));
    const componentForNode = new Map(realNodes.map((node) => [String(node.id), find(String(node.id))]));
    const gotoRelationships = graphRelationships.filter((relationship) => (
      relationship.scope !== "global"
      && relationship.endUp === "GOTO"
      && nodeById.has(relationship.source)
      && nodeById.has(relationship.target)
      && componentForNode.get(relationship.source) !== componentForNode.get(relationship.target)
    ));
    const outgoingComponents = new Map([...componentMembers.keys()].map((componentId) => [componentId, []]));
    gotoRelationships.forEach((relationship) => {
      outgoingComponents.get(componentForNode.get(relationship.source)).push(relationship);
    });
    outgoingComponents.forEach((items) => items.sort((left, right) => (
      compareNodes(nodeById.get(left.target), nodeById.get(right.target))
      || relationshipKey(left).localeCompare(relationshipKey(right))
    )));

    const rootComponent = componentForNode.get(configuredRoot) || null;
    const componentDepth = new Map();
    const componentChildren = new Map([...componentMembers.keys()].map((componentId) => [componentId, []]));
    const componentParent = new Map();
    const componentEntryNode = new Map(rootComponent ? [[rootComponent, configuredRoot]] : []);
    const primaryRelationshipKeys = new Set();
    const reachableComponents = new Set();

    const growTree = (startComponent, reachable) => {
      if (componentDepth.has(startComponent)) return;
      componentDepth.set(startComponent, 0);
      if (reachable) reachableComponents.add(startComponent);
      const queue = [startComponent];
      while (queue.length) {
        const sourceComponent = queue.shift();
        for (const relationship of outgoingComponents.get(sourceComponent) || []) {
          const targetComponent = componentForNode.get(relationship.target);
          if (componentDepth.has(targetComponent)) continue;
          componentDepth.set(targetComponent, componentDepth.get(sourceComponent) + 1);
          componentParent.set(targetComponent, sourceComponent);
          componentEntryNode.set(targetComponent, relationship.target);
          componentChildren.get(sourceComponent).push(targetComponent);
          primaryRelationshipKeys.add(relationshipKey(relationship));
          if (reachable) reachableComponents.add(targetComponent);
          queue.push(targetComponent);
        }
      }
    };
    if (rootComponent) growTree(rootComponent, true);

    const orderedComponents = [...componentMembers.keys()].sort((left, right) => (
      compareNodes(nodeById.get(componentMembers.get(left)[0]), nodeById.get(componentMembers.get(right)[0]))
    ));
    const incomingComponents = new Map([...componentMembers.keys()].map((componentId) => [componentId, new Set()]));
    gotoRelationships.forEach((relationship) => {
      incomingComponents.get(componentForNode.get(relationship.target)).add(componentForNode.get(relationship.source));
    });
    const detachedRoots = [];
    while (orderedComponents.some((componentId) => !componentDepth.has(componentId))) {
      const remaining = orderedComponents.filter((componentId) => !componentDepth.has(componentId));
      const remainingSet = new Set(remaining);
      const seed = remaining.find((componentId) => (
        [...incomingComponents.get(componentId)].every((sourceId) => !remainingSet.has(sourceId))
      )) || remaining[0];
      detachedRoots.push(seed);
      componentEntryNode.set(seed, componentMembers.get(seed)[0]);
      growTree(seed, false);
    }
    componentMembers.forEach((memberIds, componentId) => {
      const entryNodeId = componentEntryNode.get(componentId);
      if (!entryNodeId) return;
      memberIds.sort((left, right) => (left === entryNodeId ? -1 : right === entryNodeId ? 1 : 0));
    });
    componentChildren.forEach((children) => children.sort((left, right) => (
      compareNodes(nodeById.get(componentMembers.get(left)[0]), nodeById.get(componentMembers.get(right)[0]))
    )));

    // A shortest ROOT path can place related GOTO destinations at the same
    // formal Stack depth. Give those components a bounded local progression
    // instead of routing every same-depth edge as a large outside return arc.
    const sameDepthAdjacency = new Map([...componentMembers.keys()].map((componentId) => [componentId, []]));
    gotoRelationships.forEach((relationship) => {
      const sourceComponent = componentForNode.get(relationship.source);
      const targetComponent = componentForNode.get(relationship.target);
      if (componentDepth.get(sourceComponent) !== componentDepth.get(targetComponent)) return;
      sameDepthAdjacency.get(sourceComponent).push({ componentId: targetComponent, incoming: false });
      sameDepthAdjacency.get(targetComponent).push({ componentId: sourceComponent, incoming: true });
    });
    sameDepthAdjacency.forEach((adjacent) => adjacent.sort((left, right) => (
      Number(left.incoming) - Number(right.incoming)
      || compareNodes(
        nodeById.get(componentMembers.get(left.componentId)[0]),
        nodeById.get(componentMembers.get(right.componentId)[0]),
      )
    )));
    const componentMicroRanks = new Map([...componentMembers.keys()].map((componentId) => [componentId, 0]));
    const componentMicroOffsets = new Map([...componentMembers.keys()].map((componentId) => [componentId, 0]));
    const microVisited = new Set();
    orderedComponents.forEach((seedComponent) => {
      if (microVisited.has(seedComponent) || !sameDepthAdjacency.get(seedComponent).length) return;
      const group = [];
      const discoverQueue = [seedComponent];
      microVisited.add(seedComponent);
      while (discoverQueue.length) {
        const componentId = discoverQueue.shift();
        group.push(componentId);
        sameDepthAdjacency.get(componentId).forEach(({ componentId: adjacentId }) => {
          if (microVisited.has(adjacentId)) return;
          microVisited.add(adjacentId);
          discoverQueue.push(adjacentId);
        });
      }
      const outgoingCount = (componentId) => sameDepthAdjacency.get(componentId)
        .filter((item) => !item.incoming).length;
      const anchor = [...group].sort((left, right) => (
        outgoingCount(right) - outgoingCount(left)
        || compareNodes(
          nodeById.get(componentMembers.get(left)[0]),
          nodeById.get(componentMembers.get(right)[0]),
        )
      ))[0];
      const rankQueue = [anchor];
      const ranked = new Set([anchor]);
      componentMicroRanks.set(anchor, 0);
      while (rankQueue.length) {
        const componentId = rankQueue.shift();
        sameDepthAdjacency.get(componentId).forEach(({ componentId: adjacentId }) => {
          if (ranked.has(adjacentId)) return;
          ranked.add(adjacentId);
          componentMicroRanks.set(adjacentId, componentMicroRanks.get(componentId) + 1);
          rankQueue.push(adjacentId);
        });
      }
      const maximumRank = Math.max(0, ...group.map((componentId) => componentMicroRanks.get(componentId)));
      group.forEach((componentId) => {
        if (!maximumRank) return;
        const ratio = componentMicroRanks.get(componentId) / maximumRank;
        componentMicroOffsets.set(componentId, (ratio - 0.5) * COMPONENT_MICRO_SPAN);
      });
    });

    const componentSpan = new Map();
    const measure = (componentId, trail = new Set()) => {
      if (componentSpan.has(componentId)) return componentSpan.get(componentId);
      if (trail.has(componentId)) return componentMembers.get(componentId).length * ROW_GAP;
      const nextTrail = new Set(trail).add(componentId);
      const ownSpan = Math.max(ROW_GAP, componentMembers.get(componentId).length * ROW_GAP);
      const childSpans = componentChildren.get(componentId).map((childId) => measure(childId, nextTrail));
      const childrenSpan = childSpans.length
        ? childSpans.reduce((total, value) => total + value, 0) + SUBTREE_GAP * (childSpans.length - 1)
        : 0;
      const span = Math.max(ownSpan, childrenSpan);
      componentSpan.set(componentId, span);
      return span;
    };
    const componentCenters = new Map();
    const placeComponent = (componentId, top) => {
      const span = measure(componentId);
      componentCenters.set(componentId, top + span / 2);
      const children = componentChildren.get(componentId);
      const childrenSpan = children.reduce((total, childId) => total + measure(childId), 0)
        + SUBTREE_GAP * Math.max(0, children.length - 1);
      let childTop = top + (span - childrenSpan) / 2;
      children.forEach((childId) => {
        placeComponent(childId, childTop);
        childTop += measure(childId) + SUBTREE_GAP;
      });
      return span;
    };

    let cursorY = GRAPH_MARGIN_Y;
    if (rootComponent) cursorY += placeComponent(rootComponent, cursorY);
    const reachableBottom = cursorY;
    if (detachedRoots.length) cursorY += DETACHED_GAP;
    detachedRoots.forEach((componentId, index) => {
      if (index) cursorY += SUBTREE_GAP;
      cursorY += placeComponent(componentId, cursorY);
    });

    const replaceAdjacency = new Map(realNodes.map((node) => [String(node.id), []]));
    graphRelationships.forEach((relationship) => {
      if (relationship.scope === "global" || relationship.endUp !== "REPLACE") return;
      if (!replaceAdjacency.has(relationship.source) || !replaceAdjacency.has(relationship.target)) return;
      replaceAdjacency.get(relationship.source).push({ nodeId: relationship.target, incoming: false });
      replaceAdjacency.get(relationship.target).push({
        nodeId: relationship.source,
        incoming: !relationship.bidirectional,
      });
    });
    replaceAdjacency.forEach((adjacent) => adjacent.sort((left, right) => (
      Number(left.incoming) - Number(right.incoming)
      || compareNodes(nodeById.get(left.nodeId), nodeById.get(right.nodeId))
    )));
    const replacementRanks = new Map();
    const replacementOrder = new Map();
    componentMembers.forEach((memberIds, componentId) => {
      const entryNodeId = componentEntryNode.get(componentId) || memberIds[0];
      const memberSet = new Set(memberIds);
      const queue = [entryNodeId];
      const ordered = [];
      replacementRanks.set(entryNodeId, 0);
      while (queue.length) {
        const nodeId = queue.shift();
        ordered.push(nodeId);
        (replaceAdjacency.get(nodeId) || []).forEach(({ nodeId: adjacentId }) => {
          if (!memberSet.has(adjacentId) || replacementRanks.has(adjacentId)) return;
          replacementRanks.set(adjacentId, replacementRanks.get(nodeId) + 1);
          queue.push(adjacentId);
        });
      }
      memberIds.forEach((nodeId) => {
        if (replacementRanks.has(nodeId)) return;
        replacementRanks.set(nodeId, 0);
        ordered.push(nodeId);
      });
      memberIds.sort((left, right) => (
        replacementRanks.get(left) - replacementRanks.get(right)
        || ordered.indexOf(left) - ordered.indexOf(right)
        || compareNodes(nodeById.get(left), nodeById.get(right))
      ));
      replacementOrder.set(componentId, ordered);
    });

    const positions = new Map();
    const levels = new Map();
    componentMembers.forEach((memberIds, componentId) => {
      const depth = componentDepth.get(componentId) || 0;
      const centerY = componentCenters.get(componentId) || GRAPH_MARGIN_Y;
      const hasReplacementFamily = memberIds.length > 1;
      memberIds.forEach((nodeId, index) => {
        const radius = nodeSizes.get(nodeId).radius;
        const memberOffset = (index - (memberIds.length - 1) / 2) * ROW_GAP;
        const replacementRank = replacementRanks.get(nodeId) || 0;
        // REPLACE is a same-depth substitution, not forward hierarchy. Place
        // alternating ranks on opposite sides of the depth baseline so chains
        // naturally contain both forward and backward arrows.
        const replacementOffset = !hasReplacementFamily
          ? 0
          : replacementRank % 2 === 0 ? -REPLACE_MICRO_SPAN / 2 : REPLACE_MICRO_SPAN / 2;
        positions.set(nodeId, {
          x: GRAPH_MARGIN_X + depth * COLUMN_GAP
            + componentMicroOffsets.get(componentId) + replacementOffset - radius,
          y: centerY + memberOffset - radius,
        });
        levels.set(nodeId, depth);
      });
    });

    const routes = new Map();
    graphRelationships.forEach((relationship) => {
      let kind = "cross";
      if (relationship.scope === "global") kind = "context";
      else if (relationship.endUp === "REPLACE") kind = "replace-local";
      else if (relationship.endUp === "MANAGEMENT") kind = "management";
      else if (relationship.cycle) kind = "goto-cycle";
      else if (primaryRelationshipKeys.has(relationshipKey(relationship))) kind = "tree";
      routes.set(relationshipKey(relationship), {
        kind,
        lane: ["cross", "goto-cycle"].includes(kind) ? stableRouteLane(relationship) : 0,
      });
    });

    const maxDepth = Math.max(0, ...levels.values());
    const rightmostCenter = Math.max(GRAPH_MARGIN_X, ...[...positions].map(([nodeId, position]) => (
      position.x + nodeSizes.get(nodeId).radius
    )));
    const width = Math.max(1200, rightmostCenter + GRAPH_MARGIN_X);
    const height = Math.max(820, cursorY + GRAPH_MARGIN_Y);
    const rootRadius = nodeSizes.get(configuredRoot)?.radius || BASE_NODE_RADIUS;
    const rootPosition = positions.get(configuredRoot);
    const center = rootPosition
      ? { x: rootPosition.x + rootRadius, y: rootPosition.y + rootRadius }
      : { x: GRAPH_MARGIN_X, y: GRAPH_MARGIN_Y };
    const detachedNodeIds = new Set(realNodes
      .map((node) => String(node.id))
      .filter((nodeId) => !reachableComponents.has(componentForNode.get(nodeId))));
    const revealSteps = new Map();
    realNodes.forEach((node) => {
      const nodeId = String(node.id);
      const componentId = componentForNode.get(nodeId);
      const formalDepth = levels.get(nodeId) || 0;
      const detachedOffset = detachedNodeIds.has(nodeId) ? maxDepth + 2 : 0;
      const localStep = Math.min(2,
        (componentMicroRanks.get(componentId) || 0) + (replacementRanks.get(nodeId) || 0));
      revealSteps.set(nodeId, (formalDepth + detachedOffset) * 2 + localStep);
    });

    return {
      algorithm: "structured-depth",
      nodeWidth: BASE_NODE_RADIUS * 2,
      nodeHeight: BASE_NODE_RADIUS * 2,
      nodeSizes,
      hierarchyChildren: childTargets,
      hierarchyDepths: new Map([...hierarchyMetrics].map(([nodeId, metrics]) => [nodeId, metrics.depths])),
      componentForNode,
      componentMembers,
      componentChildren,
      componentParent,
      componentEntryNode,
      componentMicroOffsets,
      componentMicroRanks,
      replacementOrder,
      replacementRanks,
      detachedNodeIds,
      detachedStartY: detachedRoots.length ? reachableBottom + DETACHED_GAP / 2 : null,
      positions,
      levels,
      routes,
      revealSteps,
      primaryRelationshipKeys,
      columns: Array.from({ length: maxDepth + 1 }, (_, depth) => ({
        depth,
        x: GRAPH_MARGIN_X + depth * COLUMN_GAP,
      })),
      center,
      centerNodeId: configuredRoot,
      width,
      height,
    };
  }

  function createLayoutController(nodes, graphRelationships, graphLayout) {
    const anchors = new Map([...graphLayout.positions].map(([nodeId, position]) => [nodeId, { ...position }]));
    const particles = new Map([...graphLayout.positions].map(([nodeId, position]) => [nodeId, {
      id: nodeId,
      x: position.x,
      y: position.y,
      vx: 0,
      vy: 0,
      pinned: null,
    }]));
    const motionProfiles = new Map([...particles.keys()].map((nodeId) => [nodeId, {
      phaseX: stableUnit(nodeId, "phase-x") * Math.PI * 2,
      phaseY: stableUnit(nodeId, "phase-y") * Math.PI * 2,
      periodX: 3.2 + stableUnit(nodeId, "period-x") * 1.2,
      periodY: 3.7 + stableUnit(nodeId, "period-y") * 1.1,
      amplitude: nodeId === String(graphLayout.centerNodeId) ? 0.58 : 0.82 + stableUnit(nodeId, "amplitude") * 0.18,
      blend: 0,
      offsetX: 0,
      offsetY: 0,
      velocityX: 0,
      velocityY: 0,
      forceX: 0,
      forceY: 0,
    }]));
    const connectionKeys = new Set();
    const connectionPairs = [];
    // Couple only authored flow. Derived management edges must not feed motion
    // back into the structural model they merely explain.
    graphRelationships.forEach((relationship) => {
      if (relationship.scope === "global" || relationship.endUp === "MANAGEMENT") return;
      const source = String(relationship.source);
      const target = String(relationship.target);
      if (source === target || !particles.has(source) || !particles.has(target)) return;
      const pair = [source, target].sort();
      const key = `${pair[0]}\u0000${pair[1]}`;
      if (connectionKeys.has(key)) return;
      connectionKeys.add(key);
      connectionPairs.push(pair);
    });
    const anchorCells = new Map();
    // Anchors never move, so nearby repulsion candidates can be bucketed once
    // instead of scanning every pair on every animation frame.
    anchors.forEach((anchor, nodeId) => {
      const center = nodeCenter(anchor, graphLayout, nodeId);
      const cellX = Math.floor(center.x / LOCAL_FORCE_RANGE);
      const cellY = Math.floor(center.y / LOCAL_FORCE_RANGE);
      const key = `${cellX}:${cellY}`;
      if (!anchorCells.has(key)) anchorCells.set(key, []);
      anchorCells.get(key).push({ center, nodeId });
    });
    const repulsionKeys = new Set();
    const repulsionPairs = [];
    anchorCells.forEach((entries, cellKey) => {
      const [cellX, cellY] = cellKey.split(":").map(Number);
      entries.forEach((entry) => {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const neighbors = anchorCells.get(`${cellX + offsetX}:${cellY + offsetY}`) || [];
            neighbors.forEach((neighbor) => {
              if (entry.nodeId === neighbor.nodeId) return;
              const pair = [entry.nodeId, neighbor.nodeId].sort();
              const key = `${pair[0]}\u0000${pair[1]}`;
              if (repulsionKeys.has(key)) return;
              if (Math.hypot(entry.center.x - neighbor.center.x, entry.center.y - neighbor.center.y)
                >= LOCAL_FORCE_RANGE) return;
              repulsionKeys.add(key);
              repulsionPairs.push(pair);
            });
          }
        }
      });
    });
    let lastFrameTime = null;

    function tick(iterations = 1) {
      let changed = false;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        particles.forEach((particle, nodeId) => {
          const position = graphLayout.positions.get(nodeId);
          if (particle.pinned) {
            particle.x = particle.pinned.x;
            particle.y = particle.pinned.y;
            particle.vx = 0;
            particle.vy = 0;
          } else {
            const anchor = anchors.get(nodeId);
            particle.vx = (particle.vx + (anchor.x - particle.x) * 0.16) * 0.72;
            particle.vy = (particle.vy + (anchor.y - particle.y) * 0.16) * 0.72;
            particle.x += particle.vx;
            particle.y += particle.vy;
            if (Math.hypot(anchor.x - particle.x, anchor.y - particle.y) < 0.08
              && Math.hypot(particle.vx, particle.vy) < 0.08) {
              particle.x = anchor.x;
              particle.y = anchor.y;
              particle.vx = 0;
              particle.vy = 0;
            }
          }
          if (Math.abs(position.x - particle.x) > 0.001 || Math.abs(position.y - particle.y) > 0.001) changed = true;
          position.x = particle.x;
          position.y = particle.y;
        });
      }
      return changed;
    }

    function pin(nodeId, x, y) {
      const particle = particles.get(String(nodeId));
      if (!particle) return false;
      particle.pinned = { x, y };
      particle.x = x;
      particle.y = y;
      particle.vx = 0;
      particle.vy = 0;
      const profile = motionProfiles.get(String(nodeId));
      profile.blend = 0;
      profile.offsetX = 0;
      profile.offsetY = 0;
      profile.velocityX = 0;
      profile.velocityY = 0;
      const position = graphLayout.positions.get(String(nodeId));
      position.x = x;
      position.y = y;
      return true;
    }

    function release(nodeId, velocityX = 0, velocityY = 0) {
      const particle = particles.get(String(nodeId));
      if (!particle) return false;
      particle.pinned = null;
      particle.vx = Math.max(-18, Math.min(18, velocityX / 180));
      particle.vy = Math.max(-18, Math.min(18, velocityY / 180));
      const profile = motionProfiles.get(String(nodeId));
      profile.blend = 0;
      profile.offsetX = 0;
      profile.offsetY = 0;
      profile.velocityX = 0;
      profile.velocityY = 0;
      return true;
    }

    function frame(timeMs, motionStrength = 1) {
      const timestamp = Number.isFinite(timeMs) ? timeMs : 0;
      const elapsedSeconds = lastFrameTime === null
        ? 1 / 60
        : Math.max(0, Math.min(0.05, (timestamp - lastFrameTime) / 1000));
      lastFrameTime = timestamp;
      let changed = tick(1);
      const strength = Math.max(0, Math.min(1, motionStrength));
      const seconds = timestamp / 1000;
      const hasPinnedParticle = [...particles.values()].some((particle) => Boolean(particle.pinned));
      particles.forEach((particle, nodeId) => {
        const profile = motionProfiles.get(nodeId);
        if (particle.pinned || strength === 0) {
          profile.offsetX = 0;
          profile.offsetY = 0;
          profile.velocityX = 0;
          profile.velocityY = 0;
          return;
        }
        profile.blend = Math.min(1, Math.max(
          hasPinnedParticle ? 0.55 : 0,
          profile.blend + elapsedSeconds / 0.7,
        ));
        const targetX = Math.sin(seconds * Math.PI * 2 / profile.periodX + profile.phaseX)
          * IDLE_MOTION_X * profile.amplitude * profile.blend * strength;
        const targetY = Math.cos(seconds * Math.PI * 2 / profile.periodY + profile.phaseY)
          * IDLE_MOTION_Y * profile.amplitude * profile.blend * strength;
        profile.forceX = (targetX - profile.offsetX) * MOTION_ANCHOR_SPRING;
        profile.forceY = (targetY - profile.offsetY) * MOTION_ANCHOR_SPRING;
      });
      connectionPairs.forEach(([sourceId, targetId]) => {
        const sourceParticle = particles.get(sourceId);
        const targetParticle = particles.get(targetId);
        const source = motionProfiles.get(sourceId);
        const target = motionProfiles.get(targetId);
        if (strength === 0) return;
        const sourceAnchor = anchors.get(sourceId);
        const targetAnchor = anchors.get(targetId);
        const sourceDisplacementX = sourceParticle.x - sourceAnchor.x + source.offsetX;
        const sourceDisplacementY = sourceParticle.y - sourceAnchor.y + source.offsetY;
        const targetDisplacementX = targetParticle.x - targetAnchor.x + target.offsetX;
        const targetDisplacementY = targetParticle.y - targetAnchor.y + target.offsetY;
        const springX = (targetDisplacementX - sourceDisplacementX) * LINK_OFFSET_SPRING * strength;
        const springY = (targetDisplacementY - sourceDisplacementY) * LINK_OFFSET_SPRING * strength;
        if (!sourceParticle.pinned) {
          source.forceX += springX;
          source.forceY += springY;
        }
        if (!targetParticle.pinned) {
          target.forceX -= springX;
          target.forceY -= springY;
        }
      });
      const applyRepulsion = (firstId, secondId) => {
        const firstParticle = particles.get(firstId);
        const secondParticle = particles.get(secondId);
        const first = motionProfiles.get(firstId);
        const second = motionProfiles.get(secondId);
        if (strength === 0) return;
        const firstRadius = nodeRadius(graphLayout, firstId);
        const secondRadius = nodeRadius(graphLayout, secondId);
        let deltaX = secondParticle.x + second.offsetX + secondRadius
          - firstParticle.x - first.offsetX - firstRadius;
        let deltaY = secondParticle.y + second.offsetY + secondRadius
          - firstParticle.y - first.offsetY - firstRadius;
        let distance = Math.hypot(deltaX, deltaY);
        if (distance < 0.001) {
          const angle = stableUnit(`${firstId}:${secondId}`, "repulsion") * Math.PI * 2;
          deltaX = Math.cos(angle);
          deltaY = Math.sin(angle);
          distance = 1;
        }
        const proximity = Math.max(0, 1 - distance / LOCAL_FORCE_RANGE);
        if (proximity === 0) return;
        const force = proximity * proximity * LOCAL_REPULSION * strength;
        const forceX = deltaX / distance * force;
        const forceY = deltaY / distance * force;
        if (!firstParticle.pinned) {
          first.forceX -= forceX;
          first.forceY -= forceY;
        }
        if (!secondParticle.pinned) {
          second.forceX += forceX;
          second.forceY += forceY;
        }
      };
      repulsionPairs.forEach(([firstId, secondId]) => applyRepulsion(firstId, secondId));
      if (hasPinnedParticle) {
        const dynamicRepulsionKeys = new Set();
        particles.forEach((particle, nodeId) => {
          if (!particle.pinned) return;
          particles.forEach((otherParticle, otherId) => {
            if (nodeId === otherId) return;
            const pair = [nodeId, otherId].sort();
            const key = `${pair[0]}\u0000${pair[1]}`;
            if (repulsionKeys.has(key) || dynamicRepulsionKeys.has(key)) return;
            dynamicRepulsionKeys.add(key);
            applyRepulsion(pair[0], pair[1]);
          });
        });
      }
      const damping = Math.exp(-MOTION_DAMPING * elapsedSeconds);
      particles.forEach((particle, nodeId) => {
        const profile = motionProfiles.get(nodeId);
        if (particle.pinned || strength === 0) return;
        const forceBlend = profile.blend * strength;
        profile.velocityX = (profile.velocityX + profile.forceX * forceBlend * elapsedSeconds) * damping;
        profile.velocityY = (profile.velocityY + profile.forceY * forceBlend * elapsedSeconds) * damping;
        profile.offsetX += profile.velocityX * elapsedSeconds;
        profile.offsetY += profile.velocityY * elapsedSeconds;
        const displacement = Math.hypot(profile.offsetX, profile.offsetY);
        if (displacement > MAX_IDLE_DISPLACEMENT) {
          const scale = MAX_IDLE_DISPLACEMENT / displacement;
          profile.offsetX *= scale;
          profile.offsetY *= scale;
          const outwardVelocity = profile.velocityX * profile.offsetX + profile.velocityY * profile.offsetY;
          if (outwardVelocity > 0) {
            const inverseSquaredLength = 1 / (MAX_IDLE_DISPLACEMENT * MAX_IDLE_DISPLACEMENT);
            profile.velocityX -= outwardVelocity * profile.offsetX * inverseSquaredLength;
            profile.velocityY -= outwardVelocity * profile.offsetY * inverseSquaredLength;
          }
        }
        const position = graphLayout.positions.get(nodeId);
        const nextX = particle.x + profile.offsetX;
        const nextY = particle.y + profile.offsetY;
        if (Math.abs(position.x - nextX) > 0.001 || Math.abs(position.y - nextY) > 0.001) changed = true;
        position.x = nextX;
        position.y = nextY;
      });
      return changed;
    }

    function isActive() {
      return [...particles].some(([nodeId, particle]) => {
        if (particle.pinned) return true;
        const anchor = anchors.get(nodeId);
        return Math.hypot(anchor.x - particle.x, anchor.y - particle.y) >= 0.08
          || Math.hypot(particle.vx, particle.vy) >= 0.08;
      });
    }

    const crossingCount = () => countEdgeCrossings(graphRelationships, graphLayout);
    return {
      anchors,
      connectionPairs,
      crossingCount,
      frame,
      isActive,
      motionProfiles,
      particles,
      pin,
      release,
      repulsionPairs,
      tick,
    };
  }

  function nodeRadius(graphLayout, nodeId) {
    return graphLayout.nodeSizes?.get(String(nodeId))?.radius || BASE_NODE_RADIUS;
  }

  function viewBounds(graphLayout, padding = 130) {
    const entries = [...graphLayout.positions.entries()];
    if (!entries.length) return { x: -380, y: -240, width: 760, height: 480 };
    let minimumX = Infinity;
    let minimumY = Infinity;
    let maximumX = -Infinity;
    let maximumY = -Infinity;
    entries.forEach(([nodeId, position]) => {
      const radius = nodeRadius(graphLayout, nodeId);
      const center = nodeCenter(position, graphLayout, nodeId);
      minimumX = Math.min(minimumX, center.x - Math.max(radius, 72));
      maximumX = Math.max(maximumX, center.x + Math.max(radius, 72));
      minimumY = Math.min(minimumY, center.y - radius);
      maximumY = Math.max(maximumY, center.y + radius + 30);
    });
    return {
      x: minimumX - padding,
      y: minimumY - padding,
      width: Math.max(760, maximumX - minimumX + padding * 2),
      height: Math.max(480, maximumY - minimumY + padding * 2),
    };
  }

  function nodeCenter(position, graphLayout, nodeId) {
    const radius = nodeRadius(graphLayout, nodeId);
    return {
      x: position.x + radius,
      y: position.y + radius,
    };
  }

  function curveGeometry(source, target, graphLayout, relationship) {
    const sourceCenter = nodeCenter(source, graphLayout, relationship.source);
    const targetCenter = nodeCenter(target, graphLayout, relationship.target);
    const start = sourceCenter;
    const end = targetCenter;
    const route = graphLayout.routes?.get(relationshipKey(relationship));
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const localCurve = (bend, lane = stablePairLane(relationship)) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const normal = { x: -dy / distance * lane, y: dx / distance * lane };
      return {
        start,
        end,
        control1: {
          x: start.x + dx * 0.34 + normal.x * bend,
          y: start.y + dy * 0.34 + normal.y * bend,
        },
        control2: {
          x: start.x + dx * 0.66 + normal.x * bend,
          y: start.y + dy * 0.66 + normal.y * bend,
        },
      };
    };
    if (route?.kind === "replace-local") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const bend = Math.min(58, 24 + distance * 0.08);
      return localCurve(bend);
    }
    const sameDepthGoto = relationship.endUp === "GOTO"
      && graphLayout.levels?.get(relationship.source) === graphLayout.levels?.get(relationship.target);
    if (sameDepthGoto) {
      return localCurve(route?.kind === "goto-cycle" ? 72 : 38);
    }
    if (route?.kind === "goto-cycle" || end.x <= start.x + 20) {
      const lane = route?.lane || stableRouteLane(relationship);
      const outerY = Math.min(start.y, end.y) - 118 - Math.abs(start.x - end.x) * 0.08;
      return {
        start,
        end,
        control1: { x: start.x + 84 * lane, y: outerY },
        control2: { x: end.x - 84 * lane, y: outerY },
      };
    }
    const laneOffset = route?.kind === "cross" ? (route.lane || 1) * 46 : 0;
    return {
      start,
      end,
      control1: { x: midpoint.x, y: start.y + laneOffset },
      control2: { x: midpoint.x, y: end.y + laneOffset },
    };
  }

  function edgePath(source, target, graphLayout, index, endUp, relationship = null) {
    const currentRelationship = relationship || { source: "", target: "", endUp };
    if (source.x === target.x && source.y === target.y) {
      const radius = nodeRadius(graphLayout, currentRelationship.source);
      const center = nodeCenter(source, graphLayout, currentRelationship.source);
      const loopX = center.x + radius + 62 + (index % 3) * 18;
      return `M ${center.x} ${center.y} C ${loopX} ${center.y - 70}, ${loopX} ${center.y + 70}, ${center.x} ${center.y}`;
    }
    const geometry = curveGeometry(source, target, graphLayout, currentRelationship);
    if (!geometry.control1 || !geometry.control2) {
      return `M ${geometry.start.x} ${geometry.start.y} L ${geometry.end.x} ${geometry.end.y}`;
    }
    return `M ${geometry.start.x} ${geometry.start.y} C ${geometry.control1.x} ${geometry.control1.y}, ${geometry.control2.x} ${geometry.control2.y}, ${geometry.end.x} ${geometry.end.y}`;
  }

  function arrowPolygon(tip, direction) {
    const length = Math.max(1, Math.hypot(direction.x, direction.y));
    const unitX = direction.x / length;
    const unitY = direction.y / length;
    const baseX = tip.x - unitX * ARROW_LENGTH;
    const baseY = tip.y - unitY * ARROW_LENGTH;
    const perpendicularX = -unitY * ARROW_HALF_WIDTH;
    const perpendicularY = unitX * ARROW_HALF_WIDTH;
    return [
      `${tip.x},${tip.y}`,
      `${baseX + perpendicularX},${baseY + perpendicularY}`,
      `${baseX - perpendicularX},${baseY - perpendicularY}`,
    ].join(" ");
  }

  function edgeArrowPoints(source, target, graphLayout, index, endUp, relationship = null, placement = "end") {
    const currentRelationship = relationship || { source: "", target: "", endUp };
    const atStart = placement === "start";
    const sourceRadius = nodeRadius(graphLayout, currentRelationship.source);
    const targetRadius = nodeRadius(graphLayout, currentRelationship.target);

    if (source.x === target.x && source.y === target.y) {
      const center = nodeCenter(source, graphLayout, currentRelationship.source);
      const loopX = center.x + sourceRadius + 62 + (index % 3) * 18;
      const tangent = atStart
        ? { x: loopX - center.x, y: -70 }
        : { x: center.x - loopX, y: -70 };
      const tangentLength = Math.max(1, Math.hypot(tangent.x, tangent.y));
      const unit = { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
      const direction = atStart ? { x: -unit.x, y: -unit.y } : unit;
      const radius = atStart ? sourceRadius : targetRadius;
      const tip = atStart
        ? { x: center.x + unit.x * radius, y: center.y + unit.y * radius }
        : { x: center.x - unit.x * radius, y: center.y - unit.y * radius };
      return arrowPolygon(tip, direction);
    }

    const geometry = curveGeometry(source, target, graphLayout, currentRelationship);
    const forwardTangent = atStart
      ? {
          x: (geometry.control1?.x ?? geometry.end.x) - geometry.start.x,
          y: (geometry.control1?.y ?? geometry.end.y) - geometry.start.y,
        }
      : {
          x: geometry.end.x - (geometry.control2?.x ?? geometry.start.x),
          y: geometry.end.y - (geometry.control2?.y ?? geometry.start.y),
        };
    const tangentLength = Math.max(1, Math.hypot(forwardTangent.x, forwardTangent.y));
    const unit = { x: forwardTangent.x / tangentLength, y: forwardTangent.y / tangentLength };
    const direction = atStart ? { x: -unit.x, y: -unit.y } : unit;
    const tip = atStart
      ? {
          x: geometry.start.x + unit.x * sourceRadius,
          y: geometry.start.y + unit.y * sourceRadius,
        }
      : {
          x: geometry.end.x - unit.x * targetRadius,
          y: geometry.end.y - unit.y * targetRadius,
        };
    return arrowPolygon(tip, direction);
  }

  return {
    countEdgeCrossings,
    createLayoutController,
    edgeArrowPoints,
    edgePath,
    layout,
    relationshipKey,
    relationships,
    viewBounds,
  };
});
