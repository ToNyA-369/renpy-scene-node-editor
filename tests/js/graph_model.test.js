"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const graph = require("../../EDITOR/static/js/workspaces/graph_model.js");

const nodes = [
  { id: "parent", name: "Parent" },
  { id: "child_a", name: "Child A" },
  { id: "child_b", name: "Child B" },
];

function center(layout, nodeId) {
  const position = layout.positions.get(nodeId);
  const radius = layout.nodeSizes.get(nodeId).radius;
  return {
    x: position.x + radius,
    y: position.y + radius,
  };
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pathStart(path) {
  return path.match(/^M ([^ ]+) ([^ ]+)/).slice(1);
}

function polygonPoints(points) {
  return points.split(" ").map((point) => {
    const [x, y] = point.split(",").map(Number);
    return { x, y };
  });
}

function setCenter(layout, nodeId, point) {
  const radius = layout.nodeSizes.get(nodeId).radius;
  layout.positions.set(nodeId, { x: point.x - radius, y: point.y - radius });
}

test("graph model groups repeated direct references", () => {
  const result = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open" },
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open_again" },
    { source: "child_a", target: "child_b", endUp: "REPLACE", eventId: "swap" },
  ]);
  const goto = result.find((item) => item.source === "parent" && item.target === "child_a" && item.endUp === "GOTO");
  const replace = result.find((item) => item.source === "child_a" && item.target === "child_b" && item.endUp === "REPLACE");
  assert.equal(goto.events.length, 2);
  assert.equal(replace.events.length, 1);
});

test("reciprocal REPLACE references become one bidirectional visual relationship", () => {
  const result = graph.relationships(nodes, [
    { source: "child_a", target: "child_b", endUp: "REPLACE", eventId: "forward" },
    { source: "child_b", target: "child_a", endUp: "REPLACE", eventId: "backward" },
  ]);
  const replaceRelationships = result.filter((item) => item.endUp === "REPLACE");

  assert.equal(replaceRelationships.length, 1);
  assert.equal(replaceRelationships[0].bidirectional, true);
  assert.deepEqual(
    replaceRelationships[0].events.map((event) => [event.directionSource, event.directionTarget]),
    [["child_a", "child_b"], ["child_b", "child_a"]],
  );
});

test("REPLACE derives a parent-to-target management relationship without changing data", () => {
  const sourceEdges = [
    { source: "parent", target: "child_a", endUp: "GOTO", eventId: "open" },
    { source: "child_a", target: "child_b", endUp: "REPLACE", eventId: "swap" },
  ];
  const result = graph.relationships(nodes, sourceEdges);
  const management = result.find((item) => item.endUp === "MANAGEMENT");
  assert.equal(management.source, "parent");
  assert.equal(management.target, "child_b");
  assert.equal(management.events[0].replacedNode, "child_a");
  assert.equal(Object.hasOwn(sourceEdges[1], "replacedNode"), false);
});

test("REPLACE chains derive every transitive parent management relationship", () => {
  const chainNodes = ["parent", "b", "c", "d"].map((id) => ({ id, name: id }));
  const result = graph.relationships(chainNodes, [
    { source: "parent", target: "b", endUp: "GOTO", eventId: "enter" },
    { source: "b", target: "c", endUp: "REPLACE", eventId: "swap_c" },
    { source: "c", target: "d", endUp: "REPLACE", eventId: "swap_d" },
  ]);
  const management = result.filter((item) => item.endUp === "MANAGEMENT");

  assert.deepEqual(management.map((item) => [item.source, item.target]), [
    ["parent", "c"],
    ["parent", "d"],
  ]);
  assert.deepEqual(management[1].events[0].replacePath, ["b", "c", "d"]);
  assert.equal(management[1].events[0].replacedNode, "b");
});

test("node size and charge increase with direct and transitive child count", () => {
  const sizedNodes = ["parent", "b", "c", "d", "leaf"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(sizedNodes, [
    { source: "parent", target: "b", endUp: "GOTO" },
    { source: "parent", target: "leaf", endUp: "GOTO" },
    { source: "b", target: "c", endUp: "REPLACE" },
    { source: "c", target: "d", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(sizedNodes, relationships, "parent");
  const parent = layout.nodeSizes.get("parent");
  const leaf = layout.nodeSizes.get("leaf");

  assert.equal(parent.childCount, 4);
  assert.equal(leaf.childCount, 0);
  assert.equal(parent.inheritedLoad, 4);
  assert.ok(parent.radius > leaf.radius);
  assert.ok(parent.radius - leaf.radius < 12);
  assert.ok(parent.radius <= 32);
  assert.ok(parent.chargeScale > leaf.chargeScale);
  assert.ok(parent.chargeScale < 1 + parent.inheritedLoad);
});

test("descendant charge is inherited with depth decay and nonlinear compression", () => {
  const inheritedNodes = ["root", "home", "room", "desk", "shop"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(inheritedNodes, [
    { source: "root", target: "home", endUp: "GOTO" },
    { source: "home", target: "room", endUp: "GOTO" },
    { source: "room", target: "desk", endUp: "GOTO" },
    { source: "root", target: "shop", endUp: "GOTO" },
  ]);
  const layout = graph.layout(inheritedNodes, relationships, "root");
  const root = layout.nodeSizes.get("root");
  const home = layout.nodeSizes.get("home");

  assert.equal(root.descendantCount, 4);
  assert.equal(home.descendantCount, 2);
  assert.equal(layout.hierarchyDepths.get("root").get("desk"), 3);
  assert.ok(root.inheritedLoad > home.inheritedLoad);
  assert.ok(root.chargeScale > home.chargeScale);
  assert.ok(root.chargeScale < 1 + root.inheritedLoad);
});

test("global GOTO edges do not establish static parent management", () => {
  const result = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO", scope: "global" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  assert.equal(result.some((item) => item.endUp === "MANAGEMENT"), false);
});

test("force simulation keeps REPLACE siblings on their inherited parent orbit", () => {
  const relationships = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(nodes, relationships, "parent");
  const simulation = graph.createForceSimulation(nodes, relationships, layout, "parent");
  simulation.tick(600);

  const firstRadius = distance(center(layout, "parent"), center(layout, "child_a"));
  const secondRadius = distance(center(layout, "parent"), center(layout, "child_b"));
  assert.ok(firstRadius > 200 && firstRadius < 700);
  assert.ok(secondRadius > 200 && secondRadius < 700);
  assert.ok(Math.abs(firstRadius - secondRadius) < 80);
  assert.ok(distance(center(layout, "child_a"), center(layout, "child_b")) > 250);
});

test("hierarchy-aware forces form nested radial clusters around ROOT", () => {
  const hierarchyNodes = [
    "root", "home", "work", "shops", "park",
    "bed", "bath", "kitchen", "office", "lobby", "mall", "cafe",
  ].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(hierarchyNodes, [
    ...["home", "work", "shops", "park"].map((target) => ({ source: "root", target, endUp: "GOTO" })),
    { source: "home", target: "bed", endUp: "GOTO" },
    { source: "home", target: "bath", endUp: "GOTO" },
    { source: "home", target: "kitchen", endUp: "GOTO" },
    { source: "work", target: "office", endUp: "GOTO" },
    { source: "work", target: "lobby", endUp: "GOTO" },
    { source: "shops", target: "mall", endUp: "GOTO" },
    { source: "shops", target: "cafe", endUp: "GOTO" },
  ]);
  const layout = graph.layout(hierarchyNodes, relationships, "root");
  const simulation = graph.createForceSimulation(hierarchyNodes, relationships, layout, "root");
  simulation.tick(700);

  assert.ok(distance(center(layout, "root"), layout.center) < 20);
  const hubAngles = ["home", "work", "shops", "park"]
    .map((nodeId) => Math.atan2(
      center(layout, nodeId).y - center(layout, "root").y,
      center(layout, nodeId).x - center(layout, "root").x,
    ))
    .sort((left, right) => left - right);
  const wrappedGaps = hubAngles.map((angle, index) => {
    const next = hubAngles[(index + 1) % hubAngles.length] + (index === hubAngles.length - 1 ? Math.PI * 2 : 0);
    return next - angle;
  });
  assert.ok(Math.min(...wrappedGaps) > 0.7);
  const homeAngles = ["bed", "bath", "kitchen"]
    .map((nodeId) => Math.atan2(
      center(layout, nodeId).y - center(layout, "home").y,
      center(layout, nodeId).x - center(layout, "home").x,
    ))
    .sort((left, right) => left - right);
  const homeGaps = homeAngles.map((angle, index) => {
    const next = homeAngles[(index + 1) % homeAngles.length] + (index === homeAngles.length - 1 ? Math.PI * 2 : 0);
    return next - angle;
  });
  assert.ok(Math.min(...homeGaps) > 1.2);
  assert.ok(Math.max(...homeGaps) < 2.8);
  const rootGrandchildDistances = ["bed", "bath", "kitchen", "office", "lobby", "mall", "cafe"]
    .map((nodeId) => distance(center(layout, "root"), center(layout, nodeId)));
  assert.ok(Math.min(...rootGrandchildDistances) > 300);
  assert.ok(distance(center(layout, "home"), center(layout, "bed")) < 600);
  assert.ok(distance(center(layout, "work"), center(layout, "office")) < 600);
  assert.ok(distance(center(layout, "shops"), center(layout, "mall")) < 600);
});

test("growth settlement builds the GOTO skeleton before REPLACE families", () => {
  const growthNodes = ["root", "a", "a_room", "b", "b_room"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(growthNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "a", target: "a_room", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "REPLACE" },
    { source: "b", target: "b_room", endUp: "GOTO" },
  ]);
  const layout = graph.layout(growthNodes, relationships, "root");

  assert.deepEqual(layout.growthStages, [
    { kind: "root", nodeIds: ["root"] },
    { kind: "goto", nodeIds: ["a"] },
    { kind: "goto", nodeIds: ["a_room"] },
    { kind: "replace", nodeIds: ["b"] },
    { kind: "goto", nodeIds: ["b_room"] },
  ]);
  assert.equal(layout.orbitParents.get("a"), "root");
  assert.equal(layout.orbitParents.get("b"), "root");
  assert.equal(layout.orbitKinds.get("b"), "MANAGEMENT");

  const simulation = graph.createForceSimulation(growthNodes, relationships, layout, "root");
  const result = simulation.settleGrowth();
  assert.equal(result.stageCount, 5);
  assert.ok(result.ticksPerStage > 0);
  layout.positions.forEach((position) => {
    assert.ok(Number.isFinite(position.x));
    assert.ok(Number.isFinite(position.y));
  });
  assert.ok(distance(center(layout, "root"), center(layout, "a")) > 150);
  assert.ok(distance(center(layout, "root"), center(layout, "b")) > 150);
  assert.ok(distance(center(layout, "a"), center(layout, "b")) > 180);
});

test("growth settlement is deterministic and only initializes once", () => {
  const growthNodes = ["root", "home", "work", "bed", "office"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(growthNodes, [
    { source: "root", target: "home", endUp: "GOTO" },
    { source: "root", target: "work", endUp: "GOTO" },
    { source: "home", target: "bed", endUp: "GOTO" },
    { source: "work", target: "office", endUp: "GOTO" },
  ]);
  const firstLayout = graph.layout(growthNodes, relationships, "root");
  const secondLayout = graph.layout(growthNodes, relationships, "root");
  const firstSimulation = graph.createForceSimulation(growthNodes, relationships, firstLayout, "root");
  const secondSimulation = graph.createForceSimulation(growthNodes, relationships, secondLayout, "root");

  firstSimulation.settleGrowth();
  secondSimulation.settleGrowth();
  const firstPositions = [...firstLayout.positions].map(([nodeId, position]) => [nodeId, position.x, position.y]);
  const secondPositions = [...secondLayout.positions].map(([nodeId, position]) => [nodeId, position.x, position.y]);
  assert.deepEqual(firstPositions, secondPositions);

  const beforeSecondSettlement = structuredClone(firstPositions);
  firstSimulation.settleGrowth();
  assert.deepEqual(
    [...firstLayout.positions].map(([nodeId, position]) => [nodeId, position.x, position.y]),
    beforeSecondSettlement,
  );
});

test("drag pinning is one-to-one and release returns the node to force equilibrium", () => {
  const treeNodes = ["root", "a", "b", "a1", "a2", "b1", "b2"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(treeNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "root", target: "b", endUp: "GOTO" },
    { source: "a", target: "a1", endUp: "GOTO" },
    { source: "a", target: "a2", endUp: "GOTO" },
    { source: "b", target: "b1", endUp: "GOTO" },
    { source: "b", target: "b2", endUp: "GOTO" },
  ]);
  const layout = graph.layout(treeNodes, relationships, "root");
  const simulation = graph.createForceSimulation(treeNodes, relationships, layout, "root");
  simulation.tick(180);
  const before = { ...layout.positions.get("a") };
  const dragged = { x: before.x + 100, y: before.y - 100 };

  simulation.pin("a", dragged.x, dragged.y);
  simulation.tick(12);
  assert.deepEqual(layout.positions.get("a"), dragged);

  simulation.release("a", 0, 0);
  simulation.tick(180);
  assert.ok(distance(layout.positions.get("a"), dragged) > 20);
  assert.ok(distance(center(layout, "a"), center(layout, "a1")) < distance(center(layout, "a"), center(layout, "b1")));
});

test("route roles remain distinct and every relationship starts at the node center", () => {
  const routedNodes = [
    { id: "__global__", name: "Global", isGlobal: true },
    { id: "root", name: "Root" },
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "target", name: "Target" },
  ];
  const relationships = graph.relationships(routedNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "root", target: "b", endUp: "GOTO" },
    { source: "a", target: "target", endUp: "GOTO" },
    { source: "b", target: "target", endUp: "REPLACE" },
    { source: "__global__", target: "target", endUp: "GOTO", scope: "global" },
  ]);
  const layout = graph.layout(routedNodes, relationships, "root");
  const routeKinds = Object.fromEntries(relationships.map((relationship) => [
    `${relationship.source}:${relationship.target}:${relationship.endUp}`,
    layout.routes.get(graph.relationshipKey(relationship)).kind,
  ]));

  assert.equal(routeKinds["a:target:GOTO"], "tree");
  assert.equal(routeKinds["b:target:REPLACE"], "replace-local");
  assert.equal(routeKinds["root:target:MANAGEMENT"], "management");
  assert.equal(routeKinds["__global__:target:GOTO"], "context");

  const direct = relationships.find((item) => item.source === "root" && item.target === "b" && item.endUp === "GOTO");
  const management = relationships.find((item) => item.source === "root" && item.target === "target" && item.endUp === "MANAGEMENT");
  const directPath = graph.edgePath(layout.positions.get("root"), layout.positions.get("b"), layout, 0, "GOTO", direct);
  const managementPath = graph.edgePath(layout.positions.get("root"), layout.positions.get("target"), layout, 0, "MANAGEMENT", management);
  assert.deepEqual(pathStart(directPath), pathStart(managementPath));
  assert.deepEqual(pathStart(directPath).map(Number), [center(layout, "root").x, center(layout, "root").y]);
});

test("crossing detection ignores shared endpoints and crossing penalties untangle independent edges", () => {
  const crossingNodes = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(crossingNodes, [
    { source: "a", target: "b", endUp: "GOTO" },
    { source: "c", target: "d", endUp: "GOTO" },
  ]);
  const layout = graph.layout(crossingNodes, relationships, "a");
  setCenter(layout, "a", { x: 400, y: 300 });
  setCenter(layout, "b", { x: 800, y: 700 });
  setCenter(layout, "c", { x: 400, y: 700 });
  setCenter(layout, "d", { x: 800, y: 300 });

  assert.equal(graph.countEdgeCrossings(relationships, layout), 1);
  const simulation = graph.createForceSimulation(crossingNodes, relationships, layout, "a");
  simulation.tick(120);
  assert.equal(simulation.crossingCount(), 0);

  const sharedRelationships = graph.relationships(crossingNodes, [
    { source: "a", target: "b", endUp: "GOTO" },
    { source: "a", target: "c", endUp: "GOTO" },
  ]);
  const sharedLayout = graph.layout(crossingNodes, sharedRelationships, "a");
  setCenter(sharedLayout, "a", { x: 600, y: 500 });
  setCenter(sharedLayout, "b", { x: 300, y: 200 });
  setCenter(sharedLayout, "c", { x: 900, y: 800 });
  assert.equal(graph.countEdgeCrossings(sharedRelationships, sharedLayout), 0);
});

test("arrow tips touch node surfaces while edge paths continue through node centers", () => {
  const relationships = graph.relationships(nodes, [
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
    { source: "child_b", target: "child_a", endUp: "REPLACE" },
  ]);
  const relationship = relationships.find((item) => item.endUp === "REPLACE");
  const layout = graph.layout(nodes, relationships, "parent");
  const source = layout.positions.get(relationship.source);
  const target = layout.positions.get(relationship.target);
  const path = graph.edgePath(source, target, layout, 0, relationship.endUp, relationship);
  const endArrow = polygonPoints(graph.edgeArrowPoints(
    source, target, layout, 0, relationship.endUp, relationship,
  ));
  const startArrow = polygonPoints(graph.edgeArrowPoints(
    source, target, layout, 0, relationship.endUp, relationship, "start",
  ));

  assert.deepEqual(pathStart(path).map(Number), [center(layout, relationship.source).x, center(layout, relationship.source).y]);
  assert.ok(Math.abs(
    distance(endArrow[0], center(layout, relationship.target))
      - layout.nodeSizes.get(relationship.target).radius,
  ) < 0.001);
  assert.ok(Math.abs(
    distance(startArrow[0], center(layout, relationship.source))
      - layout.nodeSizes.get(relationship.source).radius,
  ) < 0.001);
  const endBase = {
    x: (endArrow[1].x + endArrow[2].x) / 2,
    y: (endArrow[1].y + endArrow[2].y) / 2,
  };
  assert.ok(Math.abs(distance(endArrow[0], endBase) - 20) < 0.001);
});

test("multiple GOTO parents pull a shared destination from both sides", () => {
  const averagedNodes = ["root", "menu", "branch", "result"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(averagedNodes, [
    { source: "root", target: "menu", endUp: "GOTO" },
    { source: "menu", target: "branch", endUp: "GOTO" },
    { source: "branch", target: "result", endUp: "GOTO" },
    { source: "menu", target: "result", endUp: "GOTO" },
  ]);
  const layout = graph.layout(averagedNodes, relationships, "root");
  const simulation = graph.createForceSimulation(averagedNodes, relationships, layout, "root");
  simulation.tick(280);
  const branchToResult = distance(center(layout, "branch"), center(layout, "result"));
  const menuToResult = distance(center(layout, "menu"), center(layout, "result"));
  const resultOrbitParents = ["menu", "branch"]
    .filter((parentId) => layout.orbitAngles.has(`${parentId}\u0000result`));

  assert.ok(branchToResult < 650);
  assert.ok(menuToResult < 450);
  assert.equal(resultOrbitParents.length, 1);
});

test("reciprocal GOTO references stay separate and form a conspicuous cycle", () => {
  const cycleNodes = ["root", "a", "b"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(cycleNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "GOTO", eventId: "forward" },
    { source: "b", target: "a", endUp: "GOTO", eventId: "backward" },
  ]);
  const cycleRelationships = relationships.filter((item) => item.cycle);
  const layout = graph.layout(cycleNodes, relationships, "root");

  assert.equal(cycleRelationships.length, 2);
  cycleRelationships.forEach((relationship) => {
    assert.equal(layout.routes.get(graph.relationshipKey(relationship)).kind, "goto-cycle");
  });
  const paths = cycleRelationships.map((relationship) => graph.edgePath(
    layout.positions.get(relationship.source),
    layout.positions.get(relationship.target),
    layout,
    0,
    "GOTO",
    relationship,
  ));
  assert.notEqual(paths[0], paths[1]);
  paths.forEach((path) => assert.match(path, / Q /));
});

test("force relaxation is deterministic for the same graph", () => {
  const deterministicNodes = ["root", "a", "b", "c", "d"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(deterministicNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "root", target: "b", endUp: "GOTO" },
    { source: "a", target: "c", endUp: "GOTO" },
    { source: "b", target: "c", endUp: "GOTO" },
    { source: "c", target: "d", endUp: "REPLACE" },
  ]);
  const first = graph.layout(deterministicNodes, relationships, "root");
  const second = graph.layout(deterministicNodes, relationships, "root");
  graph.createForceSimulation(deterministicNodes, relationships, first, "root").tick(240);
  graph.createForceSimulation(deterministicNodes, relationships, second, "root").tick(240);

  assert.deepEqual([...first.positions], [...second.positions]);
  assert.deepEqual([...first.routes], [...second.routes]);
});

test("force layout remains finite outside the initial canvas and produces dynamic view bounds", () => {
  const largeNodes = Array.from({ length: 64 }, (_, index) => ({ id: `node_${index}`, name: `Node ${index}` }));
  const largeEdges = largeNodes.slice(1).map((node, index) => ({
    source: `node_${Math.floor(index / 3)}`,
    target: node.id,
    endUp: index % 11 === 0 && index > 0 ? "REPLACE" : "GOTO",
  }));
  const relationships = graph.relationships(largeNodes, largeEdges);
  const layout = graph.layout(largeNodes, relationships, "node_0");
  const simulation = graph.createForceSimulation(largeNodes, relationships, layout, "node_0");
  simulation.tick(320);

  assert.equal(layout.positions.size, largeNodes.length);
  const bounds = graph.viewBounds(layout, 0);
  let escapedInitialCanvas = false;
  layout.positions.forEach((position, nodeId) => {
    const radius = layout.nodeSizes.get(nodeId).radius;
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
    assert.ok(position.x + radius >= bounds.x - 0.001);
    assert.ok(position.y + radius >= bounds.y - 0.001);
    assert.ok(position.x + radius <= bounds.x + bounds.width + 0.001);
    assert.ok(position.y + radius <= bounds.y + bounds.height + 0.001);
    if (position.x < 0 || position.y < 0 || position.x + radius * 2 > layout.width || position.y + radius * 2 > layout.height) {
      escapedInitialCanvas = true;
    }
  });
  assert.equal(escapedInitialCanvas, true);
});

test("dragging may move a node anywhere in the near-infinite graph plane", () => {
  const relationships = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO" },
  ]);
  const layout = graph.layout(nodes, relationships, "parent");
  const simulation = graph.createForceSimulation(nodes, relationships, layout, "parent");

  simulation.pin("child_a", -4200, 6100);
  simulation.tick(8);
  assert.deepEqual(layout.positions.get("child_a"), { x: -4200, y: 6100 });
  const bounds = graph.viewBounds(layout);
  assert.ok(bounds.x < -4200);
  assert.ok(bounds.y + bounds.height > 6100);
});
