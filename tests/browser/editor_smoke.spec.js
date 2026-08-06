"use strict";

const { test, expect } = require("@playwright/test");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const TEST_EVENT_NAME = "分支權重結果";
const SAVED_EVENT_NAME = "分支權重結果 Smoke";

let projectRoot;
let editorServer;
let editorServerOutput = "";
let editorUrl;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForEditor(url) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/project`);
      if (response.ok) return;
      lastError = new Error(`Editor returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Editor did not start: ${lastError?.message || "unknown error"}\n${editorServerOutput}`);
}

async function waitForEventSave(page, action) {
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events")
    && candidate.request().method() === "POST"
    && candidate.ok()
  ));
  await action();
  await response;
  await expect(page.getByRole("status")).toHaveText("已自動儲存");
}

async function waitForOptionsSave(page, action) {
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/options")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await action();
  await response;
  await expect(page.getByRole("status")).toHaveText("已自動儲存");
}

async function waitForStateSave(page, action) {
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/state")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await action();
  await response;
  await expect(page.getByRole("status")).toHaveText("已自動儲存");
}

async function changeSelect(scope, name, value) {
  await scope.locator(`select[name="${name}"]`).selectOption(value, { force: true });
}

async function reloadAndWaitForProject(page) {
  const projectResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/project")
    && candidate.request().method() === "GET"
    && candidate.ok()
  ));
  await page.reload();
  await projectResponse;
  await expect(page.getByRole("status")).toHaveText("已同步");
}

test.beforeAll(async () => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scene-node-browser-smoke-"));
  const gameRoot = path.join(projectRoot, "game");
  fs.mkdirSync(gameRoot);
  for (const marker of ["options.rpy", "gui.rpy", "script.rpy"]) {
    fs.writeFileSync(path.join(gameRoot, marker), "# disposable browser smoke project\n", "utf8");
  }

  const generated = childProcess.spawnSync(
    "python3",
    [path.join(ROOT, "tools/create_editor_test_unit.py"), projectRoot],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (generated.status !== 0) {
    throw new Error(`Unable to create browser fixture:\n${generated.stdout}\n${generated.stderr}`);
  }

  const port = await availablePort();
  editorUrl = `http://127.0.0.1:${port}`;
  const editorApp = path.join(projectRoot, ".scene-node-editor", "EDITOR", "app.py");
  editorServer = childProcess.spawn(
    "python3",
    [editorApp, "--project", gameRoot, "--port", String(port)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  editorServer.stdout.on("data", (chunk) => { editorServerOutput += chunk.toString(); });
  editorServer.stderr.on("data", (chunk) => { editorServerOutput += chunk.toString(); });
  await waitForEditor(editorUrl);
});

test.afterAll(() => {
  if (editorServer && editorServer.exitCode === null) editorServer.kill("SIGTERM");
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

test("critical editor interactions survive reload without browser errors", async ({ page }) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();

  await page.getByRole("button", { name: "狀態", exact: true }).click();
  await expect(page.locator('.stat-group-card[data-stat-group="Normal"]')).toBeVisible();
  await expect(page.locator('.stat-group-card[data-stat-group="測試資源"]')).toBeVisible();
  await expect(page.locator('.stat-group-card[data-stat-group="流程追蹤"]')).toBeVisible();
  const initialStateGeometry = await page.evaluate(() => {
    const panel = document.querySelector("#statsPanel").getBoundingClientRect();
    const pageRect = document.querySelector(".state-definitions-page").getBoundingClientRect();
    const sections = Array.from(document.querySelectorAll(".state-definition-section"));
    const statsRect = sections[0].getBoundingClientRect();
    const memoryRect = sections[1].getBoundingClientRect();
    const innerAdd = document.querySelector("[data-add-stat-to-group]").getBoundingClientRect();
    return {
      panelWidth: panel.width,
      pageWidth: pageRect.width,
      statsLeftInset: statsRect.left - panel.left,
      memoryRightInset: panel.right - memoryRect.right,
      panelRadius: getComputedStyle(document.querySelector("#statsPanel")).borderTopLeftRadius,
      innerAddWidth: innerAdd.width,
      innerAddHeight: innerAdd.height,
      horizontalOverflow: Array.from(document.querySelectorAll(".stat-group-card .state-table-wrap"))
        .some((wrap) => wrap.scrollWidth > wrap.clientWidth + 1),
    };
  });
  expect(Math.abs(initialStateGeometry.pageWidth - initialStateGeometry.panelWidth)).toBeLessThan(1);
  expect(Math.abs(initialStateGeometry.statsLeftInset)).toBeLessThan(1);
  expect(Math.abs(initialStateGeometry.memoryRightInset)).toBeLessThan(1);
  expect(initialStateGeometry.panelRadius).toBe("0px");
  expect(initialStateGeometry.innerAddWidth).toBeGreaterThan(initialStateGeometry.innerAddHeight * 2);
  expect(initialStateGeometry.horizontalOverflow).toBe(false);
  const initialSectionHeights = await page.evaluate(() => (
    Array.from(document.querySelectorAll(".state-definition-section")).map((section) => section.getBoundingClientRect().height)
  ));
  await waitForStateSave(page, async () => {
    await page.locator("#addStatGroupButton").click();
  });
  const newGroup = page.locator('.stat-group-card[data-stat-group="New Group"]');
  await expect(newGroup).toBeVisible();
  await expect(newGroup.locator(".stat-row")).toHaveCount(1);
  const afterGroupSectionHeights = await page.evaluate(() => (
    Array.from(document.querySelectorAll(".state-definition-section")).map((section) => section.getBoundingClientRect().height)
  ));
  expect(afterGroupSectionHeights[0]).toBeGreaterThan(initialSectionHeights[0]);
  expect(Math.abs(afterGroupSectionHeights[1] - initialSectionHeights[1])).toBeLessThan(6);
  await waitForStateSave(page, async () => {
    await newGroup.locator("[data-add-stat-to-group]").click();
  });
  await expect(newGroup.locator(".stat-row")).toHaveCount(2);
  const afterStatSectionHeights = await page.evaluate(() => (
    Array.from(document.querySelectorAll(".state-definition-section")).map((section) => section.getBoundingClientRect().height)
  ));
  expect(afterStatSectionHeights[0]).toBeGreaterThan(afterGroupSectionHeights[0]);
  expect(Math.abs(afterStatSectionHeights[1] - afterGroupSectionHeights[1])).toBeLessThan(1);
  const pointsGroup = page.locator('.stat-group-card[data-stat-group="測試資源"] input[name="statGroupName"]');
  await waitForStateSave(page, async () => {
    await pointsGroup.fill("測試資源 Smoke");
  });
  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: "狀態", exact: true }).click();
  await expect(page.locator('.stat-group-card[data-stat-group="測試資源 Smoke"]')).toBeVisible();
  await expect(page.locator('.stat-group-card[data-stat-group="New Group"] .stat-row')).toHaveCount(2);

  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: new RegExp(`^${TEST_EVENT_NAME} `) }).click();

  const contentPicker = page.locator("[data-content-picker-toggle]");
  await expect(contentPicker).toBeVisible();
  await contentPicker.scrollIntoViewIfNeeded();
  await contentPicker.click();
  await expect(page.locator(".content-choice-menu")).toBeVisible();
  const contentFileBranch = page.locator("[data-content-file-expand]");
  await expect(contentFileBranch).toHaveCount(1);
  await contentFileBranch.click();
  await expect(page.locator('[data-content-label-choice="test_branch_success"]')).toBeVisible();

  await page.getByRole("button", { name: "新增條件" }).click();
  await expect(page.locator(".condition-row")).toHaveCount(1);
  await changeSelect(page.locator(".condition-row"), "conditionType", "memory");
  const condition = page.locator('.condition-row[data-condition-type="memory"]');
  await expect(condition).toBeVisible();
  await changeSelect(condition, "conditionBank", "test_session");
  await condition.locator('input[name="conditionId"]').fill("smoke_not_seen");
  await changeSelect(condition, "conditionOp", "not_has");

  await page.getByRole("button", { name: "新增 Effect" }).click();
  await expect(page.locator(".effect-row")).toHaveCount(2);
  await changeSelect(page.locator('.effect-row[data-index="1"]'), "effectType", "memory");
  const memoryEffect = page.locator('.effect-row[data-index="1"][data-effect-type="memory"]');
  await expect(memoryEffect).toBeVisible();
  await changeSelect(memoryEffect, "effectBank", "test_session");
  await changeSelect(memoryEffect, "effectOp", "clear");
  await expect(page.locator('.effect-row[data-index="1"] input[name="effectId"]')).toBeDisabled();

  await expect(page.locator('.effect-row[data-index="0"] select[name="effectId"] option[value="test_actions"]'))
    .toHaveAttribute("data-picker-path", "流程追蹤/操作次數");

  await changeSelect(page, "EndUp", "REPLACE");
  await expect(page.locator('select[name="EndUp"]')).toHaveValue("REPLACE");
  await expect(page.locator('select[name="nextWeightedId"]')).toHaveCount(1);

  await waitForEventSave(page, async () => {
    await page.getByRole("textbox", { name: "Name" }).fill(SAVED_EVENT_NAME);
  });
  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: /^事件 / }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) }).click();

  await expect(page.locator('select[name="EndUp"]')).toHaveValue("REPLACE");
  await expect(page.locator('.condition-row[data-condition-type="memory"] select[name="conditionBank"]')).toHaveValue("test_session");
  await expect(page.locator('.condition-row[data-condition-type="memory"] input[name="conditionId"]')).toHaveValue("smoke_not_seen");
  await expect(page.locator('.condition-row[data-condition-type="memory"] select[name="conditionOp"]')).toHaveValue("not_has");
  await expect(page.locator('.effect-row[data-index="1"][data-effect-type="memory"] select[name="effectOp"]')).toHaveValue("clear");
  await waitForEventSave(page, async () => {
    await page.locator('[data-remove-condition="0"]').click();
    await expect(page.locator(".condition-row")).toHaveCount(0);
    await page.locator('[data-remove-effect="1"]').click();
  });
  await expect(page.locator(".effect-row")).toHaveCount(1);
  await waitForEventSave(page, async () => {
    await changeSelect(page, "EndUp", "GOTO");
  });
  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) }).click();
  await expect(page.locator(".condition-row")).toHaveCount(0);
  await expect(page.locator(".effect-row")).toHaveCount(1);
  await expect(page.locator('select[name="EndUp"]')).toHaveValue("GOTO");

  await page.locator("#openSidebar").click();
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: /^顯示受控子選項 / }).click();
  const optionEffect = page.locator('.effect-row[data-index="0"][data-effect-type="option"]');
  await expect(optionEffect.locator('select[name="effectOptionTarget"]')).toHaveValue(/"item":"controlled_bonus"/);
  const localTargets = await optionEffect.locator('select[name="effectOptionTarget"] option').evaluateAll((options) => (
    options.map((option) => JSON.parse(option.value).node)
  ));
  expect(new Set(localTargets)).toEqual(new Set(["options_lab"]));

  await page.locator("#openSidebar").click();
  await page.locator('#nodeList [data-node-path="@global"]').click();
  const optionsTab = page.getByRole("button", { name: "選項", exact: true });
  await expect(optionsTab).toBeEnabled();
  await optionsTab.click();
  await expect(page.getByRole("button", { name: /全域常駐操作/ })).toBeVisible();
  const globalOptionName = page.locator('input[data-option-path="Name"]');
  await waitForOptionsSave(page, async () => {
    await globalOptionName.fill("全域常駐操作 Smoke");
  });
  await reloadAndWaitForProject(page);
  await page.locator("#openSidebar").click();
  await page.locator('#nodeList [data-node-path="@global"]').click();
  await optionsTab.click();
  await expect(page.getByRole("button", { name: /全域常駐操作 Smoke/ })).toBeVisible();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: /^顯示全域獎勵 / }).click();
  await expect(page.locator('select[name="TriggerMode"]')).toHaveValue("Action");
  const globalOptionEffect = page.locator('.effect-row[data-index="0"][data-effect-type="option"]');
  await expect(globalOptionEffect.locator('select[name="effectOptionTarget"]')).toHaveValue(/"node":"__global__"/);
  const globalTargets = await globalOptionEffect.locator('select[name="effectOptionTarget"] option').evaluateAll((options) => (
    options.map((option) => JSON.parse(option.value).node)
  ));
  expect(new Set(globalTargets)).toEqual(new Set(["__global__"]));
  await page.getByRole("button", { name: /^全局 Keyboard G / }).click();
  const globalKeyboardEffects = page.locator(".effect-row");
  const globalKeyboardEffectCount = await globalKeyboardEffects.count();
  expect(globalKeyboardEffectCount).toBeGreaterThan(0);
  await expect(page.locator('.effect-row select[name="effectType"] option[value="option"]'))
    .toHaveCount(globalKeyboardEffectCount);

  await page.getByRole("button", { name: "關聯圖" }).click();
  await expect(page.locator("#projectGraphSvg")).toBeVisible();
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-growth-stages", /^\d+$/);
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-edge-crossings", /^\d+$/);
  await expect(page.locator(".graph-edge.is-replace")).toHaveCount(2);
  await expect(page.locator(".graph-edge.is-replace.is-bidirectional")).toHaveCount(1);
  await expect(page.locator(".graph-edge.is-management")).toHaveCount(2);
  await expect(page.locator(".graph-edge.is-goto-cycle")).toHaveCount(2);
  await expect(page.locator(".graph-edge text")).toHaveCount(0);
  await expect(page.locator(".graph-node-id, .graph-root-label, .graph-global-label")).toHaveCount(0);
  await expect(page.locator(".graph-node .graph-node-dot")).toHaveCount(9);
  await expect(page.locator('.graph-node[data-node-id="__global__"], .graph-edge[data-scope="global"]')).toHaveCount(0);
  await expect(page.locator(".graph-node .graph-node-dot").first()).toHaveCSS("fill-opacity", "1");
  expect(await page.locator(".graph-edge.is-tree").count()).toBeGreaterThan(0);
  expect(await page.locator(".graph-edge.is-secondary").count()).toBeGreaterThan(0);
  await expect(page.locator('.graph-edge.is-cross[data-source="branch_lab"][data-target="outcome_fallback"] path'))
    .toHaveAttribute("d", / Q /);
  await expect(page.locator('.graph-edge.is-replace-local[data-source="replace_child_a"][data-target="replace_child_b"]'))
    .toHaveCount(1);
  await expect(page.locator('.graph-edge.is-management[data-source="replace_parent"][data-target="replace_child_b"]'))
    .toHaveCount(1);
  const chainedManagement = page.locator('.graph-edge.is-management[data-source="replace_parent"][data-target="replace_child_c"]');
  await expect(chainedManagement).toHaveCount(1);
  await expect(chainedManagement.locator("title")).toContainText("REPLACE Child A → REPLACE Child B → REPLACE Child C");
  const nodeRadii = await page.evaluate(() => ({
    parent: Number(document.querySelector('.graph-node[data-node-id="replace_parent"] .graph-node-dot').getAttribute("r")),
    leaf: Number(document.querySelector('.graph-node[data-node-id="replace_child_c"] .graph-node-dot').getAttribute("r")),
  }));
  expect(nodeRadii.parent).toBeGreaterThan(nodeRadii.leaf);
  const replacePorts = await page.evaluate(() => {
    const path = (selector) => document.querySelector(selector).getAttribute("d");
    const start = (value) => value.match(/^M ([^ ]+) ([^ ]+)/).slice(1).map(Number);
    const replaceGroup = document.querySelector('.graph-edge.is-replace-local[data-source="replace_child_a"][data-target="replace_child_b"]');
    const replaceElement = replaceGroup.querySelector("path");
    const replace = replaceElement.getAttribute("d");
    const goto = path('.graph-edge[data-source="replace_parent"][data-target="replace_child_a"][data-end-up="GOTO"] path');
    const management = path('.graph-edge.is-management[data-source="replace_parent"][data-target="replace_child_b"] path');
    const chainedManagement = path('.graph-edge.is-management[data-source="replace_parent"][data-target="replace_child_c"] path');
    const parent = document.querySelector('.graph-node[data-node-id="replace_parent"]');
    const parentMatrix = parent.transform.baseVal.consolidate().matrix;
    const parentRadius = Number(parent.querySelector(".graph-node-dot").getAttribute("r"));
    return {
      replace,
      replaceStartArrows: replaceGroup.querySelectorAll(".graph-edge-arrow.is-start").length,
      replaceEndArrows: replaceGroup.querySelectorAll(".graph-edge-arrow.is-end").length,
      replaceUsesMarkers: replaceElement.hasAttribute("marker-start") || replaceElement.hasAttribute("marker-end"),
      gotoStart: start(goto),
      managementStart: start(management),
      chainedManagementStart: start(chainedManagement),
      parentCenter: [parentMatrix.e + parentRadius, parentMatrix.f + parentRadius],
    };
  });
  expect(replacePorts.replace).toMatch(/ Q /);
  expect(replacePorts.replaceStartArrows).toBe(1);
  expect(replacePorts.replaceEndArrows).toBe(1);
  expect(replacePorts.replaceUsesMarkers).toBe(false);
  expect(replacePorts.gotoStart).toEqual(replacePorts.managementStart);
  expect(replacePorts.gotoStart).toEqual(replacePorts.chainedManagementStart);
  expect(replacePorts.gotoStart[0]).toBeCloseTo(replacePorts.parentCenter[0], 3);
  expect(replacePorts.gotoStart[1]).toBeCloseTo(replacePorts.parentCenter[1], 3);

  const graphView = async () => page.locator("#projectGraphSvg").evaluate((svg) => {
    const view = svg.viewBox.baseVal;
    return { x: view.x, y: view.y, width: view.width, height: view.height };
  });
  await page.getByRole("button", { name: "重新置中" }).click();
  const fittedView = await graphView();
  const rootCenter = await page.evaluate(() => {
    const root = document.querySelector('.graph-node[data-node-id="root"]');
    const rootMatrix = root.transform.baseVal.consolidate().matrix;
    const rootCircle = root.querySelector(".graph-node-dot");
    const rootRadius = Number(rootCircle.getAttribute("r"));
    return { x: rootMatrix.e + rootRadius, y: rootMatrix.f + rootRadius };
  });
  expect(Math.abs(rootCenter.x - (fittedView.x + fittedView.width / 2))).toBeLessThan(1);
  expect(Math.abs(rootCenter.y - (fittedView.y + fittedView.height / 2))).toBeLessThan(1);

  const graphBox = await page.locator("#projectGraphSvg").boundingBox();
  const visualMetrics = async () => page.evaluate(() => {
    const label = document.querySelector('.graph-node[data-node-id="root"] .graph-node-name');
    const arrow = document.querySelector(".graph-edge.is-tree .graph-edge-arrow.is-end");
    const svg = document.querySelector("#projectGraphSvg");
    const labelBox = label.getBoundingClientRect();
    const arrowBox = arrow.getBoundingClientRect();
    return {
      labelHeight: labelBox.height,
      arrowExtent: Math.max(arrowBox.width, arrowBox.height),
      viewWidth: svg.viewBox.baseVal.width,
    };
  });
  const beforeZoom = await visualMetrics();
  await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(80);
  const afterZoomOut = await visualMetrics();
  expect(afterZoomOut.viewWidth).toBeGreaterThan(beforeZoom.viewWidth * 1.3);
  expect(afterZoomOut.arrowExtent).toBeLessThan(beforeZoom.arrowExtent * 0.82);
  expect(Math.abs(afterZoomOut.labelHeight - beforeZoom.labelHeight)).toBeLessThan(1.5);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(80);

  const panStart = await page.evaluate(() => {
    const svg = document.querySelector("#projectGraphSvg");
    const rect = svg.getBoundingClientRect();
    const candidates = [[0.86, 0.18], [0.82, 0.76], [0.18, 0.72], [0.14, 0.22]];
    for (const [xRatio, yRatio] of candidates) {
      const x = rect.left + rect.width * xRatio;
      const y = rect.top + rect.height * yRatio;
      const target = document.elementFromPoint(x, y);
      if (target && !target.closest(".graph-node, .graph-search, .graph-reset-button")) return { x, y };
    }
    return { x: rect.left + 24, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(
    Math.min(graphBox.x + graphBox.width - 12, panStart.x + 180),
    Math.max(graphBox.y + 12, panStart.y - 90),
    { steps: 8 },
  );
  await page.mouse.up();
  const pannedView = await graphView();
  expect(Math.hypot(pannedView.x - fittedView.x, pannedView.y - fittedView.y)).toBeGreaterThan(50);
  await page.getByRole("button", { name: "重新置中" }).click();
  const resetView = await graphView();
  expect(Math.abs(resetView.x - fittedView.x)).toBeLessThan(2);
  expect(Math.abs(resetView.y - fittedView.y)).toBeLessThan(2);

  const draggableGraphNode = page.locator('.graph-node[data-node-id="root"]');
  const graphPosition = async () => draggableGraphNode.evaluate((element) => {
    const matrix = element.transform.baseVal.consolidate().matrix;
    return { x: matrix.e, y: matrix.f };
  });
  const beforeDrag = await graphPosition();
  const dragBox = await draggableGraphNode.locator(".graph-node-dot").boundingBox();
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 110, dragBox.y + dragBox.height / 2 - 55, { steps: 8 });
  await expect(draggableGraphNode).toHaveAttribute("aria-grabbed", "true");
  const duringDrag = await graphPosition();
  expect(Math.hypot(duringDrag.x - beforeDrag.x, duringDrag.y - beforeDrag.y)).toBeGreaterThan(70);
  await page.mouse.up();
  await expect(draggableGraphNode).toHaveAttribute("aria-grabbed", "false");
  await page.waitForTimeout(450);
  const afterRelease = await graphPosition();
  expect(Math.hypot(afterRelease.x - duringDrag.x, afterRelease.y - duringDrag.y)).toBeGreaterThan(2);
  await expect(page.locator("#projectGraphSvg")).toBeVisible();

  const graphBranchNode = page.locator('.graph-node[data-node-id="branch_lab"]');
  await graphBranchNode.hover();
  await expect(page.locator(".graph-canvas")).toHaveClass(/has-graph-focus/);
  expect(await page.locator(".graph-edge.is-focus-related").count()).toBeGreaterThan(0);
  await graphBranchNode.focus();
  await expect(page.locator(".graph-canvas")).toHaveClass(/has-graph-focus/);
  expect(await page.locator(".graph-edge.is-focus-related").count()).toBeGreaterThan(0);
  expect(await page.locator(".graph-node.is-focus-related").count()).toBeGreaterThan(1);
  const graphSearch = page.getByRole("searchbox", { name: "搜尋關聯圖節點" });
  await graphSearch.fill("replace_child_b");
  await expect(page.locator(".graph-node.is-search-match")).toHaveCount(1);
  expect(await page.locator(".graph-edge.is-search-dimmed").count()).toBeGreaterThan(0);
  await graphSearch.fill("");

  await page.locator("#openSidebar").click();
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.getByRole("button", { name: "選項", exact: true }).click();
  await page.getByRole("button", { name: /DATA Options 綜合測試/ }).click();
  const availability = page.locator('select[data-option-path="Availability"]');
  await expect(availability).toHaveValue("ALWAYS");
  await waitForOptionsSave(page, async () => {
    await availability.selectOption("CONTROLLED", { force: true });
  });
  await reloadAndWaitForProject(page);
  await page.locator("#openSidebar").click();
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.getByRole("button", { name: "選項", exact: true }).click();
  await page.getByRole("button", { name: /DATA Options 綜合測試/ }).click();
  await expect(page.locator('select[data-option-path="Availability"]')).toHaveValue("CONTROLLED");

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});
