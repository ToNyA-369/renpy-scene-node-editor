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

test("node size still communicates descendant load without affecting coordinates", () => {
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
});

test("descendant metrics remain cycle-safe and depth-aware", () => {
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
  assert.ok(root.radius > home.radius);
});

test("global GOTO edges do not establish static parent management", () => {
  const result = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO", scope: "global" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  assert.equal(result.some((item) => item.endUp === "MANAGEMENT"), false);
});

test("REPLACE families share one Stack depth while advancing through bounded micro-ranks", () => {
  const relationships = graph.relationships(nodes, [
    { source: "parent", target: "child_a", endUp: "GOTO" },
    { source: "child_a", target: "child_b", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(nodes, relationships, "parent");
  assert.equal(layout.algorithm, "structured-depth");
  assert.equal(layout.levels.get("parent"), 0);
  assert.equal(layout.levels.get("child_a"), 1);
  assert.equal(layout.levels.get("child_b"), 1);
  assert.ok(center(layout, "child_b").x > center(layout, "child_a").x);
  assert.ok(center(layout, "child_b").x - center(layout, "child_a").x <= 220);
  assert.equal(layout.replacementRanks.get("child_a"), 0);
  assert.equal(layout.replacementRanks.get("child_b"), 1);
  assert.equal(layout.componentForNode.get("child_a"), layout.componentForNode.get("child_b"));
  assert.ok(Math.abs(center(layout, "child_a").y - center(layout, "child_b").y) >= 120);
});

test("GOTO depth and branch swimlanes expose the game structure", () => {
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
  assert.deepEqual(layout.columns.map((column) => column.depth), [0, 1, 2]);
  ["home", "work", "shops", "park"].forEach((nodeId) => assert.equal(layout.levels.get(nodeId), 1));
  ["bed", "bath", "kitchen", "office", "lobby", "mall", "cafe"]
    .forEach((nodeId) => assert.equal(layout.levels.get(nodeId), 2));
  assert.equal(center(layout, "home").x - center(layout, "root").x, 360);
  assert.equal(center(layout, "bed").x - center(layout, "home").x, 360);
  const branchCenters = ["home", "work", "shops", "park"].map((nodeId) => center(layout, nodeId).y);
  const orderedBranchCenters = [...branchCenters].sort((left, right) => left - right);
  assert.ok(orderedBranchCenters.every((value, index) => index === 0 || value - orderedBranchCenters[index - 1] >= 120));
  assert.ok(center(layout, "root").y >= Math.min(...branchCenters));
  assert.ok(center(layout, "root").y <= Math.max(...branchCenters));
});

test("same-depth GOTO relationships receive a short local progression", () => {
  const localNodes = ["root", "hub", "branch", "result"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(localNodes, [
    { source: "root", target: "hub", endUp: "GOTO" },
    { source: "hub", target: "branch", endUp: "GOTO" },
    { source: "hub", target: "result", endUp: "GOTO" },
    { source: "branch", target: "result", endUp: "GOTO" },
  ]);
  const layout = graph.layout(localNodes, relationships, "root");

  assert.equal(layout.levels.get("branch"), 2);
  assert.equal(layout.levels.get("result"), 2);
  assert.equal(layout.componentMicroRanks.get(layout.componentForNode.get("branch")), 0);
  assert.equal(layout.componentMicroRanks.get(layout.componentForNode.get("result")), 1);
  assert.ok(center(layout, "result").x > center(layout, "branch").x);
  assert.equal(center(layout, "result").x - center(layout, "branch").x, 140);
  assert.match(graph.edgePath(
    layout.positions.get("branch"),
    layout.positions.get("result"),
    layout,
    0,
    "GOTO",
    relationships.find((relationship) => relationship.source === "branch"),
  ), / C /);
});

test("REPLACE chains alternate across the depth baseline", () => {
  const replaceNodes = ["parent", "a", "b", "c"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(replaceNodes, [
    { source: "parent", target: "a", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "REPLACE" },
    { source: "b", target: "c", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(replaceNodes, relationships, "parent");

  assert.deepEqual(["a", "b", "c"].map((nodeId) => layout.levels.get(nodeId)), [1, 1, 1]);
  assert.ok(center(layout, "b").x > center(layout, "a").x);
  assert.ok(center(layout, "c").x < center(layout, "b").x);
  assert.equal(center(layout, "c").x, center(layout, "a").x);
  assert.deepEqual(["a", "b", "c"].map((nodeId) => layout.replacementRanks.get(nodeId)), [0, 1, 2]);
});

test("REPLACE families keep their outgoing GOTO branches on the next depth", () => {
  const growthNodes = ["root", "a", "a_room", "b", "b_room"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(growthNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "a", target: "a_room", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "REPLACE" },
    { source: "b", target: "b_room", endUp: "GOTO" },
  ]);
  const layout = graph.layout(growthNodes, relationships, "root");

  assert.equal(layout.levels.get("root"), 0);
  assert.equal(layout.levels.get("a"), 1);
  assert.equal(layout.levels.get("b"), 1);
  assert.equal(layout.levels.get("a_room"), 2);
  assert.equal(layout.levels.get("b_room"), 2);
  assert.ok(center(layout, "b").x > center(layout, "a").x);
  assert.ok(center(layout, "b").x < center(layout, "a_room").x);
  assert.ok(center(layout, "a_room").x > center(layout, "a").x);
  assert.ok(center(layout, "b_room").x > center(layout, "b").x);
});

test("structured layout is deterministic", () => {
  const growthNodes = ["root", "home", "work", "bed", "office"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(growthNodes, [
    { source: "root", target: "home", endUp: "GOTO" },
    { source: "root", target: "work", endUp: "GOTO" },
    { source: "home", target: "bed", endUp: "GOTO" },
    { source: "work", target: "office", endUp: "GOTO" },
  ]);
  const firstLayout = graph.layout(growthNodes, relationships, "root");
  const secondLayout = graph.layout(growthNodes, relationships, "root");
  const firstPositions = [...firstLayout.positions].map(([nodeId, position]) => [nodeId, position.x, position.y]);
  const secondPositions = [...secondLayout.positions].map(([nodeId, position]) => [nodeId, position.x, position.y]);
  assert.deepEqual(firstPositions, secondPositions);
  assert.deepEqual([...firstLayout.routes], [...secondLayout.routes]);
  assert.equal(firstLayout.revealSteps.get("root"), 0);
  assert.ok(firstLayout.revealSteps.get("home") > firstLayout.revealSteps.get("root"));
  assert.ok(firstLayout.revealSteps.get("bed") > firstLayout.revealSteps.get("home"));
});

test("idle motion stays near deterministic structural anchors and yields to dragging", () => {
  const motionNodes = ["root", "a", "b"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(motionNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "GOTO" },
  ]);
  const firstLayout = graph.layout(motionNodes, relationships, "root");
  const secondLayout = graph.layout(motionNodes, relationships, "root");
  const first = graph.createLayoutController(motionNodes, relationships, firstLayout);
  const second = graph.createLayoutController(motionNodes, relationships, secondLayout);
  assert.deepEqual(first.connectionPairs, [["a", "root"], ["a", "b"]]);

  for (let time = 0; time <= 800; time += 16) {
    first.frame(time);
    second.frame(time);
  }
  assert.deepEqual([...firstLayout.positions], [...secondLayout.positions]);
  firstLayout.positions.forEach((position, nodeId) => {
    const anchor = first.anchors.get(nodeId);
    assert.ok(Math.abs(position.x - anchor.x) <= 2.61);
    assert.ok(Math.abs(position.y - anchor.y) <= 1.81);
  });
  const before = { ...firstLayout.positions.get("a") };
  first.frame(1100);
  assert.notDeepEqual(firstLayout.positions.get("a"), before);

  first.pin("a", 444, 333);
  first.frame(1116);
  assert.deepEqual(firstLayout.positions.get("a"), { x: 444, y: 333 });
});

test("local physics couples real links, repels only nearby anchors, and remains bounded", () => {
  const physicsNodes = ["root", "a", "b", "c"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(physicsNodes, [
    { source: "root", target: "a", endUp: "GOTO" },
    { source: "a", target: "b", endUp: "REPLACE" },
    { source: "b", target: "c", endUp: "REPLACE" },
  ]);
  const layout = graph.layout(physicsNodes, relationships, "root");
  const controller = graph.createLayoutController(physicsNodes, relationships, layout);

  assert.ok(controller.connectionPairs.some((pair) => pair.includes("a") && pair.includes("b")));
  assert.ok(controller.connectionPairs.some((pair) => pair.includes("b") && pair.includes("c")));
  assert.ok(!controller.connectionPairs.some((pair) => pair.includes("root") && pair.includes("c")));
  assert.ok(controller.repulsionPairs.some((pair) => pair.includes("a") && pair.includes("b")));
  assert.ok(!controller.repulsionPairs.some((pair) => pair.includes("root") && pair.includes("c")));

  for (let time = 0; time <= 12000; time += 16) controller.frame(time);
  layout.positions.forEach((position, nodeId) => {
    const anchor = controller.anchors.get(nodeId);
    assert.ok(Math.hypot(position.x - anchor.x, position.y - anchor.y) <= 7.001);
  });
});

test("a dragged node transmits pull and dynamic repulsion without leaving the pointer", () => {
  const dragNodes = ["root", "linked", "detached"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(dragNodes, [
    { source: "root", target: "linked", endUp: "GOTO" },
  ]);
  const layout = graph.layout(dragNodes, relationships, "root");
  const controller = graph.createLayoutController(dragNodes, relationships, layout);
  const rootAnchor = controller.anchors.get("root");
  const linkedAnchor = controller.anchors.get("linked");

  controller.pin("root", rootAnchor.x + 180, rootAnchor.y);
  for (let time = 0; time <= 640; time += 16) controller.frame(time);
  assert.deepEqual(layout.positions.get("root"), { x: rootAnchor.x + 180, y: rootAnchor.y });
  assert.ok(layout.positions.get("linked").x - linkedAnchor.x > 4);
  assert.ok(Math.hypot(
    layout.positions.get("linked").x - linkedAnchor.x,
    layout.positions.get("linked").y - linkedAnchor.y,
  ) <= 7.001);

  const detachedAnchor = controller.anchors.get("detached");
  controller.pin("root", detachedAnchor.x - 36, detachedAnchor.y);
  const detachedBefore = { ...layout.positions.get("detached") };
  for (let time = 656; time <= 1296; time += 16) controller.frame(time);
  assert.ok(Math.hypot(
    layout.positions.get("detached").x - detachedBefore.x,
    layout.positions.get("detached").y - detachedBefore.y,
  ) > 1);
  assert.deepEqual(layout.positions.get("root"), {
    x: detachedAnchor.x - 36,
    y: detachedAnchor.y,
  });
});

test("dragging is temporary and returns only that node to its structural slot", () => {
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
  const controller = graph.createLayoutController(treeNodes, relationships, layout);
  const before = { ...layout.positions.get("a") };
  const untouched = { ...layout.positions.get("b") };
  const dragged = { x: before.x + 100, y: before.y - 100 };

  controller.pin("a", dragged.x, dragged.y);
  controller.tick(12);
  assert.deepEqual(layout.positions.get("a"), dragged);
  assert.deepEqual(layout.positions.get("b"), untouched);

  controller.release("a", 0, 0);
  controller.tick(120);
  assert.deepEqual(layout.positions.get("a"), before);
  assert.deepEqual(layout.positions.get("b"), untouched);
  assert.equal(controller.isActive(), false);
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

  assert.equal(routeKinds["a:target:GOTO"], "cross");
  assert.equal(routeKinds["b:target:REPLACE"], "replace-local");
  assert.equal(routeKinds["root:target:MANAGEMENT"], "management");
  assert.equal(routeKinds["__global__:target:GOTO"], "context");

  const direct = relationships.find((item) => item.source === "root" && item.target === "b" && item.endUp === "GOTO");
  const management = relationships.find((item) => item.source === "root" && item.target === "target" && item.endUp === "MANAGEMENT");
  const directPath = graph.edgePath(layout.positions.get("root"), layout.positions.get("b"), layout, 0, "GOTO", direct);
  const managementPath = graph.edgePath(layout.positions.get("root"), layout.positions.get("target"), layout, 0, "MANAGEMENT", management);
  assert.deepEqual(pathStart(directPath), pathStart(managementPath));
  assert.deepEqual(pathStart(directPath).map(Number), [center(layout, "root").x, center(layout, "root").y]);
  assert.match(directPath, / C /);
});

test("crossing diagnostics ignore shared endpoints", () => {
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

test("multiple GOTO parents choose one stable hierarchy edge and keep the other as cross-reference", () => {
  const averagedNodes = ["root", "menu", "branch", "result"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(averagedNodes, [
    { source: "root", target: "menu", endUp: "GOTO" },
    { source: "menu", target: "branch", endUp: "GOTO" },
    { source: "branch", target: "result", endUp: "GOTO" },
    { source: "menu", target: "result", endUp: "GOTO" },
  ]);
  const layout = graph.layout(averagedNodes, relationships, "root");
  const incoming = relationships.filter((relationship) => relationship.target === "result");
  const kinds = incoming.map((relationship) => layout.routes.get(graph.relationshipKey(relationship)).kind).sort();
  assert.deepEqual(kinds, ["cross", "tree"]);
  assert.equal(layout.levels.get("result"), 2);
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
  paths.forEach((path) => assert.match(path, / C /));
});

test("large structured layouts remain finite and produce complete view bounds", () => {
  const largeNodes = Array.from({ length: 64 }, (_, index) => ({ id: `node_${index}`, name: `Node ${index}` }));
  const largeEdges = largeNodes.slice(1).map((node, index) => ({
    source: `node_${Math.floor(index / 3)}`,
    target: node.id,
    endUp: index % 11 === 0 && index > 0 ? "REPLACE" : "GOTO",
  }));
  const relationships = graph.relationships(largeNodes, largeEdges);
  const layout = graph.layout(largeNodes, relationships, "node_0");
  assert.equal(layout.positions.size, largeNodes.length);
  const bounds = graph.viewBounds(layout, 0);
  layout.positions.forEach((position, nodeId) => {
    const radius = layout.nodeSizes.get(nodeId).radius;
    assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
    assert.ok(position.x + radius >= bounds.x - 0.001);
    assert.ok(position.y + radius >= bounds.y - 0.001);
    assert.ok(position.x + radius <= bounds.x + bounds.width + 0.001);
    assert.ok(position.y + radius <= bounds.y + bounds.height + 0.001);
  });
  assert.ok(layout.columns.length > 3);
});

test("nodes outside ROOT reachability are separated into a detached region", () => {
  const detachedNodes = ["root", "child", "island", "island_child"].map((id) => ({ id, name: id }));
  const relationships = graph.relationships(detachedNodes, [
    { source: "root", target: "child", endUp: "GOTO" },
    { source: "island", target: "island_child", endUp: "GOTO" },
  ]);
  const layout = graph.layout(detachedNodes, relationships, "root");

  assert.deepEqual([...layout.detachedNodeIds].sort(), ["island", "island_child"]);
  assert.ok(Number.isFinite(layout.detachedStartY));
  assert.ok(center(layout, "island").y > layout.detachedStartY);
  assert.equal(layout.levels.get("island"), 0);
  assert.equal(layout.levels.get("island_child"), 1);
});
