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
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);
}

async function dragStartPoint(source, box) {
  const isStatRow = await source.getAttribute("data-stat-id") !== null;
  return {
    x: isStatRow ? box.x + 4 : box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function dragWithDwell(page, source, target, dwellMs = 720, beforeDrop = null) {
  const sourceElement = source.first();
  const targetElement = target.first();
  await sourceElement.scrollIntoViewIfNeeded();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag source or target is not visible");
  const start = await dragStartPoint(sourceElement, sourceBox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await page.waitForTimeout(220);
  const settledTargetBox = await targetElement.boundingBox();
  if (!settledTargetBox) throw new Error("Drag target disappeared during live reflow");
  await page.mouse.move(
    settledTargetBox.x + settledTargetBox.width / 2,
    settledTargetBox.y + settledTargetBox.height / 2,
    { steps: 4 },
  );
  await page.waitForTimeout(dwellMs);
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

async function dragWithoutFollowingReflow(page, source, target, dwellMs = 720, beforeDrop = null) {
  const sourceElement = source.first();
  const targetElement = target.first();
  await sourceElement.scrollIntoViewIfNeeded();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag source or target is not visible");
  const start = await dragStartPoint(sourceElement, sourceBox);
  const targetY = sourceBox.y < targetBox.y
    ? targetBox.y + targetBox.height * 0.78
    : targetBox.y + targetBox.height * 0.22;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, { steps: 12 });
  await page.waitForTimeout(dwellMs);
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

async function dispatchImmediateDrag(page, sourceSelector, targetSelector, beforeDrop = null) {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag source or target is not visible");
  const start = await dragStartPoint(source, sourceBox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.28, { steps: 5 });
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

async function dragToLiveTarget(page, sourceSelector, targetSelector, beforeDrop = null) {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Drag source or target is not visible");
  const start = await dragStartPoint(source, sourceBox);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(120);
    const liveTargetBox = await target.boundingBox();
    if (!liveTargetBox) throw new Error("Drag target disappeared during live reflow");
    await page.mouse.move(
      liveTargetBox.x + liveTargetBox.width / 2,
      liveTargetBox.y + liveTargetBox.height / 2,
      { steps: 3 },
    );
  }
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
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
  await expect(page.locator("#statsGroups")).toBeVisible();
  const tabIndicatorMotion = await page.locator("#tabFocusIndicator").evaluate((indicator) => {
    const style = getComputedStyle(indicator);
    return { transform: style.transform, transitionProperty: style.transitionProperty };
  });
  expect(tabIndicatorMotion.transform).toBe("none");
  expect(tabIndicatorMotion.transitionProperty.split(", ")).toEqual(["left", "width", "opacity"]);
  await expect(page.locator('.stat-group-card[data-stat-group="Normal"]')).toHaveCount(0);
  await expect(page.locator('.stat-group-card[data-stat-group="測試資源"]')).toBeVisible();
  await expect(page.locator('.stat-group-card[data-stat-group="流程追蹤"]')).toBeVisible();
  const initialStateGeometry = await page.evaluate(() => {
    const panel = document.querySelector("#statsPanel").getBoundingClientRect();
    const pageRect = document.querySelector(".state-definitions-page").getBoundingClientRect();
    const sections = Array.from(document.querySelectorAll(".state-definition-section"));
    const statsRect = sections[0].getBoundingClientRect();
    const memoryRect = sections[1].getBoundingClientRect();
    return {
      panelWidth: panel.width,
      pageWidth: pageRect.width,
      statsLeftInset: statsRect.left - panel.left,
      memoryRightInset: panel.right - memoryRect.right,
      panelRadius: getComputedStyle(document.querySelector("#statsPanel")).borderTopLeftRadius,
      headerColumns: getComputedStyle(document.querySelector(".stat-column-header")).gridTemplateColumns,
      rowColumns: getComputedStyle(document.querySelector(".stat-row")).gridTemplateColumns,
      repeatedColumnHeaders: document.querySelectorAll(".stat-group-card [role='columnheader']").length,
      statDragSpaceCount: document.querySelectorAll(".stat-drag-space").length,
      statRowCursor: getComputedStyle(document.querySelector(".stat-row")).cursor,
      memoryContentGap: (() => {
        const memorySection = sections[1];
        const heading = memorySection.querySelector(".state-section-heading").getBoundingClientRect();
        const firstRow = memorySection.querySelector(".memory-row").getBoundingClientRect();
        return firstRow.top - heading.bottom;
      })(),
      groupInsetLeft: (() => {
        const group = document.querySelector(".stat-group-card").getBoundingClientRect();
        const row = document.querySelector(".stat-group-card .stat-row").getBoundingClientRect();
        return row.left - group.left;
      })(),
      groupInsetRight: (() => {
        const group = document.querySelector(".stat-group-card").getBoundingClientRect();
        const row = document.querySelector(".stat-group-card .stat-row").getBoundingClientRect();
        return group.right - row.right;
      })(),
      horizontalOverflow: document.querySelector(".stat-groups").scrollWidth
        > document.querySelector(".stat-groups").clientWidth + 1,
    };
  });
  expect(Math.abs(initialStateGeometry.pageWidth - initialStateGeometry.panelWidth)).toBeLessThan(1);
  expect(Math.abs(initialStateGeometry.statsLeftInset)).toBeLessThan(1);
  expect(Math.abs(initialStateGeometry.memoryRightInset)).toBeLessThan(1);
  expect(initialStateGeometry.panelRadius).toBe("0px");
  expect(initialStateGeometry.rowColumns).toBe(initialStateGeometry.headerColumns);
  expect(initialStateGeometry.repeatedColumnHeaders).toBe(0);
  expect(initialStateGeometry.statDragSpaceCount).toBe(0);
  expect(initialStateGeometry.statRowCursor).toBe("grab");
  expect(initialStateGeometry.memoryContentGap).toBeLessThan(30);
  expect(initialStateGeometry.groupInsetLeft).toBeGreaterThanOrEqual(11);
  expect(initialStateGeometry.groupInsetRight).toBeGreaterThanOrEqual(11);
  expect(initialStateGeometry.horizontalOverflow).toBe(false);
  const initialSectionHeights = await page.evaluate(() => (
    Array.from(document.querySelectorAll(".state-definition-section")).map((section) => section.getBoundingClientRect().height)
  ));
  await waitForStateSave(page, async () => {
    await page.locator("#addStatButton").click();
  });
  await expect(page.locator("#statsGroups > .stat-row")).toHaveCount(1);
  const afterGroupSectionHeights = await page.evaluate(() => (
    Array.from(document.querySelectorAll(".state-definition-section")).map((section) => section.getBoundingClientRect().height)
  ));
  expect(afterGroupSectionHeights[0]).toBeGreaterThan(initialSectionHeights[0]);
  expect(Math.abs(afterGroupSectionHeights[1] - initialSectionHeights[1])).toBeLessThan(6);
  expect(Math.abs(afterGroupSectionHeights[1] - initialSectionHeights[1])).toBeLessThan(6);

  await page.getByRole("button", { name: /^事件 / }).click();
  const eventAddGeometry = await page.locator("#newEventButton").evaluate((button) => ({
    buttonWidth: button.getBoundingClientRect().width,
    containerWidth: button.parentElement.getBoundingClientRect().width,
  }));
  expect(Math.abs(eventAddGeometry.buttonWidth - eventAddGeometry.containerWidth)).toBeLessThan(1);
  const weightedEventButton = page.locator('[data-event-id="branch_random"]');
  await weightedEventButton.click();
  await expect(weightedEventButton).toHaveClass(/active/);

  const contentPicker = page.locator("[data-content-picker-toggle]");
  await expect(contentPicker).toBeVisible();
  await contentPicker.scrollIntoViewIfNeeded();
  await contentPicker.click();
  await expect(page.locator(".content-choice-menu")).toBeVisible();
  const contentFileBranch = page.locator("[data-content-file-expand]");
  await expect(contentFileBranch).toHaveCount(1);
  await contentFileBranch.click();
  const contentLabelChoice = page.locator('[data-content-label-choice="test_branch_success"]');
  await expect(contentLabelChoice).toBeVisible();
  const contentSubmenuGeometry = await page.evaluate(() => {
    const menu = document.querySelector(".content-choice-menu").getBoundingClientRect();
    const submenu = document.querySelector(".content-label-submenu").getBoundingClientRect();
    return {
      menuRight: menu.right,
      submenuLeft: submenu.left,
      submenuRight: submenu.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(contentSubmenuGeometry.submenuLeft).toBeGreaterThan(contentSubmenuGeometry.menuRight);
  expect(contentSubmenuGeometry.submenuRight).toBeLessThanOrEqual(contentSubmenuGeometry.viewportWidth - 12);

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
  const refreshedGraphTarget = await page.locator('select[name="nextWeightedId"]').inputValue();
  const graphRefreshResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/project")
    && candidate.request().method() === "GET"
    && candidate.ok()
  ));
  await page.getByRole("button", { name: "關聯圖", exact: true }).click();
  await graphRefreshResponse;
  await expect(page.locator(
    `.graph-edge[data-source="branch_lab"][data-target="${refreshedGraphTarget}"][data-end-up="GOTO"]`,
  )).toHaveCount(1);
  await expect(page.locator(
    `.graph-edge[data-source="branch_lab"][data-target="${refreshedGraphTarget}"][data-end-up="REPLACE"]`,
  )).toHaveCount(0);
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
  const targetPickerToggle = optionEffect.locator(
    'select[name="effectOptionTarget"] ~ [data-select-picker-toggle]',
  );
  await targetPickerToggle.click();
  const targetFolder = optionEffect.locator(
    'select[name="effectOptionTarget"] ~ .select-choice-menu [data-select-folder-toggle]',
  ).first();
  await targetFolder.click();
  const targetSubmenuGeometry = await optionEffect.locator(
    'select[name="effectOptionTarget"] ~ .select-choice-menu',
  ).evaluate((menu) => {
    const menuRect = menu.getBoundingClientRect();
    const submenuRect = menu.querySelector(".submenu-open > .select-choice-submenu").getBoundingClientRect();
    return {
      menuLeft: menuRect.left,
      menuRight: menuRect.right,
      submenuLeft: submenuRect.left,
      submenuRight: submenuRect.right,
      viewportWidth: window.innerWidth,
    };
  });
  const targetSubmenuIsBesideMenu = targetSubmenuGeometry.submenuLeft > targetSubmenuGeometry.menuRight
    || targetSubmenuGeometry.submenuRight < targetSubmenuGeometry.menuLeft;
  expect(targetSubmenuIsBesideMenu).toBe(true);
  expect(targetSubmenuGeometry.submenuLeft).toBeGreaterThanOrEqual(12);
  expect(targetSubmenuGeometry.submenuRight).toBeLessThanOrEqual(targetSubmenuGeometry.viewportWidth - 12);
  await page.keyboard.press("Escape");

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
  await expect(page.locator(".graph-canvas")).toHaveClass(/is-revealing/);
  const revealDelays = await page.evaluate(() => ({
    root: getComputedStyle(document.querySelector('.graph-node[data-node-id="root"] .graph-node-content'))
      .animationDelay,
    outcome: getComputedStyle(document.querySelector('.graph-node[data-node-id="outcome_success"] .graph-node-content'))
      .animationDelay,
  }));
  expect(parseFloat(revealDelays.root)).toBe(0);
  expect(parseFloat(revealDelays.outcome)).toBeGreaterThan(parseFloat(revealDelays.root));
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-layout-algorithm", "structured-depth");
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-depth-columns", /^[2-9]\d*$/);
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-edge-crossings", /^\d+$/);
  await expect(page.locator(".graph-structure-legend, .graph-depth-column")).toHaveCount(0);
  await expect(page.locator(".graph-edge.is-replace")).toHaveCount(2);
  await expect(page.locator(".graph-edge.is-replace.is-bidirectional")).toHaveCount(1);
  await expect(page.locator(".graph-edge.is-management")).toHaveCount(2);
  await expect(page.locator(".graph-edge.is-goto-cycle")).toHaveCount(2);
  await expect(page.locator(".graph-edge text")).toHaveCount(0);
  await expect(page.locator(".graph-node-id, .graph-root-label, .graph-global-label")).toHaveCount(0);
  await expect(page.locator(".graph-node .graph-node-dot")).toHaveCount(9);
  await expect(page.locator('.graph-node[data-node-id="__global__"], .graph-edge[data-scope="global"]')).toHaveCount(0);
  await expect(page.locator(".graph-node .graph-node-dot").first()).toHaveCSS("fill-opacity", "1");
  await expect(page.locator(".graph-canvas")).not.toHaveClass(/is-revealing/);
  const idleBefore = await page.evaluate(() => {
    const node = document.querySelector('.graph-node[data-node-id="root"] .graph-node-content');
    const matrix = node.transform.baseVal.consolidate()?.matrix;
    return { x: matrix.e, y: matrix.f };
  });
  await page.waitForTimeout(240);
  const idleAfter = await page.evaluate(() => {
    const node = document.querySelector('.graph-node[data-node-id="root"] .graph-node-content');
    const matrix = node.transform.baseVal.consolidate()?.matrix;
    return { x: matrix.e, y: matrix.f };
  });
  const idleDistance = Math.hypot(idleAfter.x - idleBefore.x, idleAfter.y - idleBefore.y);
  expect(idleDistance).toBeGreaterThan(0.005);
  expect(idleDistance).toBeLessThan(3);
  expect(await page.locator(".graph-edge.is-tree").count()).toBeGreaterThan(0);
  expect(await page.locator(".graph-edge.is-secondary").count()).toBeGreaterThan(0);
  await expect(page.locator('.graph-edge.is-cross[data-source="branch_lab"][data-target="outcome_fallback"] path'))
    .toHaveAttribute("d", / C /);
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
    const parentContentMatrix = parent.querySelector(".graph-node-content").transform.baseVal.consolidate().matrix;
    const parentRadius = Number(parent.querySelector(".graph-node-dot").getAttribute("r"));
    return {
      replace,
      replaceStartArrows: replaceGroup.querySelectorAll(".graph-edge-arrow.is-start").length,
      replaceEndArrows: replaceGroup.querySelectorAll(".graph-edge-arrow.is-end").length,
      replaceUsesMarkers: replaceElement.hasAttribute("marker-start") || replaceElement.hasAttribute("marker-end"),
      gotoStart: start(goto),
      managementStart: start(management),
      chainedManagementStart: start(chainedManagement),
      parentCenter: [
        parentMatrix.e + parentContentMatrix.e + parentRadius,
        parentMatrix.f + parentContentMatrix.f + parentRadius,
      ],
    };
  });
  expect(replacePorts.replace).toMatch(/ C /);
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
  await page.getByRole("button", { name: "顯示全圖" }).click();
  const fittedView = await graphView();
  const structuredPositions = await page.evaluate(() => {
    const center = (nodeId) => {
      const node = document.querySelector(`.graph-node[data-node-id="${nodeId}"]`);
      const matrix = node.transform.baseVal.consolidate().matrix;
      const radius = Number(node.querySelector(".graph-node-dot").getAttribute("r"));
      return { x: matrix.e + radius, y: matrix.f + radius };
    };
    return {
      root: center("root"),
      options: center("options_lab"),
      branch: center("branch_lab"),
      outcome: center("outcome_success"),
      fallback: center("outcome_fallback"),
      replaceA: center("replace_child_a"),
      replaceB: center("replace_child_b"),
      replaceC: center("replace_child_c"),
      all: [...document.querySelectorAll(".graph-node")].map((node) => {
        const matrix = node.transform.baseVal.consolidate().matrix;
        const radius = Number(node.querySelector(".graph-node-dot").getAttribute("r"));
        return { x: matrix.e + radius, y: matrix.f + radius };
      }),
    };
  });
  expect(structuredPositions.options.x).toBeGreaterThan(structuredPositions.root.x);
  expect(structuredPositions.branch.x).toBeGreaterThan(structuredPositions.options.x);
  expect(structuredPositions.outcome.x).toBeGreaterThan(structuredPositions.branch.x);
  expect(structuredPositions.fallback.x).toBeGreaterThan(structuredPositions.branch.x);
  expect(structuredPositions.replaceB.x).toBeGreaterThan(structuredPositions.replaceA.x);
  expect(structuredPositions.replaceC.x).toBeLessThan(structuredPositions.replaceB.x);
  expect(Math.abs(structuredPositions.replaceC.x - structuredPositions.replaceA.x)).toBeLessThan(5);
  expect(Math.abs(structuredPositions.replaceB.x - structuredPositions.replaceA.x)).toBeLessThanOrEqual(166);
  const localCycleBounds = await page.evaluate(() => {
    const center = (nodeId) => {
      const node = document.querySelector(`.graph-node[data-node-id="${nodeId}"]`);
      const matrix = node.transform.baseVal.consolidate().matrix;
      const radius = Number(node.querySelector(".graph-node-dot").getAttribute("r"));
      return { x: matrix.e + radius, y: matrix.f + radius };
    };
    const endpoints = [center("branch_lab"), center("outcome_success")];
    return {
      minimumX: Math.min(...endpoints.map((point) => point.x)),
      maximumX: Math.max(...endpoints.map((point) => point.x)),
      minimumY: Math.min(...endpoints.map((point) => point.y)),
      maximumY: Math.max(...endpoints.map((point) => point.y)),
      paths: [...document.querySelectorAll(
        '.graph-edge.is-goto-cycle[data-source="branch_lab"][data-target="outcome_success"] path, '
        + '.graph-edge.is-goto-cycle[data-source="outcome_success"][data-target="branch_lab"] path',
      )].map((path) => {
        const box = path.getBBox();
        return { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height };
      }),
    };
  });
  expect(localCycleBounds.paths).toHaveLength(2);
  localCycleBounds.paths.forEach((box) => {
    expect(box.x).toBeGreaterThan(localCycleBounds.minimumX - 120);
    expect(box.right).toBeLessThan(localCycleBounds.maximumX + 120);
    expect(box.y).toBeGreaterThan(localCycleBounds.minimumY - 120);
    expect(box.bottom).toBeLessThan(localCycleBounds.maximumY + 120);
  });
  structuredPositions.all.forEach((position) => {
    expect(position.x).toBeGreaterThan(fittedView.x);
    expect(position.x).toBeLessThan(fittedView.x + fittedView.width);
    expect(position.y).toBeGreaterThan(fittedView.y);
    expect(position.y).toBeLessThan(fittedView.y + fittedView.height);
  });

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

  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
  }
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-node-names", "hidden");
  await expect(page.locator('.graph-node[data-node-id="root"] .graph-node-name')).toHaveCSS("visibility", "hidden");
  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-node-names", "visible");
  await expect(page.locator('.graph-node[data-node-id="root"] .graph-node-name')).toHaveCSS("visibility", "visible");

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
  await page.getByRole("button", { name: "顯示全圖" }).click();
  const resetView = await graphView();
  expect(Math.abs(resetView.x - fittedView.x)).toBeLessThan(2);
  expect(Math.abs(resetView.y - fittedView.y)).toBeLessThan(2);

  const draggableGraphNode = page.locator('.graph-node[data-node-id="root"]');
  const graphPosition = async () => draggableGraphNode.evaluate((element) => {
    const matrix = element.transform.baseVal.consolidate().matrix;
    return { x: matrix.e, y: matrix.f };
  });
  const connectedGraphNode = page.locator('.graph-node[data-node-id="options_lab"] .graph-node-content');
  const connectedMotionPosition = async () => connectedGraphNode.evaluate((element) => {
    const matrix = element.transform.baseVal.consolidate().matrix;
    return { x: matrix.e, y: matrix.f };
  });
  const beforeDrag = await graphPosition();
  const connectedBeforeDrag = await connectedMotionPosition();
  const dragBox = await draggableGraphNode.locator(".graph-node-dot").boundingBox();
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 110, dragBox.y + dragBox.height / 2 - 55, { steps: 8 });
  await expect(draggableGraphNode).toHaveAttribute("aria-grabbed", "true");
  await page.waitForTimeout(180);
  const duringDrag = await graphPosition();
  const connectedDuringDrag = await connectedMotionPosition();
  expect(Math.hypot(duringDrag.x - beforeDrag.x, duringDrag.y - beforeDrag.y)).toBeGreaterThan(70);
  expect(Math.hypot(
    connectedDuringDrag.x - connectedBeforeDrag.x,
    connectedDuringDrag.y - connectedBeforeDrag.y,
  )).toBeGreaterThan(0.5);
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

  // Verify English language switch, persistence, and restore Traditional Chinese
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await expect(page.locator("#settingsDialog")).toBeVisible();
  await expect(page.locator(".settings-primary-column > .settings-section")).toHaveCount(2);
  await expect(page.locator(".settings-primary-column small")).toHaveCount(0);
  const settingsColumns = await page.locator(".settings-body").evaluate((body) => {
    const primary = body.querySelector(".settings-primary-column").getBoundingClientRect();
    const shortcuts = body.querySelector(".settings-shortcuts-section").getBoundingClientRect();
    return { primaryLeft: primary.left, shortcutsLeft: shortcuts.left };
  });
  expect(settingsColumns.primaryLeft).toBeLessThan(settingsColumns.shortcutsLeft);
  const editorLanguageSelect = page.locator("#editorLanguage");
  await expect(editorLanguageSelect).toHaveValue("zh-Hant");
  const compactSettingLabels = page.locator(
    '.setting-row strong[data-i18n="介面語言"], .setting-row strong[data-i18n="儲存延遲"]',
  );
  await expect(compactSettingLabels).toHaveCount(2);
  const compactSettingLabelMetrics = await compactSettingLabels.evaluateAll((labels) => labels.map((label) => ({
    height: label.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
    whiteSpace: getComputedStyle(label).whiteSpace,
  })));
  compactSettingLabelMetrics.forEach((metric) => {
    expect(metric.height).toBeLessThanOrEqual(metric.lineHeight * 1.15);
    expect(metric.whiteSpace).toBe("nowrap");
  });
  const languagePickerToggle = page.locator("#editorLanguage ~ [data-select-picker-toggle]");
  await languagePickerToggle.click();
  const languageMenuGeometry = await page.locator("#editorLanguage ~ .select-choice-menu").evaluate((menu) => {
    const picker = menu.closest(".select-choice-picker");
    const trigger = picker.querySelector("[data-select-picker-toggle]").getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    return {
      triggerLeft: trigger.left,
      triggerBottom: trigger.bottom,
      menuLeft: menuRect.left,
      menuTop: menuRect.top,
      menuRight: menuRect.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(Math.abs(languageMenuGeometry.menuLeft - languageMenuGeometry.triggerLeft)).toBeLessThan(2);
  expect(Math.abs(languageMenuGeometry.menuTop - (languageMenuGeometry.triggerBottom + 7))).toBeLessThan(2);
  expect(languageMenuGeometry.menuRight).toBeLessThanOrEqual(languageMenuGeometry.viewportWidth - 12);
  await page.keyboard.press("Escape");

  const settingsSaveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await editorLanguageSelect.selectOption("en", { force: true });
  await settingsSaveResponse;
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Node", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Events / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Options", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Content", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "State", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Graph", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Validation / })).toBeVisible();
  await expect(page.locator("#nodeSearch")).toHaveAttribute("placeholder", "Search nodes");

  await reloadAndWaitForProject(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "Node", exact: true })).toBeVisible();

  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await expect(page.locator("#settingsDialog")).toBeVisible();
  const langSelectEn = page.locator("#editorLanguage");
  await expect(langSelectEn).toHaveValue("en");

  const restoreSaveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await langSelectEn.selectOption("zh-Hant", { force: true });
  await restoreSaveResponse;
  await page.waitForLoadState("networkidle");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("button", { name: "節點", exact: true })).toBeVisible();

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("Stats use the same dwell grouping, rollback, and singleton dissolution", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await page.goto(editorUrl);
  await page.getByRole("button", { name: "狀態", exact: true }).click();

  const looseIdsBeforeTailTest = await page.locator("#statsGroups > .stat-row").evaluateAll((rows) => (
    rows.map((row) => row.dataset.statId)
  ));
  if (looseIdsBeforeTailTest.length) {
    const setupResult = await page.evaluate(async (looseIds) => {
      const projectResponse = await fetch("/api/project");
      const project = await projectResponse.json();
      looseIds.forEach((id) => {
        if (project.stats[id]) project.stats[id].Group = "測試資源";
      });
      const response = await fetch("/api/stats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: project.stats }),
      });
      return { ok: response.ok, status: response.status };
    }, looseIdsBeforeTailTest);
    expect(setupResult).toEqual({ ok: true, status: 200 });
    await reloadAndWaitForProject(page);
    await page.getByRole("button", { name: "狀態", exact: true }).click();
  }
  await expect(page.locator("#statsGroups > .stat-row")).toHaveCount(0);

  await page.locator("#statsPanel").evaluate((panel) => {
    panel.style.height = "520px";
    panel.style.overflowY = "auto";
    panel.querySelector("#stateDefinitionsPage").style.minHeight = "2200px";
  });
  const scrollMetrics = await page.locator("#statsPanel").evaluate((panel) => ({
    clientHeight: panel.clientHeight,
    overflowY: getComputedStyle(panel).overflowY,
    scrollHeight: panel.scrollHeight,
  }));
  expect(scrollMetrics.overflowY).toBe("auto");
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  let scrollSource = page.locator(".stat-group-card .stat-row").first();
  const scrollSourceId = await scrollSource.getAttribute("data-stat-id");
  scrollSource = page.locator(`#statsGroups .stat-row[data-stat-id="${scrollSourceId}"]`);
  await scrollSource.scrollIntoViewIfNeeded();
  const initialScrollTop = await page.locator("#statsPanel").evaluate((panel) => panel.scrollTop);
  const scrollSourceBox = await scrollSource.boundingBox();
  const statsPanelBox = await page.locator("#statsPanel").boundingBox();
  if (!scrollSourceBox || !statsPanelBox) throw new Error("Stats auto-scroll geometry is unavailable");
  await page.mouse.move(scrollSourceBox.x + 4, scrollSourceBox.y + scrollSourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(scrollSourceBox.x + 4, statsPanelBox.y + statsPanelBox.height - 4, { steps: 10 });
  await expect(scrollSource).toHaveAttribute("aria-grabbed", "true");
  await expect.poll(() => page.locator("#statsPanel").evaluate((panel) => panel.scrollTop)).toBeGreaterThan(initialScrollTop + 20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.locator("#statsPanel").evaluate((panel) => {
    panel.scrollTop = 0;
    panel.style.height = "";
    panel.style.overflowY = "";
    panel.querySelector("#stateDefinitionsPage").style.minHeight = "";
  });

  const initiallyGroupedRow = page.locator('.stat-group-card[data-stat-group="流程追蹤"] .stat-row').first();
  const initiallyGroupedId = await initiallyGroupedRow.getAttribute("data-stat-id");
  const leaveGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/stats")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    `.stat-row[data-stat-id="${initiallyGroupedId}"]`,
    ".stat-loose-drop-tail",
    async () => {
      await expect(page.locator(`#statsGroups .stat-row[data-stat-id="${initiallyGroupedId}"]`)).toHaveAttribute("aria-grabbed", "true");
      expect(await page.evaluate(() => window.getSelection()?.toString() || "")).toBe("");
    },
  );
  await leaveGroupResponse;
  await expect(page.locator(`#statsGroups > .stat-row[data-stat-id="${initiallyGroupedId}"]`)).toBeVisible();

  await waitForStateSave(page, () => page.locator("#addStatButton").click());
  await waitForStateSave(page, () => page.locator("#addStatButton").click());

  const rows = page.locator("#statsGroups > .stat-row");
  const rowCount = await rows.count();
  const sourceId = await rows.nth(rowCount - 2).getAttribute("data-stat-id");
  const targetId = await rows.nth(rowCount - 1).getAttribute("data-stat-id");
  const sourceRow = page.locator(`.stat-row[data-stat-id="${sourceId}"]`);
  const targetRow = page.locator(`.stat-row[data-stat-id="${targetId}"]`);

  await page.route("**/api/stats", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Stat 群組測試失敗" }) });
      return;
    }
    await route.continue();
  });
  await dragWithDwell(page, sourceRow, targetRow);
  await expect(page.locator(".toast.error")).toContainText("Stat 群組測試失敗");
  await expect(page.locator(`#statsGroups > .stat-row[data-stat-id="${sourceId}"]`)).toBeVisible();
  await expect(page.locator(`#statsGroups > .stat-row[data-stat-id="${targetId}"]`)).toBeVisible();
  await page.unroute("**/api/stats");

  const createGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/stats")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWithDwell(page, sourceRow, targetRow);
  await createGroupResponse;
  await expect(page.locator(".toast", { hasText: "群組已建立" })).toHaveCount(0);
  const newGroup = page.locator('.stat-group-card[data-stat-group="新群組"]');
  await expect(newGroup.locator(".stat-row")).toHaveCount(2);
  await expect(newGroup.locator("[data-stat-group-name]")).toBeFocused();

  const moveStatGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/stats")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    '.stat-group-card[data-stat-group="新群組"] .stat-group-drag-space',
    "#statsGroups > .stat-row",
  );
  await moveStatGroupResponse;
  await expect(page.locator(".toast", { hasText: "Stat 排序已更新" })).toHaveCount(0);
  await expect.poll(() => page.locator("#statsGroups").evaluate((flow) => {
    const blocks = [...flow.children].filter((child) => (
      child.matches(".stat-group-card, .stat-row")
    ));
    return blocks.at(-1)?.getAttribute("data-stat-group") !== "新群組";
  })).toBe(true);

  const resourcesGroup = page.locator('.stat-group-card[data-stat-group="測試資源"]');
  const moveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/stats")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWithDwell(
    page,
    sourceRow,
    resourcesGroup.locator(".stat-row").first(),
    720,
    async () => {
      await expect(page.locator(".group-drag-preview")).toBeVisible();
      await expect(resourcesGroup).toHaveClass(/is-group-preview-open/);
      await expect(resourcesGroup.locator(`.stat-row[data-stat-id="${sourceId}"]`)).toHaveCount(1);
    },
  );
  await moveResponse;
  await expect(page.locator('.stat-group-card[data-stat-group="新群組"]')).toHaveCount(0);
  await expect(resourcesGroup.locator(`.stat-row[data-stat-id="${sourceId}"]`)).toBeVisible();
  await expect(page.locator(`#statsGroups > .stat-row[data-stat-id="${targetId}"]`)).toBeVisible();

  const reorderResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/stats")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dispatchImmediateDrag(
    page,
    `.stat-row[data-stat-id="${sourceId}"]`,
    `#statsGroups > .stat-row[data-stat-id="${targetId}"]`,
  );
  await reorderResponse;
  await expect(page.locator('.stat-group-card[data-stat-group="測試資源"]')).toHaveCount(0);
  await expect.poll(() => page.locator("#statsGroups > .stat-row").evaluateAll((items, ids) => {
    const order = items.map((item) => item.dataset.statId);
    return order.indexOf(ids[0]) < order.indexOf(ids[1]);
  }, [sourceId, targetId])).toBe(true);

  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: "狀態", exact: true }).click();
  await expect.poll(() => page.locator("#statsGroups > .stat-row").evaluateAll((items, ids) => {
    const order = items.map((item) => item.dataset.statId);
    return order.indexOf(ids[0]) < order.indexOf(ids[1]);
  }, [sourceId, targetId])).toBe(true);
});

test("graph refreshes newly created nodes without a page reload", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();

  await page.evaluate(() => document.querySelector("#newNodeButton")?.click());
  await page.locator('#nodeDialog input[name="name"]').fill("即時更新節點");
  const createResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/nodes")
    && candidate.request().method() === "POST"
    && candidate.ok()
  ));
  await page.getByRole("button", { name: "建立節點" }).click();
  await createResponse;
  await expect(page.getByRole("status")).toHaveText("已同步");

  await page.evaluate(() => { window.__graphRefreshDidNotReload = true; });
  const graphRefreshResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/project")
    && candidate.request().method() === "GET"
    && candidate.ok()
  ));
  await page.getByRole("button", { name: "關聯圖", exact: true }).click();
  await graphRefreshResponse;
  await expect(page.locator(".graph-node-name", { hasText: "即時更新節點" })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__graphRefreshDidNotReload)).toBe(true);
});

test("Event groups form through dwell-drag and dissolve when one item remains", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已同步");
  await page.locator("#openSidebar").click();
  const branchLabNode = page.locator('#nodeList [data-node-path="branch_lab"]');
  await expect(branchLabNode).toBeVisible();
  await branchLabNode.click();
  await page.getByRole("button", { name: /^事件 / }).click();

  await expect(page.locator("#newEventGroupButton")).toHaveCount(0);
  const savedEvent = page.locator('[data-group-item-id="branch_random"]');
  const backEvent = page.locator('[data-group-item-id="branch_back"]');
  await expect(savedEvent).toBeVisible();
  const nonStickyReorder = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWithoutFollowingReflow(page, savedEvent, backEvent, 720, async () => {
    await expect(backEvent).not.toHaveClass(/is-group-ready/);
  });
  await nonStickyReorder;
  await expect(page.locator(".event-group")).toHaveCount(0);

  await page.route("**/api/event-groups", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.assignments) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "測試移動失敗" }) });
      return;
    }
    await route.continue();
  });
  await dragWithDwell(page, savedEvent, backEvent, 720, async () => {
    await expect(backEvent).toHaveClass(/is-group-ready/);
    await expect(page.locator(".group-drag-preview")).toBeVisible();
  });
  await expect(page.locator(".event-group")).toHaveCount(0);
  await expect(page.locator('.event-pool-flow > [data-group-item-id="branch_random"]')).toBeVisible();
  await expect(page.locator(".toast.error")).toContainText("測試移動失敗");
  await page.unroute("**/api/event-groups");
  await page.waitForTimeout(220);

  const createGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWithDwell(page, savedEvent, backEvent);
  await createGroupResponse;
  await expect(page.locator(".toast", { hasText: "群組已建立" })).toHaveCount(0);
  const newGroup = page.locator('[data-group-drop="新群組"]');
  await expect(newGroup.locator(".subnav-item")).toHaveCount(2);
  const groupName = newGroup.locator("[data-event-group-name]");
  await expect(groupName).toBeFocused();
  const renameResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await groupName.fill("主線流程");
  await groupName.press("Enter");
  await renameResponse;
  const renamedGroup = page.locator('[data-group-drop="主線流程"]');
  await expect(renamedGroup).toBeVisible();
  await expect(renamedGroup.locator("button")).toHaveCount(2);
  await page.mouse.move(1000, 700);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeLessThan(2);
  const groupHeaderBox = await renamedGroup.locator(".event-group-header").boundingBox();
  if (!groupHeaderBox) throw new Error("Event group header is not visible");
  await page.mouse.move(groupHeaderBox.x + groupHeaderBox.width / 2, groupHeaderBox.y + groupHeaderBox.height / 2);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  const moveGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    '[data-group-drop="主線流程"] .event-group-drag-space',
    ".event-loose-drop-tail",
    async () => {
      await expect(page.locator('[data-group-drop="主線流程"]').first()).toHaveClass(/is-group-block-dragging/);
      expect(await page.locator('[data-group-drop="主線流程"] .event-group-items-shell').first().evaluate((shell) => (
        shell.getBoundingClientRect().height
      ))).toBeLessThan(2);
    },
  );
  await moveGroupResponse;
  await expect(page.locator(".toast", { hasText: "Event 排序已更新" })).toHaveCount(0);
  await expect.poll(() => page.locator(".event-pool-flow").evaluate((flow) => {
    const blocks = [...flow.children].filter((child) => (
      child.matches(".event-group, [data-group-item-id]")
    ));
    return blocks.at(-1)?.getAttribute("data-group-drop");
  })).toBe("主線流程");

  const looseEvent = page.locator(".event-pool-flow > [data-group-item-id]").first();
  const looseEventId = await looseEvent.getAttribute("data-group-item-id");
  const moveBelowGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    `.event-pool-flow > [data-group-item-id="${looseEventId}"]`,
    ".event-loose-drop-tail",
  );
  await moveBelowGroupResponse;
  await expect.poll(() => page.locator(".event-pool-flow").evaluate((flow) => {
    const blocks = [...flow.children].filter((child) => (
      child.matches(".event-group, [data-group-item-id]")
    ));
    return blocks.at(-1)?.getAttribute("data-group-item-id");
  })).toBe(looseEventId);

  const ungrouped = page.locator(".event-pool-flow");
  const dissolveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  const renamedGroupHeader = page.locator('[data-group-drop="主線流程"] .event-group-header');
  await renamedGroupHeader.hover();
  await page.waitForTimeout(260);
  await dragToLiveTarget(
    page,
    '[data-group-drop="主線流程"] [data-group-item-id="branch_random"]',
    ".event-loose-drop-tail",
  );
  await dissolveResponse;
  await expect(page.locator('[data-group-drop="主線流程"]')).toHaveCount(0);
  await expect(ungrouped.locator(':scope > [data-group-item-id="branch_random"]')).toBeVisible();
  await expect(ungrouped.locator(':scope > [data-group-item-id="branch_back"]')).toBeVisible();

  const reorderResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dispatchImmediateDrag(
    page,
    '.event-pool-flow > [data-group-item-id="branch_random"]',
    '.event-pool-flow > [data-group-item-id="branch_back"]',
  );
  await reorderResponse;
  await expect.poll(() => ungrouped.locator(":scope > [data-group-item-id]").evaluateAll((items) => {
    const order = items.map((item) => item.dataset.groupItemId);
    return order.indexOf("branch_random") < order.indexOf("branch_back");
  })).toBe(true);

  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: /^事件 / }).click();
  await expect(page.locator('[data-group-drop="主線流程"]')).toHaveCount(0);
  await expect(page.locator('.event-pool-flow > [data-group-item-id="branch_back"]')).toBeVisible();
  await expect.poll(() => page.locator(".event-pool-flow > [data-group-item-id]").evaluateAll((items) => {
    const order = items.map((item) => item.dataset.groupItemId);
    return order.indexOf("branch_random") < order.indexOf("branch_back");
  })).toBe(true);
});

test("language switch handles failed persistence with atomic rollback and error toast", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);

  const initialStorage = await page.evaluate(() => localStorage.getItem("scene-node-editor.settings"));

  await page.route("**/api/editor-settings", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Server write error" }),
      });
    } else {
      await route.continue();
    }
  });

  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await expect(page.locator("#settingsDialog")).toBeVisible();
  const editorLanguageSelect = page.locator("#editorLanguage");
  await editorLanguageSelect.selectOption("en", { force: true });

  await expect(page.locator(".toast.error")).toHaveText(/編輯器設定未能儲存/);
  await expect(editorLanguageSelect).toHaveValue("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");

  const postFailureStorage = await page.evaluate(() => localStorage.getItem("scene-node-editor.settings"));
  expect(postFailureStorage).toBe(initialStorage);

  await page.unroute("**/api/editor-settings");
});

test("language switch refuses an unsaved draft while autosave is disabled", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);
  await page.evaluate(() => { window.__languageSwitchPage = "same-page"; });
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  const settingsPut = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await page.locator("#autosaveEnabled").uncheck({ force: true });
  await settingsPut;
  await page.locator("#settingsDialog").evaluate((dialog) => dialog.close());

  await page.locator('#nodeForm [name="Name"]').fill("Unsaved language guard");
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await page.locator("#editorLanguage").selectOption("en", { force: true });
  await expect(page.locator(".toast.error")).toHaveText(/未儲存的變更/);
  await expect(page.locator("#editorLanguage")).toHaveValue("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.locator('#nodeForm [name="Name"]')).toHaveValue("Unsaved language guard");
  await expect.poll(() => page.evaluate(() => window.__languageSwitchPage)).toBe("same-page");

  await page.reload();
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  const restorePut = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await page.locator("#autosaveEnabled").check({ force: true });
  await restorePut;
});

test("language switch stays put when flushing the current draft fails", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);
  await page.evaluate(() => { window.__languageSwitchPage = "same-page"; });
  await page.route("**/api/node", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Node write error" }),
      });
    } else {
      await route.continue();
    }
  });

  await page.locator('#nodeForm [name="Name"]').fill("Failed flush language guard");
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await page.locator("#editorLanguage").selectOption("en", { force: true });

  await expect(page.locator(".toast.error").last()).toBeVisible();
  await expect(page.locator("#editorLanguage")).toHaveValue("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect.poll(() => page.evaluate(() => window.__languageSwitchPage)).toBe("same-page");

  await page.unroute("**/api/node");
  await page.reload();
});

test("dynamic English surfaces render localized strings correctly across all workspaces", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);

  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  const editorLanguageSelect = page.locator("#editorLanguage");
  const settingsSaveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await editorLanguageSelect.selectOption("en", { force: true });
  await settingsSaveResponse;
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Node", exact: true }).click();
  await expect(page.locator(".node-overview")).toBeVisible();
  await expect(page.getByText("Node Connections")).toBeVisible();
  await expect(page.getByText("Event Phases")).toBeVisible();

  await page.getByRole("button", { name: /^Events/ }).click();
  await expect(page.locator("#newEventButton")).toHaveAttribute("aria-label", "Add Event");
  await expect(page.getByText("返回 DATA Options", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.locator(".option-element-sidebar")).toBeVisible();
  await expect(page.locator('[data-add-option-element="TEXTBOX"]')).toHaveText("Text Box");
  await expect(page.locator("#optionsPanel")).not.toContainText("不透明度");

  await page.getByRole("button", { name: "Content", exact: true }).click();
  await expect(page.locator(".content-workspace")).toBeVisible();
  await expect(page.locator("#newContentButton")).toHaveAttribute("aria-label", "Add Content");

  await page.getByRole("button", { name: "State", exact: true }).click();
  await expect(page.locator("#addStatButton")).toHaveAttribute("aria-label", "Add Stat");
  await expect(page.locator("#addMemoryButton")).toHaveAttribute("aria-label", "Add Memory Bank");
  await expect(page.locator('input[name="statName"][value="測試點數"]')).toBeVisible();

  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.locator("#graphSearch")).toHaveAttribute("placeholder", "Search nodes");
  await expect(page.locator("#resetGraphView")).toHaveAttribute("aria-label", "Show full graph");

  await page.getByRole("button", { name: /^Validation/ }).click();
  await expect(page.getByRole("heading", { name: "Project Validation" })).toBeVisible();
  await expect(page.locator("#runValidationButton")).toHaveText("Re-check");

  await page.evaluate(() => document.querySelector("#newNodeButton")?.click());
  await expect(page.locator("#nodeDialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add Scene Node" })).toBeVisible();
  await page.locator("#nodeDialog").evaluate((dialog) => dialog.close());

  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  const langSelectEn = page.locator("#editorLanguage");
  const restoreSaveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await langSelectEn.selectOption("zh-Hant", { force: true });
  await restoreSaveResponse;
  await page.waitForLoadState("networkidle");
});

test("interaction details expose keyboard focus and honor reduced motion", async ({ page }) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();

  const eventTab = page.locator('.tab[data-tab="events"]');
  const eventTabBox = await eventTab.boundingBox();
  if (!eventTabBox) throw new Error("Event tab geometry is unavailable");
  await page.mouse.move(eventTabBox.x + eventTabBox.width / 2, eventTabBox.y + eventTabBox.height / 2);
  await page.mouse.down();
  const pressedTabState = await page.evaluate(() => {
    const indicator = document.querySelector("#tabFocusIndicator");
    const target = document.querySelector('.tab[data-tab="events"]');
    return {
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      indicatorLeft: Number.parseFloat(indicator.style.left),
      pointerNavigation: document.querySelector("#tabbar").classList.contains("is-pointer-navigation"),
      targetLeft: target.offsetLeft,
    };
  });
  expect(pressedTabState.activeTab).toBe("node");
  expect(pressedTabState.indicatorLeft).toBe(pressedTabState.targetLeft);
  expect(pressedTabState.pointerNavigation).toBe(true);
  await page.mouse.up();
  await expect(eventTab).toHaveClass(/active/);
  await page.locator('.tab[data-tab="node"]').click();
  await expect(page.locator('.tab[data-tab="node"]')).toHaveClass(/active/);

  const nameField = page.locator('#nodeForm [name="Name"]');
  await nameField.focus();
  await expect.poll(() => nameField.evaluate((field) => getComputedStyle(field).borderColor))
    .toBe("rgb(92, 114, 101)");
  await expect.poll(() => nameField.evaluate((field) => getComputedStyle(field).boxShadow))
    .not.toBe("none");

  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  const settingsDialog = page.locator("#settingsDialog");
  await expect(settingsDialog).toBeVisible();
  await expect.poll(() => settingsDialog.evaluate((dialog) => getComputedStyle(dialog).animationName))
    .toContain("dialog-present");
  await settingsDialog.evaluate((dialog) => dialog.close());

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => document.querySelector("#settingsButton")?.click());
  await expect(settingsDialog).toBeVisible();
  await expect.poll(() => settingsDialog.evaluate((dialog) => getComputedStyle(dialog).animationName))
    .toBe("none");

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});
