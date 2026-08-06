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
    const nodeById = new Map(realNodes.map((node) => [String(node.id), node]));
    const orbitChildren = new Map(realNodes.map((node) => [String(node.id), new Set()]));
    const assignedOrbitParent = new Set(configuredRoot ? [configuredRoot] : []);
    const orbitQueue = configuredRoot ? [configuredRoot] : [];
    while (orbitQueue.length) {
      const parentId = orbitQueue.shift();
      const candidates = [...(childTargets.get(parentId) || [])]
        .filter((childId) => nodeById.has(childId))
        .sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)));
      candidates.forEach((childId) => {
        if (assignedOrbitParent.has(childId)) return;
        assignedOrbitParent.add(childId);
        orbitChildren.get(parentId).add(childId);
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
      routes.set(relationshipKey(relationship), { kind, lane: 0 });
    });

    return {
      nodeWidth: BASE_NODE_RADIUS * 2,
      nodeHeight: BASE_NODE_RADIUS * 2,
      nodeSizes,
      hierarchyChildren: childTargets,
      orbitChildren,
      hierarchyDepths: new Map([...hierarchyMetrics].map(([nodeId, metrics]) => [nodeId, metrics.depths])),
      orbitAngles,
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

    const centerOf = (particle) => ({
      x: particle.x + particle.radius,
      y: particle.y + particle.radius,
    });
    const addForce = (particle, x, y) => {
      if (particle.pinned) return;
      particle.vx += x * alpha;
      particle.vy += y * alpha;
    };

    function tick(iterations = 1) {
      let changed = false;
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const particleList = [...particles.values()];
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

        physicalRelationships.forEach((relationship) => {
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
      return alpha >= 0.002 || [...particles.values()].some((particle) => particle.pinned);
    }

    return { isActive, particles, pin, reheat, release, tick };
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
      return {
        start,
        end,
        control: { x: midpoint.x - dy / distance * bend, y: midpoint.y + dx / distance * bend },
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
    createForceSimulation,
    edgeArrowPoints,
    edgePath,
    layout,
    relationshipKey,
    relationships,
    viewBounds,
  };
});
