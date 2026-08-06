"use strict";

(function exposeGraphModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneGraphModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const BASE_NODE_RADIUS = 19;
  const MAX_NODE_RADIUS = 32;
  const BASE_CLUSTER_RADIUS = 235;
  const REPLACE_DISTANCE = 210;
  const DESCENDANT_DECAY = 0.68;
  const ARROW_LENGTH = 20;
  const ARROW_HALF_WIDTH = 7;
  const CROSSING_FORCE = 0.92;
  const CROSSING_CHECK_INTERVAL = 3;
  const MAX_CROSSINGS_PER_PASS = 96;

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

  function routePriority(relationship, graphLayout) {
    const kind = graphLayout.routes?.get(relationshipKey(relationship))?.kind;
    if (kind === "tree") return 4;
    if (kind === "goto-cycle") return 3.4;
    if (kind === "replace-local") return 2.4;
    if (kind === "cross") return 1.7;
    if (kind === "management") return 0.55;
    return 1;
  }

  function stableRouteLane(relationship) {
    const key = relationshipKey(relationship);
    let hash = 0;
    for (let index = 0; index < key.length; index += 1) {
      hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
    }
    return hash % 2 === 0 ? -1 : 1;
  }

  function hierarchyChildren(nodes, graphRelationships) {
    const children = new Map(nodes.map((node) => [String(node.id), new Set()]));
    graphRelationships.forEach((relationship) => {
      if (relationship.scope === "global" || !["GOTO", "MANAGEMENT"].includes(relationship.endUp)) return;
      children.get(relationship.source)?.add(relationship.target);
    });
    return children;
  }

  function hierarchyRelationshipsBySource(nodes, graphRelationships) {
    const nodeIds = new Set(nodes.map((node) => String(node.id)));
    const bySource = new Map([...nodeIds].map((nodeId) => [nodeId, []]));
    graphRelationships.forEach((relationship) => {
      if (
        relationship.scope === "global"
        || !["GOTO", "MANAGEMENT"].includes(relationship.endUp)
        || !nodeIds.has(relationship.source)
        || !nodeIds.has(relationship.target)
      ) return;
      bySource.get(relationship.source).push(relationship);
    });
    return bySource;
  }

  function growthStagesFromOrbit(rootId, orderedNodeIds, orbitKinds, orbitParents) {
    if (!rootId) return orderedNodeIds.length ? [{ kind: "detached", nodeIds: orderedNodeIds }] : [];
    const stages = [{ kind: "root", nodeIds: [rootId] }];
    const active = new Set([rootId]);
    const pending = new Set(orderedNodeIds.filter((nodeId) => nodeId !== rootId));

    while (pending.size) {
      let grewGoto = false;
      while (true) {
        const nextGoto = [...pending].filter((nodeId) => (
          orbitKinds.get(nodeId) === "GOTO" && active.has(orbitParents.get(nodeId))
        ));
        if (!nextGoto.length) break;
        stages.push({ kind: "goto", nodeIds: nextGoto });
        nextGoto.forEach((nodeId) => {
          active.add(nodeId);
          pending.delete(nodeId);
        });
        grewGoto = true;
      }

      const nextReplace = [...pending].filter((nodeId) => (
        orbitKinds.get(nodeId) === "MANAGEMENT" && active.has(orbitParents.get(nodeId))
      ));
      if (nextReplace.length) {
        stages.push({ kind: "replace", nodeIds: nextReplace });
        nextReplace.forEach((nodeId) => {
          active.add(nodeId);
          pending.delete(nodeId);
        });
        continue;
      }
      if (!grewGoto) break;
    }

    if (pending.size) stages.push({ kind: "detached", nodeIds: [...pending] });
    return stages;
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
    const globalNode = nodes.find((node) => node.isGlobal || String(node.id) === "__global__") || null;
    const realNodes = nodes.filter((node) => node !== globalNode).sort(compareNodes);
    const requestedRoot = String(rootNodeId || "");
    const configuredRoot = realNodes.some((node) => String(node.id) === requestedRoot)
      ? requestedRoot
      : String(realNodes[0]?.id || "");
    const orderedNodes = [
      ...realNodes.filter((node) => String(node.id) === configuredRoot),
      ...realNodes.filter((node) => String(node.id) !== configuredRoot),
    ];
    const count = Math.max(1, realNodes.length);
    const width = Math.max(1200, Math.ceil(Math.sqrt(count)) * 360);
    const height = Math.max(820, Math.ceil(Math.sqrt(count)) * 300);
    const center = { x: width / 2, y: height / 2 };
    const positions = new Map();
    const childTargets = hierarchyChildren(nodes, graphRelationships);
    const hierarchyMetrics = new Map(nodes.map((node) => {
      const nodeId = String(node.id);
      return [nodeId, descendantMetrics(nodeId, childTargets)];
    }));
    const nodeSizes = new Map(nodes.map((node) => {
      const nodeId = String(node.id);
      const directChildCount = childTargets.get(nodeId)?.size || 0;
      const { descendantCount, inheritedLoad } = hierarchyMetrics.get(nodeId);
      const compressedLoad = Math.log2(1 + inheritedLoad);
      const radius = Math.min(MAX_NODE_RADIUS, BASE_NODE_RADIUS + compressedLoad * 3.25);
      const chargeScale = Math.min(4.4, 1 + compressedLoad * 0.78);
      const clusterRadius = BASE_CLUSTER_RADIUS + Math.sqrt(directChildCount) * 34 + compressedLoad * 18;
      return [nodeId, {
        radius,
        childCount: descendantCount,
        directChildCount,
        descendantCount,
        inheritedLoad,
        chargeScale,
        clusterRadius,
      }];
    }));
    const orbitAngles = new Map();
    const orbitParents = new Map();
    const orbitKinds = new Map();
    const nodeById = new Map(realNodes.map((node) => [String(node.id), node]));
    const orbitChildren = new Map(realNodes.map((node) => [String(node.id), new Set()]));
    const hierarchyRelationships = hierarchyRelationshipsBySource(nodes, graphRelationships);
    const assignedOrbitParent = new Set(configuredRoot ? [configuredRoot] : []);
    const orbitQueue = configuredRoot ? [configuredRoot] : [];
    while (orbitQueue.length) {
      const parentId = orbitQueue.shift();
      const candidates = [...(hierarchyRelationships.get(parentId) || [])]
        .filter((relationship) => nodeById.has(relationship.target))
        .sort((left, right) => (
          (left.endUp === "GOTO" ? 0 : 1) - (right.endUp === "GOTO" ? 0 : 1)
          || compareNodes(nodeById.get(left.target), nodeById.get(right.target))
        ));
      candidates.forEach((relationship) => {
        const childId = relationship.target;
        if (assignedOrbitParent.has(childId)) return;
        assignedOrbitParent.add(childId);
        orbitChildren.get(parentId).add(childId);
        orbitParents.set(childId, parentId);
        orbitKinds.set(childId, relationship.endUp);
        orbitQueue.push(childId);
      });
    }
    const placed = new Set();
    if (configuredRoot) {
      const rootRadius = nodeSizes.get(configuredRoot).radius;
      positions.set(configuredRoot, { x: center.x - rootRadius, y: center.y - rootRadius });
      placed.add(configuredRoot);
      const queue = [{ nodeId: configuredRoot, entryAngle: -Math.PI / 2 }];
      while (queue.length) {
        const current = queue.shift();
        const parentPosition = positions.get(current.nodeId);
        const parentSize = nodeSizes.get(current.nodeId);
        const parentCenter = {
          x: parentPosition.x + parentSize.radius,
          y: parentPosition.y + parentSize.radius,
        };
        const children = [...(orbitChildren.get(current.nodeId) || [])]
          .filter((childId) => nodeById.has(childId))
          .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)));
        children.forEach((childId, index) => {
          const angle = current.entryAngle + (Math.PI * 2 * index / Math.max(1, children.length));
          orbitAngles.set(`${current.nodeId}\u0000${childId}`, angle);
          if (placed.has(childId)) return;
          const childRadius = nodeSizes.get(childId).radius;
          positions.set(childId, {
            x: parentCenter.x + Math.cos(angle) * parentSize.clusterRadius - childRadius,
            y: parentCenter.y + Math.sin(angle) * parentSize.clusterRadius - childRadius,
          });
          placed.add(childId);
          queue.push({ nodeId: childId, entryAngle: angle + Math.PI / 2 });
        });
      }
    }
    const unplaced = orderedNodes.filter((node) => !placed.has(String(node.id)));
    const detachedRadius = (nodeSizes.get(configuredRoot)?.clusterRadius || BASE_CLUSTER_RADIUS) * 1.7;
    unplaced.forEach((node, index) => {
      const nodeId = String(node.id);
      const radius = nodeSizes.get(nodeId).radius;
      const angle = -Math.PI / 2 + Math.PI * 2 * index / Math.max(1, unplaced.length);
      positions.set(nodeId, {
        x: center.x + Math.cos(angle) * detachedRadius - radius,
        y: center.y + Math.sin(angle) * detachedRadius - radius,
      });
    });
    if (globalNode) {
      const globalId = String(globalNode.id);
      const globalRadius = nodeSizes.get(globalId).radius;
      const globalOffset = (nodeSizes.get(configuredRoot)?.clusterRadius || BASE_CLUSTER_RADIUS) + 210;
      positions.set(globalId, { x: center.x - globalRadius, y: center.y - globalOffset - globalRadius });
    }

    const localGoto = graphRelationships.filter((relationship) => (
      relationship.scope !== "global" && relationship.endUp === "GOTO" && !relationship.cycle
    ));
    const levels = new Map();
    if (configuredRoot && positions.has(configuredRoot)) levels.set(configuredRoot, 0);
    const primaryRelationshipKeys = new Set();
    const queue = configuredRoot ? [configuredRoot] : [];
    while (queue.length) {
      const source = queue.shift();
      const nextLevel = (levels.get(source) || 0) + 1;
      localGoto
        .filter((relationship) => relationship.source === source)
        .forEach((relationship) => {
          if (levels.has(relationship.target)) return;
          levels.set(relationship.target, nextLevel);
          primaryRelationshipKeys.add(relationshipKey(relationship));
          queue.push(relationship.target);
        });
    }
    realNodes.forEach((node) => {
      if (!levels.has(String(node.id))) levels.set(String(node.id), 0);
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
        lane: kind === "cross" ? stableRouteLane(relationship) : 0,
      });
    });
    const growthStages = growthStagesFromOrbit(
      configuredRoot,
      orderedNodes.map((node) => String(node.id)),
      orbitKinds,
      orbitParents,
    );

    return {
      nodeWidth: BASE_NODE_RADIUS * 2,
      nodeHeight: BASE_NODE_RADIUS * 2,
      nodeSizes,
      hierarchyChildren: childTargets,
      orbitChildren,
      hierarchyDepths: new Map([...hierarchyMetrics].map(([nodeId, metrics]) => [nodeId, metrics.depths])),
      orbitAngles,
      orbitKinds,
      orbitParents,
      growthStages,
      positions,
      levels,
      routes,
      primaryRelationshipKeys,
      center,
      centerNodeId: configuredRoot,
      width,
      height,
    };
  }

  function createForceSimulation(nodes, graphRelationships, graphLayout, rootNodeId = null) {
    const globalNodeIds = new Set(nodes
      .filter((node) => node.isGlobal || String(node.id) === "__global__")
      .map((node) => String(node.id)));
    const rootId = String(graphLayout.centerNodeId || rootNodeId || "");
    const particles = new Map();
    graphLayout.positions.forEach((position, nodeId) => {
      const size = graphLayout.nodeSizes.get(nodeId);
      particles.set(nodeId, {
        id: nodeId,
        x: position.x,
        y: position.y,
        radius: size.radius,
        chargeScale: globalNodeIds.has(nodeId) ? Math.min(0.72, size.chargeScale) : size.chargeScale,
        vx: 0,
        vy: 0,
        pinned: null,
        global: globalNodeIds.has(nodeId),
      });
    });
    const physicalRelationships = graphRelationships.filter((relationship) => (
      relationship.scope !== "global"
      && relationship.source !== relationship.target
      && particles.has(relationship.source)
      && particles.has(relationship.target)
    ));
    const connectedNodeIds = new Set(physicalRelationships.flatMap((relationship) => (
      [relationship.source, relationship.target]
    )));
    let alpha = 1;
    let tickCount = 0;
    let activeNodeIds = null;
    let growthSettled = false;

    const centerOf = (particle) => ({
      x: particle.x + particle.radius,
      y: particle.y + particle.radius,
    });
    const addForce = (particle, x, y) => {
      if (particle.pinned) return;
      particle.vx += x * alpha;
      particle.vy += y * alpha;
    };
    const activeRelationships = () => activeNodeIds === null
      ? physicalRelationships
      : physicalRelationships.filter((relationship) => (
          activeNodeIds.has(relationship.source) && activeNodeIds.has(relationship.target)
        ));

    const crossingCandidate = (segment, ratio, otherSegment) => {
      const endpointChoices = ratio <= 0.5
        ? [
            { movingId: segment.relationship.source, fixedId: segment.relationship.target, distanceRatio: ratio },
            { movingId: segment.relationship.target, fixedId: segment.relationship.source, distanceRatio: 1 - ratio },
          ]
        : [
            { movingId: segment.relationship.target, fixedId: segment.relationship.source, distanceRatio: 1 - ratio },
            { movingId: segment.relationship.source, fixedId: segment.relationship.target, distanceRatio: ratio },
          ];
      const choice = endpointChoices.find((item) => !particles.get(item.movingId)?.pinned);
      if (!choice) return null;
      const moving = particles.get(choice.movingId);
      const fixed = particles.get(choice.fixedId);
      if (!moving || !fixed) return null;
      const otherVector = {
        x: otherSegment.end.x - otherSegment.start.x,
        y: otherSegment.end.y - otherSegment.start.y,
      };
      const otherLength = Math.max(1, Math.hypot(otherVector.x, otherVector.y));
      const fixedCenter = centerOf(fixed);
      let side = cross(otherVector, {
        x: fixedCenter.x - otherSegment.start.x,
        y: fixedCenter.y - otherSegment.start.y,
      });
      if (Math.abs(side) < 0.000001) {
        side = choice.movingId.localeCompare(choice.fixedId) <= 0 ? -1 : 1;
      }
      const directionSign = Math.sign(side);
      const direction = {
        x: -otherVector.y / otherLength * directionSign,
        y: otherVector.x / otherLength * directionSign,
      };
      const nodeSize = graphLayout.nodeSizes.get(choice.movingId);
      const structuralCost = choice.movingId === rootId
        ? 8
        : 1 + Math.min(2.2, (nodeSize?.directChildCount || 0) * 0.35);
      return {
        ...choice,
        moving,
        fixed,
        direction,
        cost: routePriority(segment.relationship, graphLayout)
          * (0.22 + choice.distanceRatio)
          * structuralCost,
      };
    };

    const adjustOrbitTarget = (candidate, strength) => {
      const parentId = graphLayout.orbitParents?.get(candidate.moving.id);
      if (!parentId) return;
      const parent = particles.get(parentId);
      if (!parent) return;
      const parentCenter = centerOf(parent);
      const movingCenter = centerOf(candidate.moving);
      const radialX = movingCenter.x - parentCenter.x;
      const radialY = movingCenter.y - parentCenter.y;
      const radius = Math.max(1, Math.hypot(radialX, radialY));
      const tangent = { x: -radialY / radius, y: radialX / radius };
      const tangentDirection = candidate.direction.x * tangent.x + candidate.direction.y * tangent.y;
      if (Math.abs(tangentDirection) < 0.08) return;
      const angleKey = `${parentId}\u0000${candidate.moving.id}`;
      const currentAngle = graphLayout.orbitAngles?.get(angleKey);
      if (!Number.isFinite(currentAngle)) return;
      graphLayout.orbitAngles.set(angleKey, currentAngle + tangentDirection * strength * 0.012);
    };

    const applyCrossingPenalties = () => {
      const crossings = crossingPairs(activeRelationships(), (nodeId) => {
        const particle = particles.get(nodeId);
        return particle ? centerOf(particle) : null;
      });
      crossings.slice(0, MAX_CROSSINGS_PER_PASS).forEach(({ first, second, intersection }) => {
        const firstCandidate = crossingCandidate(first, intersection.firstRatio, second);
        const secondCandidate = crossingCandidate(second, intersection.secondRatio, first);
        const candidate = !firstCandidate ? secondCandidate
          : !secondCandidate ? firstCandidate
            : firstCandidate.cost <= secondCandidate.cost ? firstCandidate : secondCandidate;
        if (!candidate) return;
        const strength = CROSSING_FORCE * (0.42 + intersection.angleFactor * 0.58);
        addForce(candidate.moving, candidate.direction.x * strength, candidate.direction.y * strength);
        addForce(candidate.fixed, -candidate.direction.x * strength * 0.12, -candidate.direction.y * strength * 0.12);
        adjustOrbitTarget(candidate, strength);
      });
      return crossings.length;
    };

    function tick(iterations = 1) {
      let changed = false;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const particleList = [...particles.values()].filter((particle) => (
          activeNodeIds === null || activeNodeIds.has(particle.id)
        ));
        const anyPinned = particleList.some((particle) => particle.pinned);
        if (!anyPinned && alpha < 0.002) break;

        for (let leftIndex = 0; leftIndex < particleList.length; leftIndex += 1) {
          const left = particleList[leftIndex];
          const leftCenter = centerOf(left);
          for (let rightIndex = leftIndex + 1; rightIndex < particleList.length; rightIndex += 1) {
            const right = particleList[rightIndex];
            const rightCenter = centerOf(right);
            let dx = rightCenter.x - leftCenter.x;
            let dy = rightCenter.y - leftCenter.y;
            let distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < 1) {
              dx = left.id.localeCompare(right.id) <= 0 ? 1 : -1;
              dy = 0.35;
              distanceSquared = dx * dx + dy * dy;
            }
            const distance = Math.sqrt(distanceSquared);
            const hierarchyDepth = graphLayout.hierarchyDepths?.get(left.id)?.get(right.id)
              || graphLayout.hierarchyDepths?.get(right.id)?.get(left.id)
              || 0;
            // Related nodes still need meaningful personal space. A square-root
            // falloff keeps ROOT from overpowering an entire branch, while no
            // longer making grandchildren almost invisible to their ancestor.
            const ancestryFactor = hierarchyDepth
              ? hierarchyDepth === 1
                ? 0.34
                : Math.max(0.24, 0.59 / Math.sqrt(hierarchyDepth))
              : 1;
            const leftCharge = hierarchyDepth ? 1 + (left.chargeScale - 1) * 0.2 : left.chargeScale;
            const rightCharge = hierarchyDepth ? 1 + (right.chargeScale - 1) * 0.2 : right.chargeScale;
            const repulsion = Math.min(
              4.2,
              65000 * Math.sqrt(leftCharge * rightCharge) * ancestryFactor / distanceSquared,
            );
            const fx = dx / distance * repulsion;
            const fy = dy / distance * repulsion;
            addForce(left, -fx, -fy);
            addForce(right, fx, fy);

            const minimumDistance = left.radius + right.radius + 64;
            if (distance < minimumDistance) {
              const push = (minimumDistance - distance) * 0.075;
              const pushX = dx / distance * push;
              const pushY = dy / distance * push;
              addForce(left, -pushX, -pushY);
              addForce(right, pushX, pushY);
            }
          }
        }

        activeRelationships().forEach((relationship) => {
          const source = particles.get(relationship.source);
          const target = particles.get(relationship.target);
          const sourceCenter = centerOf(source);
          const targetCenter = centerOf(target);
          const dx = targetCenter.x - sourceCenter.x;
          const dy = targetCenter.y - sourceCenter.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const sourceSize = graphLayout.nodeSizes.get(relationship.source);
          const desired = relationship.endUp === "REPLACE"
            ? REPLACE_DISTANCE
            : sourceSize?.clusterRadius || BASE_CLUSTER_RADIUS;
          const strength = relationship.endUp === "REPLACE"
            ? 0.006
            : relationship.endUp === "MANAGEMENT" ? 0.0065 : 0.009;
          const force = (distance - desired) * strength;
          const fx = dx / distance * force;
          const fy = dy / distance * force;
          addForce(source, fx, fy);
          addForce(target, -fx, -fy);

          if (["GOTO", "MANAGEMENT"].includes(relationship.endUp)) {
            const targetAngle = graphLayout.orbitAngles?.get(`${relationship.source}\u0000${relationship.target}`);
            if (Number.isFinite(targetAngle)) {
              const currentAngle = Math.atan2(dy, dx);
              let angleDifference = targetAngle - currentAngle;
              while (angleDifference > Math.PI) angleDifference -= Math.PI * 2;
              while (angleDifference < -Math.PI) angleDifference += Math.PI * 2;
              const tangentialForce = Math.max(-2.4, Math.min(2.4, angleDifference * distance * 0.0045));
              const tangentX = -dy / distance * tangentialForce;
              const tangentY = dx / distance * tangentialForce;
              addForce(target, tangentX, tangentY);
              addForce(source, -tangentX * 0.18, -tangentY * 0.18);
            }
          }
        });

        tickCount += 1;
        if (tickCount % CROSSING_CHECK_INTERVAL === 0) applyCrossingPenalties();

        particleList.forEach((particle) => {
          const globalOffset = (graphLayout.nodeSizes.get(rootId)?.clusterRadius || BASE_CLUSTER_RADIUS) + 210;
          const target = particle.global
            ? { x: graphLayout.center.x - particle.radius, y: graphLayout.center.y - globalOffset - particle.radius }
            : { x: graphLayout.center.x - particle.radius, y: graphLayout.center.y - particle.radius };
          const structurallyConnected = connectedNodeIds.has(particle.id);
          const anchorStrength = particle.global ? 0.018
            : particle.id === rootId ? 0.055
              : structurallyConnected ? 0.00008 : 0.00032;
          addForce(particle, (target.x - particle.x) * anchorStrength, (target.y - particle.y) * anchorStrength);

          if (particle.pinned) {
            particle.x = particle.pinned.x;
            particle.y = particle.pinned.y;
            particle.vx = 0;
            particle.vy = 0;
          } else {
            particle.vx *= 0.86;
            particle.vy *= 0.86;
            const speed = Math.hypot(particle.vx, particle.vy);
            if (speed > 14) {
              particle.vx = particle.vx / speed * 14;
              particle.vy = particle.vy / speed * 14;
            }
            particle.x += particle.vx;
            particle.y += particle.vy;
          }
          if (!Number.isFinite(particle.x) || !Number.isFinite(particle.y)) {
            particle.x = target.x;
            particle.y = target.y;
            particle.vx = 0;
            particle.vy = 0;
          }
          const position = graphLayout.positions.get(particle.id);
          if (Math.abs(position.x - particle.x) > 0.001 || Math.abs(position.y - particle.y) > 0.001) changed = true;
          position.x = particle.x;
          position.y = particle.y;
        });
        alpha = anyPinned ? Math.max(alpha * 0.992, 0.22) : alpha * 0.988;
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
      graphLayout.positions.get(String(nodeId)).x = x;
      graphLayout.positions.get(String(nodeId)).y = y;
      alpha = Math.max(alpha, 0.4);
      return true;
    }

    function release(nodeId, velocityX = 0, velocityY = 0) {
      const particle = particles.get(String(nodeId));
      if (!particle) return false;
      particle.pinned = null;
      particle.vx = Math.max(-14, Math.min(14, velocityX / 60));
      particle.vy = Math.max(-14, Math.min(14, velocityY / 60));
      alpha = Math.max(alpha, 0.52);
      return true;
    }

    function reheat(value = 0.7) {
      alpha = Math.max(alpha, value);
    }

    function isActive() {
      return alpha >= 0.002 || [...particles.values()].some((particle) => (
        particle.pinned && (activeNodeIds === null || activeNodeIds.has(particle.id))
      ));
    }

    function settleGrowth(stageBudget = 132, finalTicks = 160) {
      if (growthSettled) return { stageCount: graphLayout.growthStages?.length || 0 };
      const stages = graphLayout.growthStages || [];
      if (!stages.length) {
        activeNodeIds = null;
        tick(finalTicks);
        growthSettled = true;
        return { stageCount: 0 };
      }

      activeNodeIds = new Set();
      const growingStages = Math.max(1, stages.length - 1);
      const ticksPerStage = Math.max(2, Math.min(24, Math.floor(stageBudget / growingStages)));
      stages.forEach((stage, stageIndex) => {
        stage.nodeIds.forEach((nodeId) => {
          const particle = particles.get(nodeId);
          if (!particle) return;
          const parentId = graphLayout.orbitParents?.get(nodeId);
          const parent = parentId ? particles.get(parentId) : null;
          if (parent && activeNodeIds.has(parentId)) {
            const parentCenter = centerOf(parent);
            const angle = graphLayout.orbitAngles?.get(`${parentId}\u0000${nodeId}`) || 0;
            const birthDistance = Math.max(78, parent.radius + particle.radius + 34);
            particle.x = parentCenter.x + Math.cos(angle) * birthDistance - particle.radius;
            particle.y = parentCenter.y + Math.sin(angle) * birthDistance - particle.radius;
          }
          particle.vx = 0;
          particle.vy = 0;
          const position = graphLayout.positions.get(nodeId);
          position.x = particle.x;
          position.y = particle.y;
          activeNodeIds.add(nodeId);
        });
        if (stageIndex === 0) return;
        alpha = Math.max(alpha, stage.kind === "replace" ? 0.68 : 0.76);
        tick(ticksPerStage);
      });

      activeNodeIds = null;
      alpha = Math.max(alpha, 0.92);
      tick(finalTicks);
      growthSettled = true;
      return { stageCount: stages.length, ticksPerStage };
    }

    const crossingCount = () => crossingPairs(physicalRelationships, (nodeId) => {
      const particle = particles.get(nodeId);
      return particle ? centerOf(particle) : null;
    }).length;

    return { crossingCount, isActive, particles, pin, reheat, release, settleGrowth, tick };
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
    const centerPosition = graphLayout.positions.get(String(graphLayout.centerNodeId || ""));
    const viewCenter = centerPosition
      ? nodeCenter(centerPosition, graphLayout, graphLayout.centerNodeId)
      : { x: (minimumX + maximumX) / 2, y: (minimumY + maximumY) / 2 };
    const halfWidth = Math.max(380, viewCenter.x - minimumX, maximumX - viewCenter.x) + padding;
    const halfHeight = Math.max(240, viewCenter.y - minimumY, maximumY - viewCenter.y) + padding;
    return {
      x: viewCenter.x - halfWidth,
      y: viewCenter.y - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
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
    if (route?.kind === "goto-cycle") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      return {
        start,
        end,
        control: { x: midpoint.x - dy / distance * 96, y: midpoint.y + dx / distance * 96 },
      };
    }
    if (route?.kind === "replace-local") {
      const center = graphLayout.center || { x: 0, y: 0 };
      let dx = midpoint.x - center.x;
      let dy = midpoint.y - center.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 1) {
        dx = -(end.y - start.y);
        dy = end.x - start.x;
        distance = Math.max(1, Math.hypot(dx, dy));
      }
      return {
        start,
        end,
        control: { x: midpoint.x + dx / distance * 38, y: midpoint.y + dy / distance * 38 },
      };
    }
    if (route?.kind === "cross" || route?.kind === "context") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const bend = route.kind === "context" ? 68 : 44;
      const normal = { x: -dy / distance, y: dx / distance };
      const center = graphLayout.center || { x: 0, y: 0 };
      const outwardProjection = (midpoint.x - center.x) * normal.x + (midpoint.y - center.y) * normal.y;
      const lane = Math.abs(outwardProjection) > 1
        ? Math.sign(outwardProjection)
        : route.lane || 1;
      return {
        start,
        end,
        control: { x: midpoint.x + normal.x * bend * lane, y: midpoint.y + normal.y * bend * lane },
      };
    }
    return { start, end, control: null };
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
    if (!geometry.control) return `M ${geometry.start.x} ${geometry.start.y} L ${geometry.end.x} ${geometry.end.y}`;
    return `M ${geometry.start.x} ${geometry.start.y} Q ${geometry.control.x} ${geometry.control.y} ${geometry.end.x} ${geometry.end.y}`;
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
          x: (geometry.control?.x ?? geometry.end.x) - geometry.start.x,
          y: (geometry.control?.y ?? geometry.end.y) - geometry.start.y,
        }
      : {
          x: geometry.end.x - (geometry.control?.x ?? geometry.start.x),
          y: geometry.end.y - (geometry.control?.y ?? geometry.start.y),
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
    createForceSimulation,
    edgeArrowPoints,
    edgePath,
    layout,
    relationshipKey,
    relationships,
    viewBounds,
  };
});
