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
  await expect(page.locator("#saveState")).toHaveText("已自動儲存");
}

async function waitForOptionsSave(page, action) {
  const response = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/options")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await action();
  await response;
  await expect(page.locator("#saveState")).toHaveText("已自動儲存");
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
  await expect(page.locator("#saveState")).toHaveText(/^(已同步|已自動儲存|Synced|Autosaved)$/);
}

async function openNodeSidebar(page) {
  await expect(page.getByRole("navigation", { name: /編輯器分頁|Editor tabs/ })).toBeVisible();
  await expect(page.locator("#saveState")).toHaveText(/^(已同步|已自動儲存|Synced|Autosaved)$/);
  const body = page.locator("body");
  if (!await body.evaluate((element) => element.classList.contains("sidebar-open"))) {
    await page.locator("#openSidebar").click();
  }
  await expect(page.locator("#openSidebar")).toHaveAttribute("aria-expanded", "true");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  await expect.poll(() => sidebar.evaluate((element) => getComputedStyle(element).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
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

async function expectGroupReservation(target) {
  await expect.poll(() => target.evaluate((item) => {
    const style = getComputedStyle(item, "::after");
    return { margin: getComputedStyle(item).marginBottom,
      top: style.top, right: style.right, bottom: style.bottom, left: style.left,
      hasShadow: style.boxShadow !== "none" };
  })).toEqual({ margin: "48px", top: "-6px", right: "-6px", bottom: "-48px", left: "-6px", hasShadow: true });
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

async function dragListItemBefore(page, source, target, beforeDrop = null) {
  const sourceElement = source.first();
  const targetElement = target.first();
  await sourceElement.scrollIntoViewIfNeeded();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("List reorder source or target is not visible");
  // Stay inside the card's drag surface instead of its anti-aliased border.
  await page.mouse.move(sourceBox.x + 10, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 10, targetBox.y + Math.min(12, targetBox.height * 0.2), { steps: 12 });
  await expect(page.locator(".list-reorder-preview")).toBeVisible();
  await page.waitForTimeout(180);
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

async function dragConditionBefore(page, source, target) {
  const sourceElement = source.first();
  const targetElement = target.first();
  await sourceElement.scrollIntoViewIfNeeded();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Condition drag source or target is not visible");
  await page.mouse.move(sourceBox.x + 10, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 10, targetBox.y + Math.min(12, targetBox.height * 0.2), { steps: 12 });
  await expect(page.locator(".group-drag-preview")).toBeVisible();
  await page.waitForTimeout(180);
  await page.mouse.up();
}

async function dragConditionOutOfGroup(page, source) {
  const sourceElement = source.first();
  const root = page.locator("#conditionList");
  const sourceBox = await sourceElement.boundingBox();
  const rootBox = await root.boundingBox();
  if (!sourceBox || !rootBox) throw new Error("Condition group exit target is not visible");
  await page.mouse.move(sourceBox.x + 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rootBox.x + 4, rootBox.y + rootBox.height - 8, { steps: 14 });
  await expect(page.locator(".group-drag-preview")).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(120);
    const liveRootBox = await root.boundingBox();
    if (!liveRootBox) throw new Error("Condition group exit target disappeared");
    await page.mouse.move(
      liveRootBox.x + 4,
      liveRootBox.y + liveRootBox.height - 8,
      { steps: 4 },
    );
  }
  await expect(root.locator(":scope > .condition-row")).toHaveCount(1);
  await page.mouse.up();
}

async function groupConditionsByDwell(page, source, target) {
  const sourceElement = source.first();
  const targetElement = target.first();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Condition grouping source or target is not visible");
  await page.mouse.move(sourceBox.x + 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await expect(page.locator(".group-drag-preview")).toBeVisible();
  await page.waitForTimeout(620);
  const liveTargetBox = await targetElement.boundingBox();
  if (!liveTargetBox) throw new Error("Condition grouping target disappeared");
  await page.mouse.move(
    liveTargetBox.x + liveTargetBox.width / 2,
    liveTargetBox.y + Math.min(18, liveTargetBox.height / 2),
    { steps: 3 },
  );
  await expect(targetElement).toHaveClass(/is-group-ready/);
  await page.mouse.up();
}

async function dragListItemBeforeFromCenter(page, source, target, beforeDrop = null) {
  const sourceElement = source.first();
  const targetElement = target.first();
  await sourceElement.scrollIntoViewIfNeeded();
  const sourceBox = await sourceElement.boundingBox();
  const targetBox = await targetElement.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("List reorder source or target is not visible");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + Math.min(12, targetBox.height * 0.2), { steps: 12 });
  await expect(page.locator(".list-reorder-preview")).toBeVisible();
  await page.waitForTimeout(180);
  if (beforeDrop) await beforeDrop();
  await page.mouse.up();
}

async function dragWorkspaceTab(page, sourceTab, targetTab, position = "before", beforeDrop = null, grabRatio = 0.5) {
  const source = page.locator(`.tab[data-tab="${sourceTab}"]`);
  const target = page.locator(`.tab[data-tab="${targetTab}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Workspace tab geometry is unavailable");
  const grabOffset = sourceBox.width * grabRatio;
  const targetCenter = targetBox.x + targetBox.width / 2;
  const desiredPreviewCenter = targetCenter + (position === "before" ? -24 : 24);
  const pointerX = desiredPreviewCenter - sourceBox.width / 2 + grabOffset;
  await page.mouse.move(sourceBox.x + grabOffset, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pointerX,
    targetBox.y + targetBox.height / 2,
    { steps: 12 },
  );
  await expect(page.locator("#tabbar")).toHaveClass(/is-workspace-tab-reordering/);
  await expect(source).toHaveClass(/is-workspace-tab-dragging/);
  await expect(page.locator(".list-reorder-preview")).toHaveCount(0);
  if (beforeDrop) await beforeDrop({ pointerX, grabOffset });
  await page.waitForTimeout(180);
  await page.mouse.up();
}

async function sampleWorkspaceIndicatorOffsets(page, frameCount = 6) {
  return page.evaluate(async (count) => {
    const offsets = [];
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const indicator = document.querySelector("#tabFocusIndicator");
      const activeTab = document.querySelector("#tabbar .tab.active");
      if (!indicator || !activeTab) continue;
      const indicatorRect = indicator.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      offsets.push({
        left: indicatorRect.left - tabRect.left,
        right: indicatorRect.right - tabRect.right,
        top: indicatorRect.top - tabRect.top,
        bottom: indicatorRect.bottom - tabRect.bottom,
      });
    }
    return offsets;
  }, frameCount);
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

test("Event End up picker traverses three Node group levels and saves the stable Node ID", async ({ page }) => {
  const originalDetail = await (await page.request.get(`${editorUrl}/api/node?path=branch_lab`)).json();
  const originalEvent = originalDetail.events.find((entry) => entry.data.ID === "branch_random").data;
  const grouped = await page.request.put(`${editorUrl}/api/node-groups`, { data: { assignments: {
    outcome_success: ["章節", "區域", "場景"],
  } } });
  expect(grouped.ok()).toBe(true);

  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click({ force: true });
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="branch_random"]').click();
  await changeSelect(page, "EndUp", "GOTO");

  const select = page.locator('select[name="nextWeightedId"]').first();
  await expect(select.locator('option[value="outcome_success"]'))
    .toHaveAttribute("data-picker-path", /章節\/區域\/場景\//);
  const picker = select.locator("xpath=..");
  await picker.locator("[data-select-picker-toggle]").click();
  const firstFolder = picker.locator(":scope > .select-choice-menu > .select-choice-branch > [data-select-folder-toggle]").first();
  await expect(firstFolder).toBeFocused();
  expect(await firstFolder.evaluate((folder) => {
    const menu = folder.closest(".select-choice-menu").getBoundingClientRect();
    const rect = folder.getBoundingClientRect();
    return rect.top >= menu.top && rect.bottom <= menu.bottom;
  })).toBe(true);
  for (const name of ["章節", "區域", "場景"]) {
    await picker.getByRole("button", { name, exact: true }).click();
    const openSubmenu = picker.locator(".select-choice-submenu:popover-open").last();
    await expect(openSubmenu).toBeVisible();
    expect(await openSubmenu.evaluate((submenu) => {
      const rect = submenu.getBoundingClientRect();
      const surfaceRect = submenu.querySelector(":scope > .select-choice-submenu-scroll").getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 16, rect.top + 16);
      return rect.width > 0
        && rect.height > 0
        && (submenu.querySelector(":scope > .select-choice-submenu-scroll").children.length !== 1 || rect.height < 80)
        && Math.abs(rect.height - surfaceRect.height) < 1
        && Boolean(hit?.closest(".select-choice-submenu"));
    })).toBe(true);
  }
  const save = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await picker.locator('[data-select-value="outcome_success"]').click();
  await save;
  await expect(select).toHaveValue("outcome_success");

  const restored = await page.request.put(`${editorUrl}/api/node-groups`, { data: { assignments: {
    outcome_success: [],
  } } });
  expect(restored.ok()).toBe(true);
  const restoredEvent = await page.request.post(`${editorUrl}/api/events`, { data: {
    node: "branch_lab",
    originalId: originalEvent.ID,
    event: originalEvent,
  } });
  expect(restoredEvent.ok(), await restoredEvent.text()).toBe(true);
});

for (const endUp of ["GOTO", "REPLACE"]) {
  test(`${endUp} chances and weighted remove buttons match Event rule spacing`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const id = `next_chances_${endUp.toLowerCase()}`;
    expect((await page.request.post(`${editorUrl}/api/events`, { data: { node: "branch_lab", event: {
      ID: id, Name: id, Trigger: "Action:resolve_branch", Priority: 5, Weight: 1,
      Conditions: [{ type: "stat", id: "test_actions", op: ">=", value: 0, clause: null }],
      Effects: [{ type: "stat", id: "test_actions", op: "+", value: 1 }],
      Content: { test_branch_success: 1, test_branch_random: 1 },
      "End up": endUp, "Next Node": { outcome_success: 1, outcome_fallback: 3 },
    } } })).ok()).toBe(true);
    await page.goto(editorUrl);
    await openNodeSidebar(page);
    await page.locator('#nodeList [data-node-path="branch_lab"]').click();
    await page.getByRole("button", { name: /^事件 / }).click();
    await page.locator(`[data-event-id="${id}"]`).click();
    const nextRows = page.locator('[data-weighted-kind="next"]');
    await expect(nextRows.locator("[data-next-chance]")).toHaveText(["25%", "75%"]);
    await waitForEventSave(page, () => nextRows.first().locator('[name="nextWeightedValue"]').fill("3"));
    await expect(nextRows.locator("[data-next-chance]")).toHaveText(["50%", "50%"]);
    await waitForEventSave(page, () => nextRows.last().locator('[name="nextWeightedValue"]').fill("1"));
    await expect(nextRows.locator("[data-next-chance]")).toHaveText(["75%", "25%"]);
    await expect(page.locator("[data-content-chance]")).toHaveText(["50%", "50%"]);
    const hoverStyle = (button) => button.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.width, style.height, style.borderRadius, style.backgroundColor, style.borderColor];
    });
    const reference = page.locator(".condition-row > .row-button").first();
    await reference.hover();
    await expect.poll(() => hoverStyle(reference)).not.toContain("rgba(0, 0, 0, 0)");
    // Compare the settled hover, not an intermediate transition color.
    await reference.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const expected = await hoverStyle(reference);
    for (const selector of [".effect-row", '[data-weighted-kind="content"]', '[data-weighted-kind="next"]']) {
      const button = page.locator(`${selector} > .row-button`).first();
      await button.hover();
      await expect.poll(() => hoverStyle(button)).toEqual(expected);
    }
    for (const kind of ["content", "next"]) {
      const row = page.locator(`[data-weighted-kind="${kind}"]`).first();
      expect(await row.evaluate((element) => {
        const chance = element.querySelector("[data-content-chance], [data-next-chance]").getBoundingClientRect();
        const button = element.querySelector(".row-button").getBoundingClientRect();
        return Math.round(button.left - chance.right);
      })).toBe(8);
    }
    await nextRows.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("next-chances.png") });
    await reloadAndWaitForProject(page);
    await openNodeSidebar(page);
    await page.locator('#nodeList [data-node-path="branch_lab"]').click();
    await page.getByRole("button", { name: /^事件 / }).click();
    await page.locator(`[data-event-id="${id}"]`).click();
    await expect(nextRows.locator("[data-next-chance]")).toHaveText(["75%", "25%"]);
    await waitForEventSave(page, () => nextRows.last().locator("[data-remove-weighted]").click());
    await expect(nextRows.locator("[data-next-chance]")).toHaveText("100%");
    const saved = JSON.parse(fs.readFileSync(path.join(projectRoot, `game/SCENENODE/branch_lab/EVENTPOOL/${id}.json`), "utf8"));
    expect(saved["End up"]).toBe(endUp);
    expect(saved["Next Node"]).toEqual({ outcome_success: 3 });
    expect(saved.Version).toBeUndefined();
    // The suite shares its disposable project; do not leave extra graph edges.
    expect((await page.request.delete(`${editorUrl}/api/events?node=branch_lab&id=${id}`)).ok()).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("Content chances update with weights, removal and reload without changing the event format", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  expect((await page.request.post(`${editorUrl}/api/events`, { data: { node: "branch_lab", event: {
    ID: "content_chances", Name: "Content chances", Trigger: "Auto:Enter", Effects: [], Conditions: [],
    Content: { test_branch_success: 1, test_branch_random: 3 },
  } } })).ok()).toBe(true);
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="content_chances"]').click();
  const rows = page.locator(".content-weight-row");
  await expect(rows.locator("[data-content-chance]")).toHaveText(["25%", "75%"]);
  await waitForEventSave(page, () => rows.first().locator('[name="contentWeightedValue"]').fill("3"));
  await expect(rows.locator("[data-content-chance]")).toHaveText(["50%", "50%"]);
  await waitForEventSave(page, () => rows.last().locator("[data-remove-weighted]").click());
  await expect(rows.locator("[data-content-chance]")).toHaveText("100%");
  await waitForEventSave(page, () => page.getByRole("button", { name: "新增演出", exact: true }).click());
  await expect(rows.locator("[data-content-chance]")).toHaveText(["75%", "25%"]);
  await rows.last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("content-chances.png") });
  const alignment = await rows.first().evaluate((row) => {
    const weight = row.querySelector('[name="contentWeightedValue"]').getBoundingClientRect();
    const chance = row.querySelector('[data-content-chance]').getBoundingClientRect();
    return { delta: Math.abs(weight.top + weight.height / 2 - chance.top - chance.height / 2), gap: chance.left - weight.right };
  });
  expect(alignment.delta).toBeLessThan(1);
  expect(alignment.gap).toBeGreaterThanOrEqual(5);
  await reloadAndWaitForProject(page);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="content_chances"]').click();
  await expect(rows.locator("[data-content-chance]")).toHaveText(["75%", "25%"]);
  const saved = JSON.parse(fs.readFileSync(path.join(projectRoot, "game/SCENENODE/branch_lab/EVENTPOOL/content_chances.json"), "utf8"));
  expect(Object.values(saved.Content)).toEqual([3, 1]);
  expect(saved.Version).toBeUndefined();
  expect(errors).toEqual([]);
});

test("random Effect groups preserve weights, ordering, keyboard editing and reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const seeded = await page.request.post(`${editorUrl}/api/events`, { data: { node: "branch_lab", event: {
    ID: "random_browser", Name: "Random browser", Trigger: "Auto:Enter",
    Conditions: [], Effects: [
      { type: "stat", id: "test_actions", op: "+", value: 10 },
      { type: "memory", bank: "memory", id: "random_reward", op: "add" },
      { type: "stat", id: "test_actions", op: "+", value: 20 },
    ], Content: null,
  } } });
  expect(seeded.ok()).toBe(true);
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="random_browser"]').click();
  const list = page.locator("#effectList");
  await list.scrollIntoViewIfNeeded();
  await waitForEventSave(page, () => groupConditionsByDwell(page,
    list.locator(".effect-row").nth(0), list.locator(".effect-row").nth(1)));
  const group = list.locator(".effect-random-group");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".effect-row")).toHaveCount(2);
  await expect(group.locator("[data-effect-chance]")).toHaveText(["50%", "50%"]);
  await waitForEventSave(page, () => group.locator('[name="effectChoiceWeight"]').nth(1).fill("3"));
  await expect(group.locator("[data-effect-chance]")).toHaveText(["25%", "75%"]);
  await page.mouse.move(0, 0);
  await expect.poll(() => group.locator(".effect-row").first().evaluate((row) => getComputedStyle(row).borderColor)).toBe("rgba(0, 0, 0, 0)");
  await expect(group.locator(".rule-fields").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("random-effects.png"), fullPage: true });

  // Whole-group drag is atomic; it cannot nest in another group.
  await waitForEventSave(page, async () => {
    const header = await group.locator(".effect-random-header").boundingBox();
    const groupBox = await group.boundingBox();
    const loose = await list.locator(":scope > .effect-row").boundingBox();
    await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
    await page.mouse.down();
    await page.mouse.move(loose.x + 3, loose.y + loose.height - 3, { steps: 12 });
    await expect(page.locator(".group-drag-preview")).toBeVisible();
    await page.waitForTimeout(250);
    expect((await page.locator(".group-drag-preview").boundingBox()).height).toBeCloseTo(groupBox.height, 0);
    await page.mouse.up();
  });
  await expect(list.locator(":scope > .effect-row")).toHaveAttribute("data-effect-id", "0");
  await expect(group.locator("[data-effect-chance]")).toHaveText(["25%", "75%"]);

  // Remove the only loose row; every remaining item is grouped.
  await waitForEventSave(page, () => list.locator(":scope > .effect-row [data-remove-effect]").click());
  await waitForEventSave(page, async () => {
    const source = await group.locator(".effect-row").first().boundingBox();
    await page.mouse.move(source.x + 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + 3, source.y + source.height + 8, { steps: 6 });
    await expect(page.locator(".group-drag-preview")).toBeVisible();
    for (let step = 0; step < 3; step += 1) {
      const tail = await list.locator(".effect-drop-tail").boundingBox();
      await page.mouse.move(tail.x + 4, tail.y + tail.height / 2, { steps: 4 });
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
  });
  await expect(group.locator(".effect-row")).toHaveCount(1);
  await expect(group.locator("[data-effect-chance]")).toHaveText("100%");
  await expect(list.locator(":scope > .effect-row")).toHaveCount(1);

  await reloadAndWaitForProject(page);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="random_browser"]').click();
  await expect(group.locator("[data-effect-chance]")).toHaveText("100%");
  await expect(group.locator('[name="effectChoiceWeight"]')).toHaveValue("3");
  await group.locator('[name="effectChoiceWeight"]').focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-event-section="effects"]')).toBeFocused();
  await waitForEventSave(page, () => page.keyboard.press("Meta+Enter"));
  await expect(list.locator(":scope > .effect-row")).toHaveCount(2);
  await expect(list.locator(":scope > .effect-row").last().locator(".select-choice-trigger").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(list.locator(":scope > .effect-row").last().locator('[name="effectId"]').locator("xpath=..").locator(".select-choice-trigger")).toBeFocused();

  // The final child removes the empty container, but does not downgrade Version 3.
  await waitForEventSave(page, () => group.locator("[data-remove-effect]").click());
  await expect(group).toHaveCount(0);
  const saved = JSON.parse(fs.readFileSync(path.join(projectRoot, "game/SCENENODE/branch_lab/EVENTPOOL/random_browser.json"), "utf8"));
  expect(saved.Version).toBe(3);
  expect(saved.Effects.every((effect) => effect.type !== "random")).toBe(true);
  await page.locator('[data-event-section="effects"]').focus();
  const undoResponse = page.waitForResponse((response) => response.url().endsWith("/api/undo") && response.ok());
  await page.keyboard.press("Meta+z");
  await undoResponse;
  await expect(group.locator("[data-effect-chance]")).toHaveText("100%");
  await expect(group.locator('[name="effectChoiceWeight"]')).toHaveValue("3");
  await waitForEventSave(page, () => changeSelect(group.locator(".effect-row"), "effectType", "stat"));
  await expect(group.locator('[name="effectType"]')).toHaveValue("stat");
  await expect(group.locator('[name="effectChoiceWeight"]')).toHaveValue("3");
  await list.scrollIntoViewIfNeeded();
  const joinTargetId = await group.locator(".effect-row").first().getAttribute("data-effect-id");
  await waitForEventSave(page, () => groupConditionsByDwell(page,
    list.locator(":scope > .effect-row").first(), list.locator(`[data-effect-id="${joinTargetId}"]`)));
  await expect(group.locator(".effect-row")).toHaveCount(2);
  const weightsBefore = await group.locator('[name="effectChoiceWeight"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  await waitForEventSave(page, () => dragConditionBefore(page,
    group.locator(".effect-row").nth(1), group.locator(".effect-row").nth(0)));
  await expect(group.locator(".effect-row")).toHaveCount(2);
  expect(await group.locator('[name="effectChoiceWeight"]').evaluateAll((inputs) => inputs.map((input) => input.value))).toEqual(weightsBefore.reverse());
  expect(errors).toEqual([]);
});

test("numeric expressions author through shared pickers and persist across reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const seeded = await page.request.post(`${editorUrl}/api/events`, { data: { node: "branch_lab", event: {
    ID: "arithmetic_browser", Name: "Arithmetic browser", Trigger: "Auto:Enter",
    Conditions: [{ type: "stat", id: "test_actions", op: ">=", value: 1 }],
    Effects: [{ type: "stat", id: "test_actions", op: "+", value: 1 }],
  } } });
  expect(seeded.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.locator('.tab[data-tab="events"]').click();
  await page.locator('[data-event-id="arithmetic_browser"]').click();

  const picker = (name) => page.locator(`#eventForm select[name="${name}"]`).locator("xpath=..").getByRole("combobox");
  async function selectMode(name, label) {
    await picker(name).click();
    await waitForEventSave(page, () => page.getByRole("option", { name: label, exact: true }).click());
    await expect(picker(name)).toBeFocused();
  }
  await selectMode("conditionValueSource", "簡單運算");
  await expect(picker("conditionValueSource")).toHaveValue("ƒx");
  await expect(picker("conditionValueSource")).toHaveAttribute("title", "簡單運算");
  await selectMode("conditionValueLeftSource", "Stat");
  await waitForEventSave(page, () => page.locator('[name="conditionValueRight"]').fill("2"));
  await selectMode("conditionIdSource", "簡單運算");
  await waitForEventSave(page, () => page.locator('[name="conditionIdRight"]').fill("3"));
  await picker("effectValueSource").click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await waitForEventSave(page, () => page.keyboard.press("Enter"));
  await expect(page.locator('[name="effectValueSource"]')).toHaveValue("calc");
  await selectMode("effectValueLeftSource", "Stat");
  await waitForEventSave(page, () => changeSelect(page, "effectValueOperator", "*"));
  await waitForEventSave(page, () => page.locator('[name="effectValueRight"]').fill("4"));
  await expect(page.locator('[name="effectValueLeftSource"] option[value="calc"]')).toHaveCount(0);
  for (const width of [1440, 1280, 1024, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.locator(".numeric-stat-row").evaluateAll((rows) => rows.map((row) => {
      const fields = row.querySelector(".rule-fields");
      const controls = [...row.querySelectorAll('input:not([hidden]), .row-button')];
      const centers = controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return rect.y + rect.height / 2;
      });
      return {
        centerSpread: Math.max(...centers) - Math.min(...centers),
        horizontalOverflow: fields.scrollWidth - fields.clientWidth,
        scrollable: getComputedStyle(fields).overflowX === "auto",
      };
    }));
    expect(geometry.every((row) => row.centerSpread <= 1), JSON.stringify({ width, geometry })).toBe(true);
    if (width >= 1280) expect(geometry.every((row) => row.horizontalOverflow <= 1), JSON.stringify({ width, geometry })).toBe(true);
    else expect(geometry.every((row) => row.scrollable)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  // The last operand remains editable via keyboard/scrolling in the single-line narrow row.
  await picker("conditionValueRightSource").click();
  const constantChoice = page.getByRole("option", { name: "固定值", exact: true });
  await expect(constantChoice).toBeVisible();
  expect((await constantChoice.boundingBox())?.height).toBe(38);
  await page.keyboard.press("Escape");
  await expect(picker("conditionValueRightSource")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('[name="conditionValueRight"]')).toBeFocused();
  const focusedBounds = await page.locator('[name="conditionValueRight"]').boundingBox();
  expect(focusedBounds.x).toBeGreaterThanOrEqual(0);
  expect(focusedBounds.x + focusedBounds.width).toBeLessThanOrEqual(760);
  await waitForEventSave(page, () => page.locator('[name="conditionValueRight"]').fill("5"));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await reloadAndWaitForProject(page);
  await page.locator('.tab[data-tab="events"]').click();
  await page.locator('[data-event-id="arithmetic_browser"]').click();
  await expect(page.locator('[name="conditionValueSource"]')).toHaveValue("calc");
  await expect(page.locator('[name="conditionIdRight"]')).toHaveValue("3");
  await expect(page.locator('[name="effectValueRight"]')).toHaveValue("4");
  const detail = await (await page.request.get(`${editorUrl}/api/node?path=branch_lab`)).json();
  const saved = detail.events.find((entry) => entry.data.ID === "arithmetic_browser").data;
  expect(saved.Version).toBe(2);
  expect(saved.Conditions[0].left.right).toBe(3);
  expect(saved.Conditions[0].value.right).toBe(5);
  expect(saved.Effects[0].value.op).toBe("*");
  expect(saved.Effects[0].value.left.type).toBe("stat");
  expect(saved.Conditions[0].clause).toBe("and_1");
  expect(errors).toEqual([]);
  const removed = await page.request.delete(`${editorUrl}/api/events?node=branch_lab&id=arithmetic_browser`);
  expect(removed.ok()).toBe(true);
});

test("type badges fit every rule and reversibly cover only their own fields", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const seeded = await page.request.post(`${editorUrl}/api/events`, { data: { node: "options_lab", event: {
    ID: "badge_browser", Name: "Badge browser", Trigger: "Auto:Enter",
    Conditions: [
      { type: "stat", id: "test_actions", op: ">=", value: 1 },
      { type: "memory", bank: "test_session", id: "branch_unlocked", op: "has" },
    ],
    Effects: [
      { type: "stat", id: "test_actions", op: "+", value: 1 },
      { type: "memory", bank: "memory", id: "badge_tag", op: "add" },
      { type: "option", op: "enable", target: "item", node: "options_lab", element: "data_actions", item: "controlled_bonus" },
    ],
  } } });
  expect(seeded.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.locator('.tab[data-tab="events"]').click();
  await page.locator('[data-event-id="badge_browser"]').click();
  // Geometry assertions must run after the existing workspace entrance scale.
  await expect.poll(() => page.locator("#eventForm").evaluate((form) => {
    for (let element = form; element; element = element.parentElement) {
      if (element.getAnimations().some((animation) => animation.playState === "running")) return false;
    }
    return true;
  })).toBe(true);
  for (const collection of ["#conditionList", "#effectList"]) {
    const geometry = await page.locator(`${collection} .rule-fields`).evaluateAll((scopes) => scopes.map((scope) => {
      const rect = scope.getBoundingClientRect();
      const badge = scope.querySelector(":scope > .type-badge input").getBoundingClientRect();
      const blocks = [...scope.children].filter((element) => element.matches(".field, .numeric-field"));
      const blockRects = blocks.map((element) => element.getBoundingClientRect());
      return {
        x: rect.x, width: rect.width, height: rect.height,
        badgeInset: badge.x - rect.x, badgeTop: badge.y - rect.y,
        badgeBottom: rect.bottom - badge.bottom,
        scopeBorder: getComputedStyle(scope).borderTopWidth,
        blockHeights: blockRects.map((block) => block.height),
        blockGaps: blockRects.slice(1).map((block, index) => block.left - blockRects[index].right),
        blockBorders: blocks.map((block) => {
          const surface = block.matches(".numeric-field")
            ? block
            : block.querySelector(":scope > input:not([hidden]), :scope > .select-choice-picker > input");
          return getComputedStyle(surface).borderTopWidth;
        }),
      };
    }));
    expect(new Set(geometry.map((item) => item.width)).size).toBe(1);
    expect(new Set(geometry.map((item) => item.x)).size).toBe(1);
    for (const item of geometry) {
      expect(item.height).toBe(38);
      expect(item.badgeInset).toBe(0);
      expect(item.badgeTop).toBe(0);
      expect(item.badgeBottom).toBe(0);
      expect(item.scopeBorder).toBe("0px");
      expect(item.blockHeights.every((height) => height === 38), JSON.stringify(item)).toBe(true);
      expect(item.blockGaps.every((gap) => gap >= 5), JSON.stringify(item)).toBe(true);
      expect(item.blockBorders.every((border) => border === "1px"), JSON.stringify(item)).toBe(true);
    }
  }
  const row = page.locator('[data-badge-row="condition-0"]');
  const shell = row.locator(".rule-fields");
  const type = row.getByRole("combobox", { name: "條件類型", exact: true });
  const extent = (scope) => scope.evaluate((el) => el.querySelector(":scope > .type-badge-cover").getBoundingClientRect().width);
  const closed = await extent(shell);
  const shellBox = await shell.boundingBox();
  await type.click();
  await expect.poll(() => extent(shell)).toBeCloseTo(shellBox.width, 0);
  expect(await shell.boundingBox()).toEqual(shellBox); // Cover never moves its anchor or neighbours.
  const choices = page.getByRole("listbox", { name: "條件類型", exact: true });
  expect((await choices.boundingBox()).height).toBe(96);
  await page.getByRole("option", { name: "Memory", exact: true }).click();
  await expect(row.locator('[name="conditionType"]')).toHaveValue("memory");
  // The new DOM resumes contraction instead of instantly losing the expanded cover.
  expect(await shell.locator(":scope > .type-badge-cover").evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
  await expect.poll(() => extent(shell)).toBe(closed);
  await expect(type).toBeFocused();
  await waitForEventSave(page, () => row.locator('[name="conditionId"]').fill("badge_saved"));

  // Return via keyboard, then test nested source scopes and interrupted cancellation.
  await type.click();
  await page.keyboard.press("Home");
  await waitForEventSave(page, () => page.keyboard.press("Enter"));
  const source = row.getByRole("combobox", { name: "比較右值 數值來源", exact: true });
  await source.click();
  await waitForEventSave(page, () => page.getByRole("option", { name: "簡單運算", exact: true }).click());
  const operand = row.locator('[data-numeric-field="conditionValueLeft"]');
  const parent = row.locator('[data-numeric-field="conditionValue"]');
  const operandSource = operand.getByRole("combobox", { name: "左運算元 數值來源", exact: true });
  await operandSource.click();
  await expect.poll(() => extent(operand)).toBeCloseTo((await operand.boundingBox()).width - 2, 0);
  expect(await extent(parent)).toBe(32);
  await page.keyboard.press("Escape");
  await operandSource.click();
  await page.keyboard.press("Escape");
  await expect.poll(() => extent(operand)).toBe(32);
  await expect(operandSource).toBeFocused();
  await expect(page.locator(".type-badge-open")).toHaveCount(0);

  // A click outside cancels, and reduced motion keeps the same final state without travel.
  await source.click();
  await page.getByRole("heading", { name: "Conditions", exact: true }).click();
  await expect.poll(() => extent(parent)).toBe(32);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await source.click();
  expect(await parent.locator(":scope > .type-badge-cover").evaluate((el) => el.getAnimations().length)).toBe(0);
  await page.keyboard.press("Escape");
  expect(await extent(parent)).toBe(32);

  const effect = page.locator('[data-badge-row="effect-0"]');
  await effect.getByRole("combobox", { name: "效果類型", exact: true }).click();
  await waitForEventSave(page, () => page.getByRole("option", { name: "Option", exact: true }).click());
  await expect(effect.locator('[name="effectOptionTarget"]')).toHaveCount(1);
  await expect(effect.locator('[name="effectValue"]')).toHaveCount(0);
  await reloadAndWaitForProject(page);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.locator('.tab[data-tab="events"]').click();
  await page.locator('[data-event-id="badge_browser"]').click();
  await expect(row.locator('[name="conditionValueSource"]')).toHaveValue("calc");
  await expect(effect.locator('[name="effectType"]')).toHaveValue("option");
  await expect(page.locator(".type-badge-open")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect((await page.request.delete(`${editorUrl}/api/events?node=options_lab&id=badge_browser`)).ok()).toBe(true);
});

test("choice picker focuses long menus without scrolling the surrounding row", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator("#saveState")).toHaveText("已同步");
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.id = "inlinePickerScrollFixture";
    scroller.style.cssText = "position:fixed;inset:100px auto auto 100px;width:220px;height:80px;overflow:auto;z-index:400;";
    scroller.innerHTML = `<label style="display:block;width:600px"><select aria-label="Long inline picker">${Array.from({ length: 20 }, (_, index) => `<option value="${index}">Entry ${index}</option>`).join("")}</select></label>`;
    document.body.append(scroller);
  });
  const fixture = page.locator("#inlinePickerScrollFixture");
  const trigger = fixture.getByRole("combobox");
  await trigger.click({ position: { x: 30, y: 18 } });
  const menu = fixture.locator(".select-choice-menu");
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Entry 19", exact: true })).toBeFocused();
  expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await fixture.evaluate((element) => element.scrollLeft)).toBe(0);
  await page.keyboard.press("Home");
  await expect(page.getByRole("option", { name: "Entry 0", exact: true })).toBeFocused();
  // Queued scroll notifications with an unchanged anchor must not dismiss a fresh menu.
  await fixture.evaluate((element) => element.dispatchEvent(new Event("scroll")));
  await expect(menu).toBeVisible();
  // A real scroll that moves the anchor still closes it, avoiding a detached floating menu.
  await fixture.evaluate((element) => { element.scrollLeft = 40; });
  await expect(menu).not.toBeVisible();
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
  await expect(page.locator("#projectName")).toHaveText(path.basename(projectRoot));
  await expect(page.locator("#projectGraphSvg")).toHaveCount(0);

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

  const contentPickerRoot = page.locator('[name="contentWeightedId"]').first().locator("xpath=..");
  const contentPicker = contentPickerRoot.locator("[data-select-picker-toggle]");
  await expect(contentPicker).toBeVisible();
  await contentPicker.scrollIntoViewIfNeeded();
  await contentPicker.click();
  await expect(contentPickerRoot.locator(".select-choice-menu")).toBeVisible();
  const contentFileBranch = contentPickerRoot.locator("[data-select-folder-toggle]");
  await expect(contentFileBranch).toHaveCount(1);
  await contentFileBranch.click();
  const contentLabelChoice = contentPickerRoot.locator('[data-select-value="test_branch_success"]');
  await expect(contentLabelChoice).toBeVisible();
  const contentSubmenuGeometry = await contentPickerRoot.evaluate((picker) => {
    const menu = picker.querySelector(".select-choice-menu").getBoundingClientRect();
    const submenu = picker.querySelector(".select-choice-submenu").getBoundingClientRect();
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
  await changeSelect(condition, "conditionOp", "empty");
  await expect(condition.locator('input[name="conditionId"]')).toBeDisabled();
  await expect(condition.locator('input[name="conditionId"]')).toHaveAttribute("placeholder", "判斷整個記憶庫");
  await changeSelect(condition, "conditionOp", "not_empty");
  await expect(condition.locator('input[name="conditionId"]')).toBeDisabled();
  await changeSelect(condition, "conditionOp", "has");
  await expect(condition.locator('input[name="conditionId"]')).toBeEnabled();
  await expect(condition.locator('input[name="conditionId"]')).toHaveValue("新標籤");
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
    await page.locator('[data-remove-weighted^="content:"]').click();
  });
  await expect(page.locator('[data-remove-weighted^="content:"]')).toHaveCount(0);
  await expect(page.locator(".toast.error")).toHaveCount(0);
  await waitForEventSave(page, async () => {
    await changeSelect(page, "EndUp", "GOTO");
  });
  const refreshedGraphTarget = await page.locator('select[name="nextWeightedId"]').inputValue();
  const graphRefreshResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/graph")
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
  await page.getByRole("button", { name: "節點", exact: true }).click();
  const nodeWorkspaceGeometry = await page.locator("#nodePanel").evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect();
    const shellRect = panel.querySelector(".node-editor-shell").getBoundingClientRect();
    return {
      left: shellRect.left - panelRect.left,
      right: panelRect.right - shellRect.right,
      top: shellRect.top - panelRect.top,
    };
  });
  expect(Math.abs(nodeWorkspaceGeometry.left)).toBeLessThan(1);
  expect(Math.abs(nodeWorkspaceGeometry.right)).toBeLessThan(1);
  expect(Math.abs(nodeWorkspaceGeometry.top)).toBeLessThan(1);
  const defaultMemoryTags = page.locator('.node-memory-bank:has-text("Memory")');
  await expect(page.locator(".node-memory-card > header strong")).toHaveText("Registered Tags");
  await expect(defaultMemoryTags.locator(".node-memory-tag", { hasText: "test_key" })).toBeVisible();
  const sessionMemoryTags = page.locator('.node-memory-bank:has-text("測試階段記憶")');
  await expect(sessionMemoryTags.locator("header small")).toHaveCount(0);
  await expect(sessionMemoryTags).not.toContainText("test_session");
  await expect(sessionMemoryTags.locator(".node-memory-tag", { hasText: "hitbox_clicked" })).toBeVisible();

  await page.getByRole("button", { name: "選項", exact: true }).click();
  await page.getByRole("button", { name: /DATA Options 綜合測試/ }).click();
  const availability = page.locator('select[data-option-path="Availability"]');
  await expect(availability).toHaveValue("ALWAYS");
  const availabilityPicker = availability.locator("xpath=..");
  const availabilityTrigger = availabilityPicker.locator("[data-select-picker-toggle]");
  await availabilityTrigger.click();
  const optionPickerPresentation = await availabilityPicker.evaluate((picker) => {
    const triggerStyle = getComputedStyle(picker.querySelector("[data-select-picker-toggle]"));
    const optionStyle = getComputedStyle(picker.querySelector(".select-choice-option"));
    const menuRect = picker.querySelector(".select-choice-menu").getBoundingClientRect();
    return {
      triggerFontSize: triggerStyle.fontSize,
      triggerFontWeight: triggerStyle.fontWeight,
      triggerLetterSpacing: triggerStyle.letterSpacing,
      optionFontSize: optionStyle.fontSize,
      optionFontWeight: optionStyle.fontWeight,
      optionLetterSpacing: optionStyle.letterSpacing,
      menuWidth: menuRect.width,
      menuHeight: menuRect.height,
    };
  });
  expect(optionPickerPresentation).toMatchObject({
    triggerFontSize: "12px",
    triggerFontWeight: "680",
    triggerLetterSpacing: "normal",
    optionFontSize: "12px",
    optionFontWeight: "620",
    optionLetterSpacing: "normal",
  });
  expect(optionPickerPresentation.menuWidth).toBeLessThanOrEqual(242);
  expect(optionPickerPresentation.menuHeight).toBeLessThanOrEqual(322);
  const availabilityValues = await availability.locator("option").evaluateAll((options) => options.map((option) => option.value));
  const selectedAvailabilityIndex = availabilityValues.indexOf("ALWAYS");
  const nextAvailability = availabilityValues[(selectedAvailabilityIndex + 1) % availabilityValues.length];
  await page.keyboard.press("ArrowDown");
  const nextAvailabilityChoice = availabilityPicker.locator(`[data-select-value="${nextAvailability}"]`);
  await expect(nextAvailabilityChoice).toBeFocused();
  await expect(nextAvailabilityChoice).toHaveClass(/is-picker-active/);
  await page.keyboard.press("ArrowUp");
  await expect(availabilityPicker.locator('[data-select-value="ALWAYS"]')).toBeFocused();
  await page.keyboard.press("Escape");
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

test("Node overview keeps the Memory card on the shared section rhythm", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.locator("#saveState")).toHaveText(/^(已同步|已自動儲存|Synced|Autosaved)$/);
  await page.locator('[data-tab="node"]').click();
  await expect(page.locator(".node-overview")).toBeVisible();

  const nodeOverviewGaps = await page.locator(".node-overview").evaluate((overview) => {
    const metrics = overview.querySelector(".node-overview-metrics").getBoundingClientRect();
    const details = overview.querySelector(".node-overview-details");
    const upperCards = [...details.querySelectorAll(":scope > .node-overview-card:not(.node-memory-card)")]
      .map((card) => card.getBoundingClientRect());
    const memory = details.querySelector(".node-memory-card").getBoundingClientRect();
    return {
      section: Math.min(...upperCards.map((card) => card.top)) - metrics.bottom,
      memory: memory.top - Math.max(...upperCards.map((card) => card.bottom)),
    };
  });

  expect(nodeOverviewGaps.section).toBeGreaterThan(0);
  expect(Math.abs(nodeOverviewGaps.memory - nodeOverviewGaps.section)).toBeLessThan(1);
});

test("Node workspace keeps its frame fixed while its content scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 720 });
  await page.goto(editorUrl);
  await expect(page.locator("#saveState")).toHaveText(/^(已同步|已自動儲存|Synced|Autosaved)$/);
  await page.locator('[data-tab="node"]').click();

  const panel = page.locator("#nodePanel");
  const shell = panel.locator(".node-editor-shell");
  await expect(shell).toBeVisible();

  const before = await panel.evaluate((nodePanel) => {
    const nodeShell = nodePanel.querySelector(".node-editor-shell");
    const shellRect = nodeShell.getBoundingClientRect();
    const markerRect = nodeShell.querySelector(".node-root-row").getBoundingClientRect();
    return {
      panelScrollTop: nodePanel.scrollTop,
      shellTop: shellRect.top,
      shellBottom: shellRect.bottom,
      markerTop: markerRect.top,
      shellClientHeight: nodeShell.clientHeight,
      shellScrollHeight: nodeShell.scrollHeight,
    };
  });
  expect(before.shellScrollHeight).toBeGreaterThan(before.shellClientHeight);

  await shell.evaluate((nodeShell) => {
    nodeShell.scrollTop = nodeShell.scrollHeight;
  });

  const after = await panel.evaluate((nodePanel) => {
    const nodeShell = nodePanel.querySelector(".node-editor-shell");
    const shellRect = nodeShell.getBoundingClientRect();
    const markerRect = nodeShell.querySelector(".node-root-row").getBoundingClientRect();
    return {
      panelScrollTop: nodePanel.scrollTop,
      shellTop: shellRect.top,
      shellBottom: shellRect.bottom,
      markerTop: markerRect.top,
      shellScrollTop: nodeShell.scrollTop,
    };
  });

  expect(after.panelScrollTop).toBe(0);
  expect(after.shellScrollTop).toBeGreaterThan(0);
  expect(Math.abs(after.shellTop - before.shellTop)).toBeLessThan(1);
  expect(Math.abs(after.shellBottom - before.shellBottom)).toBeLessThan(1);
  expect(after.markerTop).toBeLessThan(before.markerTop);
});

test("Event Memory Tag fields provide project-wide prefix suggestions", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await expect(page.locator("#nodePath")).toContainText("options_lab");
  await page.locator('[data-tab="events"]').click();
  await page.locator('[data-event-id="use_key"]').click();

  const memoryTagInput = page.locator('.condition-row[data-condition-type="memory"] [name="conditionId"]');
  await memoryTagInput.fill("test");
  const prefixMenu = page.locator(".prefix-choice-menu:visible");
  const prefixChoice = prefixMenu.locator('[data-prefix-value="test_key"]');
  await expect(prefixChoice).toBeVisible();
  const prefixPresentation = await prefixMenu.evaluate((menu) => {
    const option = menu.querySelector(".select-choice-option");
    const menuRect = menu.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const optionStyle = getComputedStyle(option);
    return {
      menuWidth: menuRect.width,
      optionHeight: optionRect.height,
      optionFontSize: optionStyle.fontSize,
      optionFontWeight: optionStyle.fontWeight,
    };
  });
  expect(prefixPresentation).toEqual({
    menuWidth: 240,
    optionHeight: 38,
    optionFontSize: "12px",
    optionFontWeight: "620",
  });
  await prefixChoice.click();
  await expect(memoryTagInput).toHaveValue("test_key");

  await memoryTagInput.fill("tes");
  await expect(prefixMenu).toBeVisible();
  await expect(memoryTagInput).toBeFocused();
  await expect(memoryTagInput.locator("xpath=..")).toHaveClass(/open/);
  await memoryTagInput.press("Escape");
  await expect(prefixMenu).toBeHidden();
  await expect(memoryTagInput).toBeFocused();
  await memoryTagInput.press("ArrowDown");
  await expect(prefixMenu).toBeVisible();
  await memoryTagInput.press("Enter");
  await expect(memoryTagInput).toHaveValue("test_key");

  const hitboxEvent = page.locator('[data-event-id="hitbox_mark"]');
  await hitboxEvent.click();
  await expect(hitboxEvent).toHaveClass(/active/);
  await expect(page.locator('.effect-row[data-effect-type="memory"] [name="effectBank"]')).toHaveValue("test_session");
  const sessionTagInput = page.locator('.effect-row[data-effect-type="memory"] [name="effectId"]');
  await sessionTagInput.fill("hit");
  const sessionPrefixMenu = page.locator(".prefix-choice-menu:visible");
  const sessionTagChoice = sessionPrefixMenu.locator('[data-prefix-value="hitbox_clicked"]');
  await expect(sessionTagChoice).toBeVisible();
  await expect(sessionPrefixMenu.locator('[data-prefix-value="test_key"]')).toHaveCount(0);
  await sessionTagChoice.click();
  await expect(sessionTagInput).toHaveValue("hitbox_clicked");
});

test("Stats use the same dwell grouping, rollback, and singleton dissolution", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1600 });
  await page.goto(editorUrl);
  await page.getByRole("button", { name: "狀態", exact: true }).click();

  const setupResult = await page.evaluate(async () => {
    const projectResponse = await fetch("/api/project");
    const project = await projectResponse.json();
    Object.values(project.stats).forEach((stat) => {
      if (stat.Group !== "流程追蹤") stat.Group = "測試資源";
    });
    const response = await fetch("/api/stats", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats: project.stats }),
    });
    return { ok: response.ok, status: response.status };
  });
  expect(setupResult).toEqual({ ok: true, status: 200 });
  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: "狀態", exact: true }).click();
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

  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const handle = newGroup.locator(".stat-group-drag-space");
    const box = await handle.boundingBox();
    if (!box) throw new Error("Stat group drag handle geometry is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
    const preview = page.locator(".group-drag-preview.is-group-block-preview");
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((wrapper) => {
      const clip = wrapper.getBoundingClientRect();
      const card = wrapper.firstElementChild;
      const frame = card.getBoundingClientRect();
      return {
        left: Math.abs(frame.left - clip.left),
        right: Math.abs(frame.right - clip.right),
        bottom: Math.abs(frame.bottom - clip.bottom),
        itemsVisibility: getComputedStyle(card.querySelector(".stat-group-items")).visibility,
      };
    })).toEqual({ left: 0, right: 0, bottom: 0, itemsVisibility: "hidden" });
    await page.screenshot({ path: test.info().outputPath(`floating-stat-group-${reduced}.png`) });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

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
  await expect(resourcesGroup.locator(`.stat-row[data-stat-id="${sourceId}"]`)).toHaveCount(0);
  await expect(page.locator(`#statsGroups > .stat-row[data-stat-id="${sourceId}"]`)).toBeVisible();
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
    candidate.url().endsWith("/api/graph")
    && candidate.request().method() === "GET"
    && candidate.ok()
  ));
  await page.getByRole("button", { name: "關聯圖", exact: true }).click();
  await graphRefreshResponse;
  await expect(page.locator(".graph-node-name", { hasText: "即時更新節點" })).toHaveCount(1);
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-layout-source", /^(worker|cache)$/);
  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-edge-crossings", /^\d+$/);
  await expect.poll(() => page.evaluate(() => window.__graphRefreshDidNotReload)).toBe(true);

  await expect(page.locator("#projectGraphSvg")).toHaveAttribute("data-animation-active", "true");
  await page.getByRole("button", { name: "節點", exact: true }).click();
  await expect(page.locator("#projectGraphSvg")).toHaveCount(0);
});

test("Event groups form through dwell-drag and retain one remaining item", async ({ page }) => {
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
  await dragWithDwell(page, savedEvent, backEvent, 520, async () => {
    await expect(backEvent).toHaveClass(/is-group-ready/);
    await expectGroupReservation(backEvent);
    await expect(page.locator(".group-drag-preview")).toBeVisible();
    await expect.poll(() => backEvent.evaluate((item) => Number.parseFloat(getComputedStyle(item).marginBottom)))
      .toBeGreaterThan(40);
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
  const newGroup = page.locator('[data-group-label="新群組"]');
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
  const renamedGroup = page.locator('[data-group-label="主線流程"]');
  await expect(renamedGroup).toBeVisible();
  await expect(renamedGroup.locator("button")).toHaveCount(2);
  const eventSidebarGaps = await page.locator(".event-pool-flow").evaluate((flow) => {
    const children = [...flow.children].filter((child) => (
      child.matches(".event-group, [data-group-item-id]")
    ));
    return children.slice(1).map((child, index) => {
      const previous = children[index].getBoundingClientRect();
      const current = child.getBoundingClientRect();
      return current.top - previous.bottom;
    });
  });
  expect(eventSidebarGaps.length).toBeGreaterThan(0);
  expect(eventSidebarGaps.every((gap) => Math.abs(gap - 8) < 1)).toBe(true);
  await expect(renamedGroup).toHaveClass(/is-group-editing/);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  const looseEventBeforeGroup = page.locator(".event-pool-flow > [data-group-item-id]").first();
  await expect(looseEventBeforeGroup).toBeVisible();
  await looseEventBeforeGroup.click();
  await expect(renamedGroup).toHaveClass(/is-group-selection-collapsing/);
  const collapsingGroupHeader = await renamedGroup.locator(".event-group-header").boundingBox();
  if (!collapsingGroupHeader) throw new Error("Collapsing Event group header is not visible");
  await page.mouse.move(
    collapsingGroupHeader.x + collapsingGroupHeader.width / 2,
    collapsingGroupHeader.y + collapsingGroupHeader.height / 2,
  );
  const eventCollapseHeights = await renamedGroup.evaluate(async (group) => {
    const shell = group.querySelector(".event-group-items-shell");
    const heights = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      heights.push(shell.getBoundingClientRect().height);
    }
    return heights;
  });
  expect(eventCollapseHeights[0] - eventCollapseHeights.at(-1)).toBeGreaterThan(1);
  expect(eventCollapseHeights.some((height) => height > 2 && height < eventCollapseHeights[0] - 1)).toBe(true);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeLessThan(2);
  await expect(renamedGroup).toHaveClass(/is-group-selection-collapsing/);
  await page.locator('#eventForm [name="Name"]').click();
  await page.mouse.move(1000, 700);
  await expect(renamedGroup).not.toHaveClass(/is-group-selection-collapsing/);
  await expect(renamedGroup).not.toHaveClass(/is-group-editing/);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeLessThan(2);
  const groupHeaderBox = await renamedGroup.locator(".event-group-header").boundingBox();
  if (!groupHeaderBox) throw new Error("Event group header is not visible");
  await page.mouse.move(groupHeaderBox.x + groupHeaderBox.width / 2, groupHeaderBox.y + groupHeaderBox.height / 2);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  await renamedGroup.locator("[data-event-id]").first().click();
  await page.locator('#eventForm [name="Name"]').click();
  await expect(renamedGroup).toHaveClass(/is-group-editing/);
  await expect.poll(() => renamedGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  const reorderInsideGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  const groupItemIds = await page.locator('[data-group-label="主線流程"] [data-group-item-id]').evaluateAll((items) => (
    items.map((item) => item.dataset.groupItemId)
  ));
  await dispatchImmediateDrag(
    page,
    `[data-group-label="主線流程"] [data-group-item-id="${groupItemIds[1]}"]`,
    `[data-group-label="主線流程"] [data-group-item-id="${groupItemIds[0]}"]`,
  );
  await reorderInsideGroupResponse;
  await expect(page.locator('[data-group-label="主線流程"]')).toHaveClass(/is-group-pinned-open/);
  await expect.poll(() => page.locator('[data-group-label="主線流程"] .event-group-items-shell').evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  const expandedGroupHeight = await page.locator('[data-group-label="主線流程"] .event-group-items-shell').evaluate((shell) => (
    shell.getBoundingClientRect().height
  ));
  const groupDragSpace = page.locator('[data-group-label="主線流程"] .event-group-drag-space');
  const groupDragSpaceBox = await groupDragSpace.boundingBox();
  if (!groupDragSpaceBox) throw new Error("Event group drag space is not visible");
  await page.mouse.move(groupDragSpaceBox.x + groupDragSpaceBox.width / 2, groupDragSpaceBox.y + groupDragSpaceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(groupDragSpaceBox.x + groupDragSpaceBox.width / 2 + 12, groupDragSpaceBox.y + groupDragSpaceBox.height / 2, { steps: 1 });
  const groupPreview = page.locator(".group-drag-preview.is-group-block-preview");
  await expect(groupPreview).toBeVisible();
  await page.waitForTimeout(45);
  const shrinkingHeight = await groupPreview.boundingBox().then((box) => box?.height || 0);
  expect(shrinkingHeight).toBeGreaterThan(38);
  expect(shrinkingHeight).toBeLessThan(expandedGroupHeight + 50);
  await page.keyboard.press("Escape");
  await page.mouse.up();

  const moveGroupResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/event-groups")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    '[data-group-label="主線流程"] .event-group-drag-space',
    ".event-loose-drop-tail",
    async () => {
      await expect(page.locator('[data-group-label="主線流程"]').first()).toHaveClass(/is-group-block-dragging/);
      expect(await page.locator('[data-group-label="主線流程"] .event-group-items-shell').first().evaluate((shell) => (
        shell.getBoundingClientRect().height
      ))).toBeLessThan(2);
    },
  );
  await moveGroupResponse;
  await expect(page.locator(".toast", { hasText: "Event 排序已更新" })).toHaveCount(0);
  const droppedEventGroup = page.locator('[data-group-label="主線流程"]');
  await expect(droppedEventGroup).toHaveClass(/is-group-drop-opening/);
  const eventDropOpenHeights = await droppedEventGroup.evaluate(async (group) => {
    const shell = group.querySelector(".event-group-items-shell");
    const heights = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      heights.push(shell.getBoundingClientRect().height);
    }
    return heights;
  });
  expect(eventDropOpenHeights.at(-1) - eventDropOpenHeights[0]).toBeGreaterThan(1);
  expect(eventDropOpenHeights.some((height) => height > eventDropOpenHeights[0] + 1)).toBe(true);
  await expect.poll(() => page.locator(".event-pool-flow").evaluate((flow) => {
    const blocks = [...flow.children].filter((child) => (
      child.matches(".event-group, [data-group-item-id]")
    ));
    return blocks.at(-1)?.getAttribute("data-group-drop");
  })).toBe(JSON.stringify(["主線流程"]));

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
  const renamedGroupHeader = page.locator('[data-group-label="主線流程"] .event-group-header');
  await renamedGroupHeader.hover();
  await page.waitForTimeout(260);
  await dragToLiveTarget(
    page,
    '[data-group-label="主線流程"] [data-group-item-id="branch_random"]',
    ".event-loose-drop-tail",
  );
  await dissolveResponse;
  await expect(page.locator('[data-group-label="主線流程"]')).toHaveCount(1);
  await expect(ungrouped.locator(':scope > [data-group-item-id="branch_random"]')).toBeVisible();
  await expect(renamedGroup.locator('[data-group-item-id="branch_back"]')).toHaveCount(1);

  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: /^事件 / }).click();
  await expect(page.locator('[data-group-label="主線流程"]')).toHaveCount(1);
  await expect(page.locator('[data-group-label="主線流程"] [data-group-item-id="branch_back"]')).toHaveCount(1);
  await expect(page.locator('.event-pool-flow > [data-group-item-id="branch_random"]')).toBeVisible();
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
  await expect(page.locator("#settingsDialog")).toBeVisible();
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

test("editor undo is keyboard-only, persists the restored data, and leaves text undo native", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator("#nodeForm")).toBeVisible();
  await expect(page.getByRole("button", { name: /返回上一步|Undo Last Change/ })).toHaveCount(0);

  const nameField = page.locator('#nodeForm [name="Name"]');
  const originalName = await nameField.inputValue();
  let undoRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/undo")) undoRequests += 1;
  });

  await nameField.fill(`${originalName} native undo`);
  await nameField.press("Control+z");
  await page.waitForTimeout(120);
  expect(undoRequests).toBe(0);
  const nativeCleanupSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await nameField.evaluate((field, value) => {
    field.value = value;
    field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
  }, originalName);
  await nativeCleanupSave;

  const changedName = `${originalName} editor undo`;
  const changedSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await nameField.fill(changedName);
  await changedSave;
  await expect(page.locator("#saveState")).toHaveText("已自動儲存");
  await page.locator(".node-root-row").click();

  const undoResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/undo")
    && candidate.request().method() === "POST"
    && candidate.ok()
  ));
  await page.keyboard.press("Control+z");
  await undoResponse;
  await expect(page.locator("#saveState")).toHaveText("已返回上一步");
  await expect(page.locator('#nodeForm [name="Name"]')).toHaveValue(originalName);

  await reloadAndWaitForProject(page);
  await expect(page.locator('#nodeForm [name="Name"]')).toHaveValue(originalName);
});

test("keyboard authoring follows Event focus order, navigates every picker, and deletes contextually", async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: /編輯器分頁|Editor Tabs/ })).toBeVisible();
  await page.locator('.tab[data-tab="events"]').click();
  await expect(page.locator("#eventsPanel")).toBeVisible();

  const eventSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events")
    && candidate.request().method() === "POST"
    && candidate.ok()
  ));
  await page.keyboard.press("Control+Enter");
  const nameField = page.locator('#eventForm [name="Name"]');
  await expect(nameField).toBeFocused();

  await page.keyboard.press("Tab");
  const triggerModePicker = page.locator('#eventForm [name="TriggerMode"]').locator("xpath=..").locator("[data-select-picker-toggle]");
  await expect(triggerModePicker).toHaveJSProperty("tagName", "INPUT");
  await expect(triggerModePicker).toHaveAttribute("role", "combobox");
  await expect(triggerModePicker).toHaveAttribute("readonly", "");
  await expect(triggerModePicker).toBeFocused();
  await expect.poll(() => triggerModePicker.evaluate((picker) => getComputedStyle(picker).fontSize)).toBe("12px");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#eventForm .select-choice-menu:visible [data-select-value][aria-selected='true']")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(triggerModePicker).toBeFocused();

  await eventSave;
  await expect(triggerModePicker).toBeFocused();
  await page.keyboard.press("Tab");
  const triggerValuePicker = page.locator('#eventForm [name="Trigger"]').locator("xpath=..").locator("[data-select-picker-toggle]");
  await expect(triggerValuePicker).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#eventForm .select-choice-menu:visible [data-select-value]").last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(triggerValuePicker).toBeFocused();

  await page.keyboard.press("Tab");
  const priorityField = page.locator('#eventForm [name="Priority"]');
  await expect(priorityField).toBeFocused();
  await expect(priorityField).toHaveAttribute("min", "0");
  await expect(priorityField).toHaveAttribute("max", "9");
  await expect(priorityField).toHaveValue("5");
  await page.keyboard.press("Tab");
  await expect(page.locator('#eventForm [name="Weight"]')).toBeFocused();
  await page.keyboard.press("Tab");
  const once = page.locator('#eventForm [name="Once"]');
  await expect(once).toBeFocused();
  const onceBefore = await once.isChecked();
  await waitForEventSave(page, () => page.keyboard.press("Enter"));
  expect(await once.isChecked()).toBe(!onceBefore);

  await page.keyboard.press("Tab");
  const conditionsSection = page.locator('[data-event-section="conditions"]');
  await expect(conditionsSection).toBeFocused();
  await expect(page.locator("#eventForm details.collapsible-section")).toHaveCount(0);
  await expect(page.locator("#eventForm [data-event-section]")).toHaveCount(4);
  await waitForEventSave(page, () => page.keyboard.press("Control+Enter"));
  const conditionType = page.locator('.condition-row [name="conditionType"]').first().locator("xpath=..").locator("[data-select-picker-toggle]");
  const conditionId = page.locator('.condition-row [name="conditionId"]').first().locator("xpath=..").locator("[data-select-picker-toggle]");
  const conditionOp = page.locator('.condition-row [name="conditionOp"]').first().locator("xpath=..").locator("[data-select-picker-toggle]");
  await expect(conditionType).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('.condition-row [name="conditionIdSource"]').first().locator("xpath=..").locator("[data-select-picker-toggle]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(conditionId).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(conditionOp).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('.condition-row [name="conditionValueSource"]').first().locator("xpath=..").locator("[data-select-picker-toggle]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator('.condition-row [name="conditionValue"]').first()).toBeFocused();
  await page.keyboard.press("Tab");
  const effectsSection = page.locator('[data-event-section="effects"]');
  await expect(effectsSection).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(conditionsSection).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(conditionType).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(conditionsSection).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(effectsSection).toBeFocused();
  await waitForEventSave(page, () => page.keyboard.press("Control+Enter"));
  await expect(page.locator('.effect-row [name="effectType"]').first().locator("xpath=..").locator("[data-select-picker-toggle]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(effectsSection).toBeFocused();

  await page.keyboard.press("Tab");
  const contentSection = page.locator('[data-event-section="content"]');
  await expect(contentSection).toBeFocused();
  await waitForEventSave(page, () => page.keyboard.press("Control+Enter"));
  const contentPicker = page.locator('#eventForm [name="contentWeightedId"]').first().locator("xpath=..").locator("[data-select-picker-toggle]");
  await expect(contentPicker).toBeVisible();
  await expect(contentPicker).toBeFocused();
  await page.keyboard.press("Home");
  const contentMenuItem = page.locator("#eventForm .select-choice-menu:visible [data-select-value], #eventForm .select-choice-menu:visible [data-select-folder-toggle]").first();
  await expect(contentMenuItem).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(contentPicker).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(contentSection).toBeFocused();
  await page.keyboard.press("Tab");
  const endUpSection = page.locator('[data-event-section="end-up"]');
  await expect(endUpSection).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('#eventForm [name="EndUp"]').locator("xpath=..").locator("[data-select-picker-toggle]")).toBeFocused();

  await expect.poll(() => page.locator("select:not([multiple])").evaluateAll((selects) => (
    selects.every((select) => select.dataset.selectEnhanced === "true" && select.tabIndex === -1)
  ))).toBe(true);

  const effectRow = page.locator("#effectList .effect-row").first();
  await effectRow.locator('[name="effectValue"]').focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-event-section="effects"]')).toBeFocused();

  let deleteRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/events?") && request.method() === "DELETE") deleteRequests += 1;
  });
  await nameField.focus();
  await page.keyboard.press("Control+Backspace");
  await page.waitForTimeout(100);
  expect(deleteRequests).toBe(0);

  const deleteButton = page.locator("#deleteEventButton");
  await deleteButton.focus();
  page.once("dialog", (dialog) => dialog.accept());
  const deleteResponse = page.waitForResponse((candidate) => (
    candidate.url().includes("/api/events?")
    && candidate.request().method() === "DELETE"
    && candidate.ok()
  ));
  await page.keyboard.press("Control+Backspace");
  await deleteResponse;
  expect(deleteRequests).toBe(1);
  await expect(page.locator("#saveState")).toHaveText("已同步");
});

test("choice picker mouse selection survives Safari focusout without a related target", async ({ page }) => {
  await page.goto(editorUrl);
  await page.evaluate(() => {
    const fixture = document.createElement("label");
    fixture.id = "choicePickerPointerFixture";
    fixture.innerHTML = `
      <span>Pointer fixture</span>
      <select aria-label="Pointer fixture">
        <option value="first">First</option>
        <option value="second">Second</option>
        <option value="nested_top" data-picker-path="Folder/Top">Top</option>
        <option value="nested_middle" data-picker-path="Folder/Middle">Middle</option>
        <option value="nested_lower" data-picker-path="Folder/Lower">Lower</option>
        <option value="nested_bottom" data-picker-path="Folder/Bottom">Bottom</option>
        <option value="nested_deep" data-picker-path="Folder/Chapter/Area/Deep">Deep</option>
      </select>
    `;
    document.body.append(fixture);
  });

  const fixture = page.locator("#choicePickerPointerFixture");
  const select = fixture.locator("select");
  await expect(select).toHaveAttribute("data-select-enhanced", "true");
  const trigger = fixture.locator("[data-select-picker-toggle]");
  await trigger.evaluate((element) => element.click());
  const picker = fixture.locator(".select-choice-picker");
  const secondChoice = fixture.locator('[data-select-value="second"]');
  await expect(picker).toHaveClass(/open/);
  await expect(fixture.locator(".select-choice-menu")).toHaveAttribute("popover", "manual");
  expect(await fixture.locator(".select-choice-menu").evaluate((menu) => (
    typeof menu.showPopover !== "function" || menu.matches(":popover-open")
  ))).toBe(true);
  const firstMenuGeometry = await fixture.locator(".select-choice-menu").evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const items = [...menu.children].map((child) => (
      child.matches(".select-choice-option") ? child : child.querySelector(":scope > .select-choice-folder")
    )).filter(Boolean);
    const itemHeights = items.map((item) => item.getBoundingClientRect().height);
    const expectedHeight = itemHeights.reduce((sum, height) => sum + height, 0)
      + Number.parseFloat(style.rowGap || style.gap) * Math.max(0, items.length - 1)
      + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    return { width: rect.width, height: rect.height, expectedHeight, itemHeights };
  });
  expect(firstMenuGeometry.width).toBeLessThanOrEqual(242);
  expect(firstMenuGeometry.height).toBeLessThanOrEqual(322);
  expect(new Set(firstMenuGeometry.itemHeights)).toEqual(new Set([38]));
  expect(firstMenuGeometry.height).toBeCloseTo(firstMenuGeometry.expectedHeight, 0);

  await page.evaluate(() => {
    const fixtureRoot = document.querySelector("#choicePickerPointerFixture");
    const triggerElement = fixtureRoot.querySelector("[data-select-picker-toggle]");
    const choice = fixtureRoot.querySelector('[data-select-value="second"]');
    choice.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      isPrimary: true,
      pointerId: 41,
    }));
    triggerElement.dispatchEvent(new FocusEvent("focusout", {
      bubbles: true,
      relatedTarget: null,
    }));
  });

  await expect(picker).toHaveClass(/open/);
  await secondChoice.click();
  await expect(select).toHaveValue("second");
  await expect(trigger).toHaveValue("Second");
  await expect(picker).not.toHaveClass(/open/);

  const folder = fixture.locator("[data-select-folder-toggle]").filter({ hasText: "Folder" }).first();
  const openMenu = async () => {
    await trigger.evaluate((element) => element.click());
    await expect(picker).toHaveClass(/open/);
  };
  const openNestedMenu = async () => {
    await openMenu();
    await folder.click();
    await expect(folder.locator("xpath=..")).toHaveClass(/submenu-open/);
  };

  await openMenu();
  const typography = await fixture.evaluate((root) => {
    const optionStyle = getComputedStyle(root.querySelector(".select-choice-option"));
    const folderStyle = getComputedStyle(root.querySelector(".select-choice-folder"));
    const fields = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"];
    return Object.fromEntries(fields.map((field) => [field, [optionStyle[field], folderStyle[field]]]));
  });
  Object.values(typography).forEach(([optionValue, folderValue]) => expect(optionValue).toBe(folderValue));
  await expect(secondChoice).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(folder).toBeFocused();
  await expect(folder.locator("xpath=..")).toHaveClass(/submenu-open/);
  await expect(folder.locator("xpath=../div[contains(@class, 'select-choice-submenu')]")).toBeVisible();
  const submenuGeometry = await folder.locator("xpath=../div[contains(@class, 'select-choice-submenu')]/div[contains(@class, 'select-choice-submenu-scroll')]").evaluate((surface) => {
    const style = getComputedStyle(surface);
    const itemHeights = [...surface.children].map((item) => item.getBoundingClientRect().height);
    const expectedHeight = itemHeights.reduce((sum, height) => sum + height, 0)
      + Number.parseFloat(style.rowGap || style.gap) * Math.max(0, itemHeights.length - 1)
      + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    return { height: surface.getBoundingClientRect().height, expectedHeight, itemHeights };
  });
  expect(new Set(submenuGeometry.itemHeights)).toEqual(new Set([38]));
  expect(submenuGeometry.height).toBeCloseTo(submenuGeometry.expectedHeight, 0);
  await page.keyboard.press("ArrowRight");
  await expect(fixture.locator("[data-select-folder-toggle]").filter({ hasText: "Chapter" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(fixture.locator('[data-select-value="nested_top"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toBeFocused();
  await folder.hover();
  await expect(folder.locator("xpath=..")).toHaveClass(/submenu-open/);

  const travel = await fixture.evaluate((root) => {
    const menu = root.querySelector(".select-choice-menu").getBoundingClientRect();
    const branch = root.querySelector(".select-choice-branch");
    const folderButton = branch.querySelector(":scope > .select-choice-folder").getBoundingClientRect();
    const submenu = branch.querySelector(":scope > .select-choice-submenu").getBoundingClientRect();
    const opensRight = submenu.left > menu.right;
    return {
      folderX: folderButton.left + folderButton.width / 2,
      folderY: folderButton.top + folderButton.height / 2,
      bridgeX: opensRight ? (menu.right + submenu.left) / 2 : (submenu.right + menu.left) / 2,
      bridgeY: Math.max(submenu.top + 2, Math.min(folderButton.top + folderButton.height / 2, submenu.bottom - 2)),
    };
  });
  await page.mouse.move(travel.folderX, travel.folderY);
  await page.mouse.move(travel.bridgeX, travel.bridgeY);
  await page.waitForTimeout(240);
  await expect(folder.locator("xpath=..")).toHaveClass(/submenu-open/);
  const bridgeOwner = await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest(".select-choice-submenu")?.className || ""
  ), { x: travel.bridgeX, y: travel.bridgeY });
  expect(bridgeOwner).toContain("select-choice-submenu");

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(fixture.locator('[data-select-value="nested_top"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(fixture.locator('[data-select-value="nested_middle"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("nested_middle");

  await openNestedMenu();
  await fixture.locator('[data-select-value="nested_lower"]').click();
  await expect(select).toHaveValue("nested_lower");
  await expect(trigger).toHaveValue("Lower");

  await openNestedMenu();
  const bottomPoint = await fixture.locator('[data-select-value="nested_bottom"]').evaluate((choice) => {
    const rect = choice.getBoundingClientRect();
    const blocker = document.createElement("button");
    blocker.id = "choicePickerUnderlyingControl";
    blocker.type = "button";
    blocker.style.cssText = `position:fixed;z-index:999999;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    document.body.append(blocker);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.closest('[data-select-value="nested_bottom"]')?.dataset.selectValue || ""
  ), bottomPoint)).toBe("nested_bottom");
  await page.mouse.click(bottomPoint.x, bottomPoint.y);
  await expect(select).toHaveValue("nested_bottom");
  await expect(trigger).toHaveValue("Bottom");
  await page.locator("#choicePickerUnderlyingControl").evaluate((element) => element.remove());

  await openNestedMenu();
  const chapterFolder = fixture.locator("[data-select-folder-toggle]").filter({ hasText: "Chapter" });
  await chapterFolder.click();
  const areaFolder = fixture.locator("[data-select-folder-toggle]").filter({ hasText: "Area" });
  await areaFolder.click();
  await fixture.locator('[data-select-value="nested_deep"]').click();
  await expect(select).toHaveValue("nested_deep");
  await expect(trigger).toHaveValue("Deep");
  await fixture.evaluate((element) => element.remove());
});

test("textbox appearance profiles are reusable, previewed, and persisted", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);
  const optionsLabNode = page.locator('#nodeList [data-node-path="options_lab"]');
  await optionsLabNode.dispatchEvent("click");
  await page.getByRole("button", { name: "選項", exact: true }).click();
  await page.locator(".option-workspace-divider").click();
  await expect(page.locator('.option-builder[data-workspace-mode="canvas"]')).toBeVisible();
  await expect(page.locator(".option-transition-overlay")).toHaveCount(0);
  await expect(page.locator(".option-live-inspector")).toBeVisible();
  await expect(page.locator("#optionStageShell")).toBeVisible();
  const canvasInspectorRatio = await page.locator('.option-builder[data-workspace-mode="canvas"]').evaluate((builder) => {
    const canvasWidth = builder.querySelector(".option-canvas-column")?.getBoundingClientRect().width || 0;
    const inspectorWidth = builder.querySelector(".option-visual-inspector")?.getBoundingClientRect().width || 1;
    return canvasWidth / inspectorWidth;
  });
  expect(canvasInspectorRatio).toBeGreaterThan(1.31);
  expect(canvasInspectorRatio).toBeLessThan(1.36);
  await expect(page.locator("#textboxAppearanceDialog")).toHaveCount(0);

  await page.locator('[data-option-inspector-tab="style"]').click();
  await page.locator("#manageTextboxProfiles").click();
  const createResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/textbox-profiles")
    && candidate.request().method() === "POST"
    && candidate.ok()
  ));
  await page.locator("#newTextboxProfile").click();
  const created = await (await createResponse).json();
  await page.locator('[data-textbox-profile-path="Name"]').fill("Smoke Glass");
  await page.locator('[data-textbox-profile-path="Style.Background"]').fill("#102030cc");
  await page.locator('[data-textbox-profile-path="Features.hover_accent.Enabled"]').check({ force: true });
  for (const feature of ["item_corners", "text_padding", "text_bold", "text_italic", "text_spacing", "item_border"]) {
    await page.locator(`[data-textbox-profile-path="Features.${feature}.Enabled"]`).check({ force: true });
  }
  await page.locator('[data-textbox-profile-path="Features.item_corners.Radius"]').fill("20");
  await page.locator('[data-textbox-profile-path="Features.text_padding.X"]').fill("32");
  await page.locator('[data-textbox-profile-path="Features.text_spacing.Spacing"]').fill("2.5");
  const profileSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/textbox-profiles")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await page.locator("#saveTextboxProfile").click();
  await profileSave;
  await expect(page.locator(".toast").last()).toContainText("設定檔已儲存");
  await page.locator('[data-close-dialog="textboxProfileDialog"]').last().click();

  await waitForOptionsSave(page, async () => {
    await page.locator("[data-textbox-profile-select]").selectOption(created.ID, { force: true });
  });
  await expect(page.locator(".option-text-item.has-hover-accent").first()).toBeVisible();
  const previewItem = page.locator(".option-text-item").first();
  await expect(previewItem).toHaveCSS("border-radius", "20px");
  await expect(previewItem).toHaveCSS("padding-left", "32px");
  await expect(previewItem).toHaveCSS("padding-right", "32px");
  await expect(previewItem).toHaveCSS("font-weight", "700");
  await expect(previewItem).toHaveCSS("font-style", "italic");
  await expect(previewItem).toHaveCSS("letter-spacing", "2.5px");
  await page.screenshot({ path: test.info().outputPath("textbox-features.png") });
  await page.locator('[data-option-inspector-tab="effects"]').click();
  await waitForOptionsSave(page, async () => {
    await page.locator('[data-textbox-feature="staggered_entrance"] + .boolean-display').click();
  });
  await expect(page.locator(".option-text-item.has-entrance").first()).toBeVisible();

  const secondStageItem = page.locator("#optionStage [data-option-item-select]").nth(1);
  const secondItemId = await secondStageItem.getAttribute("data-option-item-select");
  await secondStageItem.dispatchEvent("pointerdown", { button: 0 });
  await expect(page.locator('[data-option-inspector-tab="item"]')).toHaveClass(/active/);
  await expect(page.locator(`.option-item-segment [data-option-item-select="${secondItemId}"]`)).toHaveClass(/active/);

  await page.locator("#optionStage .option-stage-element.type-picture").click();
  await expect(page.locator("[data-option-inspector-tab]")).toHaveCount(2);
  await expect(page.locator('[data-option-inspector-tab="layout"]')).toHaveClass(/active/);
  await page.locator('[data-option-inspector-tab="style"]').click();
  await expect(page.locator(".option-inspector-section-heading h3").first()).toHaveText("互動回饋");

  await page.locator("#optionStage .option-stage-element.type-hitbox").click();
  await expect(page.locator("[data-option-inspector-tab]")).toHaveCount(2);
  await expect(page.locator('[data-option-inspector-tab="style"]')).toHaveClass(/active/);
  await expect(page.locator(".option-inspector-section-heading h3").last()).toHaveText("編輯器顯示");

  const nodeResponse = await page.request.get(`${editorUrl}/api/node?path=options_lab`);
  const node = await nodeResponse.json();
  const textbox = node.options.Elements.find((element) => element.Type === "TEXTBOX");
  expect(node.options.Version).toBe(3);
  expect(textbox.Appearance.Profile).toBe(created.ID);
  expect(textbox.Appearance["Style Overrides"]).toEqual({});
  expect(textbox.Appearance.Features.staggered_entrance).toBe(true);

  const profilesResponse = await page.request.get(`${editorUrl}/api/textbox-profiles`);
  const profileData = await profilesResponse.json();
  expect(profileData.profiles.find((profile) => profile.ID === created.ID).Name).toBe("Smoke Glass");
  await reloadAndWaitForProject(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').dispatchEvent("click");
  await page.getByRole("button", { name: "選項", exact: true }).click();
  if (!await page.locator('.option-builder[data-workspace-mode="canvas"]').count()) {
    await page.locator(".option-workspace-divider").click();
  }
  await expect(page.locator(".option-transition-overlay")).toHaveCount(0);
  await expect(page.locator('[data-option-inspector-tab="effects"]')).toHaveCount(1);
  await expect(previewItem).toHaveCSS("border-radius", "20px");
  await expect(previewItem).toHaveCSS("font-weight", "700");
  await expect(previewItem).toHaveCSS("font-style", "italic");
  await expect(previewItem).toHaveCSS("letter-spacing", "2.5px");
  await expect(previewItem).toHaveCSS("padding-left", "32px");
  await page.locator('[data-option-inspector-tab="effects"]').click();
  await waitForOptionsSave(page, async () => {
    await page.locator('[data-textbox-feature="text_italic"] + .boolean-display').click();
  });
  await expect(previewItem).toHaveCSS("font-style", "normal");
  expect(errors).toEqual([]);
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
  const validationResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/validate")
    && candidate.request().method() === "GET"
    && candidate.ok()
  ));
  await page.locator("#runValidationButton").click();
  await validationResponse;
  await expect(page.locator("#toastRegion")).toContainText("Project validation passed");

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

test("shared drag sorting persists Event rules, Options, and Memory order", async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1100 });
  const branchResponse = await page.request.get(`${editorUrl}/api/node?path=branch_lab`);
  const branch = await branchResponse.json();
  const event = branch.events.find((entry) => entry.data.ID === "branch_success").data;
  event.Effects = [
    { type: "stat", id: "test_actions", op: "+", value: 1 },
    { type: "memory", bank: "test_session", id: "sorted_effect", op: "add" },
  ];
  event.Content = { test_branch_success: 2, test_branch_random: 1 };
  event["Next Node"] = { outcome_success: 2, outcome_fallback: 1 };
  const seedResponse = await page.request.post(`${editorUrl}/api/events`, {
    data: { node: "branch_lab", originalId: event.ID, event },
  });
  expect(seedResponse.ok()).toBe(true);

  await page.goto(editorUrl);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="branch_success"]').click();
  await expect(page.locator("#conditionList .condition-row")).toHaveCount(2);
  await expect(page.locator("#effectList .effect-row")).toHaveCount(2);
  await expect(page.locator('.weighted-choice-table:has([name="contentRepresentation"]) .weight-row')).toHaveCount(2);
  await expect(page.locator('.weighted-choice-table:has([name="nextRepresentation"]) .weight-row')).toHaveCount(2);
  const eventCardRhythm = await page.evaluate(() => {
    const effect = document.querySelector("#effectList > .effect-row");
    const content = document.querySelector('.weighted-choice-table:has([name="contentRepresentation"]) .content-weight-row');
    const contentControls = [...content.querySelectorAll('.select-choice-trigger, input[name="contentWeightedValue"]')];
    return {
      effectHeight: effect.getBoundingClientRect().height,
      contentHeight: content.getBoundingClientRect().height,
      contentControlHeights: contentControls.map((control) => control.getBoundingClientRect().height),
      effectBackground: getComputedStyle(effect).backgroundColor,
      contentBackground: getComputedStyle(content).backgroundColor,
      effectRadius: getComputedStyle(effect).borderRadius,
      contentRadius: getComputedStyle(content).borderRadius,
    };
  });
  expect(eventCardRhythm.contentHeight).toBe(eventCardRhythm.effectHeight);
  expect(eventCardRhythm.contentControlHeights).toEqual([38, 38]);
  expect(eventCardRhythm.contentBackground).toBe(eventCardRhythm.effectBackground);
  expect(eventCardRhythm.contentRadius).toBe(eventCardRhythm.effectRadius);
  const groupedCondition = page.locator("#conditionList .condition-row").first();
  await expect.poll(() => groupedCondition.evaluate((row) => getComputedStyle(row).borderColor))
    .toBe("rgba(0, 0, 0, 0)");
  await groupedCondition.hover();
  await expect.poll(() => groupedCondition.evaluate((row) => getComputedStyle(row).borderColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => page.locator("#conditionList .condition-drop-tail").evaluate((tail) => tail.getBoundingClientRect().height))
    .toBe(0);

  const conditionSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await dragConditionBefore(
    page,
    page.locator("#conditionList .condition-row").nth(1),
    page.locator("#conditionList .condition-row").nth(0),
  );
  await conditionSave;
  await expect(page.locator("#conditionList .condition-row").first().locator('[name="conditionType"]')).toHaveValue("memory");
  await expect(page.locator("#conditionList .condition-and-group")).toHaveCount(1);

  const conditionOrSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await dragConditionOutOfGroup(page, page.locator("#conditionList .condition-row").first());
  await conditionOrSave;
  await expect(page.locator("#conditionList .condition-and-group .condition-row")).toHaveCount(1);
  await expect(page.locator("#conditionList > .condition-row")).toHaveCount(1);
  await expect.poll(() => page.locator("#conditionList > .condition-logic-block").nth(1).evaluate((block) => (
    getComputedStyle(block, "::before").content
  ))).toBe('"OR"');
  const orSeparatorGeometry = await page.locator("#conditionList > .condition-logic-block").nth(1).evaluate((block) => {
    const separator = getComputedStyle(block, "::before");
    const blockRect = block.getBoundingClientRect();
    return {
      gap: -(Number.parseFloat(separator.top) + Number.parseFloat(separator.height)),
      visible: blockRect.top + Number.parseFloat(separator.top) >= document.querySelector("#conditionList").getBoundingClientRect().top,
    };
  });
  expect(orSeparatorGeometry.gap).toBeGreaterThanOrEqual(8);
  expect(orSeparatorGeometry.visible).toBe(true);

  const addOrSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await page.getByRole("button", { name: "新增條件" }).click();
  await addOrSave;
  await expect(page.locator("#conditionList > .condition-row")).toHaveCount(2);

  const regroupSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await groupConditionsByDwell(
    page,
    page.locator("#conditionList > .condition-row").nth(0),
    page.locator("#conditionList > .condition-row").nth(1),
  );
  await regroupSave;
  await expect(page.locator("#conditionList .condition-and-group")).toHaveCount(2);
  await expect(page.locator("#conditionList > .condition-row")).toHaveCount(0);
  await reloadAndWaitForProject(page);
  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="branch_success"]').click();
  await expect(page.locator("#conditionList .condition-and-group")).toHaveCount(2);
  await expect(page.locator("#conditionList > .condition-row")).toHaveCount(0);

  const effectSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await dragConditionBefore(
    page,
    page.locator("#effectList .effect-row").nth(1),
    page.locator("#effectList .effect-row").nth(0),
  );
  await effectSave;
  await expect(page.locator("#effectList .effect-row").first().locator('[name="effectType"]')).toHaveValue("memory");

  const contentRows = page.locator('.weighted-choice-table:has([name="contentRepresentation"]) .weight-row');
  const contentSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await dragListItemBefore(page, contentRows.nth(1), contentRows.nth(0));
  await contentSave;

  const nextRows = page.locator('.weighted-choice-table:has([name="nextRepresentation"]) .weight-row');
  const nextSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/events") && candidate.request().method() === "POST" && candidate.ok()
  ));
  await dragListItemBefore(page, nextRows.nth(1), nextRows.nth(0));
  await nextSave;

  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.getByRole("button", { name: "選項", exact: true }).click();
  const optionElementSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/options") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragListItemBefore(
    page,
    page.locator('[data-option-element-select="hitbox_mark"]'),
    page.locator('[data-option-element-select="data_actions"]'),
  );
  await optionElementSave;
  await expect(page.locator("[data-option-element-select]").first()).toHaveAttribute("data-option-element-select", "hitbox_mark");

  await page.locator('[data-option-element-select="data_actions"]').click();
  const firstTextboxItem = page.locator(".option-items-list [data-option-item-order-id]").first();
  const secondTextboxItem = page.locator(".option-items-list [data-option-item-order-id]").nth(1);
  const firstTextboxItemId = await firstTextboxItem.getAttribute("data-option-item-order-id");
  const secondTextboxItemId = await secondTextboxItem.getAttribute("data-option-item-order-id");
  await expect(firstTextboxItem.locator(".option-item-entry")).toHaveClass(/active/);
  const firstTextboxItemName = page.locator('[data-option-item-path="Name"]');
  const editedTextboxItemName = `${await firstTextboxItemName.inputValue()} Smoke`;
  const textboxItemEditSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/options") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await firstTextboxItemName.fill(editedTextboxItemName);
  await secondTextboxItem.locator(`[data-option-item-select="${secondTextboxItemId}"]`).click();
  await expect(secondTextboxItem.locator(".option-item-entry")).toHaveClass(/active/);
  await expect(page.locator('[data-option-item-path="Name"]')).not.toHaveValue(editedTextboxItemName);
  await textboxItemEditSave;
  const switchedOptions = await (await page.request.get(`${editorUrl}/api/node?path=options_lab`)).json();
  expect(switchedOptions.options.Elements.find((entry) => entry.ID === "data_actions").Items
    .find((item) => item.ID === firstTextboxItemId).Name).toBe(editedTextboxItemName);

  const optionItemSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/options") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragListItemBeforeFromCenter(
    page,
    page.locator('[data-option-item-order-id="hide_controlled_list"]'),
    page.locator('[data-option-item-order-id="gain_one"]'),
    async () => {
      const preview = page.locator(".list-reorder-preview.is-option-item-preview");
      await expect(preview).toBeVisible();
      await expect.poll(() => preview.evaluate((element) => ({
        border: getComputedStyle(element).borderTopWidth,
        shadow: getComputedStyle(element).boxShadow,
      }))).toEqual({ border: "0px", shadow: "none" });
    },
  );
  await optionItemSave;
  await expect(page.locator("[data-option-item-order-id]").first()).toHaveAttribute("data-option-item-order-id", "hide_controlled_list");

  await page.getByRole("button", { name: "狀態", exact: true }).click();
  const memorySave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/state") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragListItemBefore(
    page,
    page.locator('.memory-row[data-memory-id="test_session"]'),
    page.locator('.memory-row[data-memory-id="memory"]'),
    async () => {
      const sourceBox = await page.locator('#memoriesBody .memory-row[data-memory-id="test_session"]').boundingBox();
      const preview = page.locator(".list-reorder-preview.is-table-row-preview");
      const previewBox = await preview.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(previewBox).not.toBeNull();
      expect(Math.abs(previewBox.width - sourceBox.width)).toBeLessThan(2);
      expect(Math.abs(previewBox.height - sourceBox.height)).toBeLessThan(2);
      await expect(preview.locator('input[name="memoryName"]')).toHaveValue("測試階段記憶");
      expect(await page.locator("#memoriesBody").evaluate((body) => ({
        inputUserSelect: getComputedStyle(body.querySelector('input[name="memoryName"]')).userSelect,
        selection: window.getSelection()?.toString() || "",
      }))).toEqual({ inputUserSelect: "none", selection: "" });
    },
  );
  await memorySave;
  await expect.poll(() => page.locator('#memoriesBody input[name="memoryName"]').first().evaluate((input) => (
    getComputedStyle(input).userSelect
  ))).not.toBe("none");
  await expect(page.locator(".memory-row").first()).toHaveAttribute("data-memory-id", "test_session");

  const savedBranch = await (await page.request.get(`${editorUrl}/api/node?path=branch_lab`)).json();
  const savedEvent = savedBranch.events.find((entry) => entry.data.ID === "branch_success").data;
  expect(savedEvent.Conditions).toHaveLength(3);
  expect(savedEvent.Conditions[0].clause).toBe("and_1");
  expect(savedEvent.Conditions[1].clause).toBeTruthy();
  expect(savedEvent.Conditions[2].clause).toBe(savedEvent.Conditions[1].clause);
  expect(savedEvent.Effects.map((entry) => entry.type)).toEqual(["memory", "stat"]);
  expect(Object.keys(savedEvent.Content)).toEqual(["test_branch_random", "test_branch_success"]);
  expect(Object.keys(savedEvent["Next Node"])).toEqual(["outcome_fallback", "outcome_success"]);
  const savedOptions = await (await page.request.get(`${editorUrl}/api/node?path=options_lab`)).json();
  expect(savedOptions.options.Elements.map((entry) => entry.ID).slice(0, 2)).toEqual(["hitbox_mark", "data_actions"]);
  expect(savedOptions.options.Elements.find((entry) => entry.ID === "data_actions").Items[0].ID).toBe("hide_controlled_list");
  const savedProject = await (await page.request.get(`${editorUrl}/api/project`)).json();
  expect(Object.keys(savedProject.memories).slice(0, 2)).toEqual(["test_session", "memory"]);
});

test("creator-managed Node, Content, and Textbox Profile lists persist drag order", async ({ page }) => {
  for (const profile of [
    { ID: "sort_profile_a", Name: "Sort Profile A" },
    { ID: "sort_profile_b", Name: "Sort Profile B" },
  ]) {
    const response = await page.request.post(`${editorUrl}/api/textbox-profiles`, { data: { profile } });
    expect(response.ok()).toBe(true);
  }

  await page.setViewportSize({ width: 1680, height: 1100 });
  await page.goto(editorUrl);
  await openNodeSidebar(page);
  const nodeItems = page.locator('#nodeList .node-item:not(.global-node-item)');
  const firstNodePath = await nodeItems.nth(0).getAttribute("data-node-path");
  const secondNodePath = await nodeItems.nth(1).getAttribute("data-node-path");
  const nodeOrderSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node-groups") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dispatchImmediateDrag(
    page,
    `#nodeList [data-node-path="${secondNodePath}"]`,
    `#nodeList [data-node-path="${firstNodePath}"]`,
  );
  await nodeOrderSave;
  await expect(nodeItems.first()).toHaveAttribute("data-node-path", secondNodePath);

  await page.locator('#nodeList [data-node-path="root"]').click();
  await page.getByRole("button", { name: "演出", exact: true }).click();
  const contentItems = page.locator("[data-content-file]");
  await expect(contentItems).toHaveCount(3);
  const firstContent = await contentItems.nth(0).getAttribute("data-content-file");
  const secondContent = await contentItems.nth(1).getAttribute("data-content-file");
  const contentOrderSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/content/order") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragListItemBefore(page, contentItems.nth(1), contentItems.nth(0));
  await contentOrderSave;
  await expect(page.locator("[data-content-file]").first()).toHaveAttribute("data-content-file", secondContent);

  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="options_lab"]').click();
  await page.getByRole("button", { name: "選項", exact: true }).click();
  await page.locator('[data-option-element-select="data_actions"]').click();
  await page.locator(".option-workspace-divider").click();
  await expect(page.locator(".option-transition-overlay")).toHaveCount(0);
  await page.locator('.option-builder[data-workspace-mode="canvas"] [data-option-inspector-tab="style"]').click();
  await page.locator("#manageTextboxProfiles").click();
  const profileOrderSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/textbox-profiles/order") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragListItemBefore(
    page,
    page.locator('[data-textbox-profile-id="sort_profile_b"]'),
    page.locator('[data-textbox-profile-id="sort_profile_a"]'),
  );
  await profileOrderSave;
  const profileIds = await page.locator("[data-textbox-profile-id]").evaluateAll((items) => items.map((item) => item.dataset.textboxProfileId));
  expect(profileIds.indexOf("sort_profile_b")).toBeLessThan(profileIds.indexOf("sort_profile_a"));

  const rootDetail = await (await page.request.get(`${editorUrl}/api/node?path=root`)).json();
  expect(rootDetail.contents.slice(0, 2).map((entry) => entry.name)).toEqual([secondContent, firstContent]);
  const project = await (await page.request.get(`${editorUrl}/api/project`)).json();
  expect(project.nodes[0].path).toBe(secondNodePath);
  expect(project.nodes.map((entry) => entry.path)).toContain(firstNodePath);
  const persistedProfileIds = project.textboxProfiles.map((profile) => profile.ID);
  expect(persistedProfileIds.indexOf("sort_profile_b")).toBeLessThan(persistedProfileIds.indexOf("sort_profile_a"));
  await page.locator("#textboxProfileDialog").evaluate((dialog) => dialog.close());

  await openNodeSidebar(page);
  await page.locator('#nodeList [data-node-path="branch_lab"]').click();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.locator('[data-event-id="branch_random"]').click();
  await openNodeSidebar(page);
  const nodeGroupSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node-groups") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragWithDwell(
    page,
    page.locator('#nodeList [data-node-path="outcome_success"]'),
    page.locator('#nodeList [data-node-path="outcome_fallback"]'),
    520,
    async () => {
      const target = page.locator('#nodeList [data-node-path="outcome_fallback"]');
      await expect(target).toHaveClass(/is-group-ready/);
      await expect.poll(() => target.evaluate((item) => Number.parseFloat(getComputedStyle(item).marginBottom)))
        .toBeGreaterThan(40);
    },
  );
  await nodeGroupSave;
  const nodeGroup = page.locator("#nodeList .node-group").filter({ has: page.locator('[data-node-path="outcome_success"]') });
  await expect(nodeGroup).toHaveCount(1);
  await expect(nodeGroup.locator(".node-item")).toHaveCount(2);
  const nodeSidebarGaps = await page.locator("#nodeList .node-pool-flow").evaluate((flow) => {
    const children = [...flow.children].filter((child) => (
      child.matches(".node-group, [data-group-item-id]")
    ));
    return children.slice(1).map((child, index) => {
      const previous = children[index].getBoundingClientRect();
      const current = child.getBoundingClientRect();
      return current.top - previous.bottom;
    });
  });
  expect(nodeSidebarGaps.length).toBeGreaterThan(0);
  expect(nodeSidebarGaps.every((gap) => Math.abs(gap - 8) < 1)).toBe(true);
  await expect.poll(() => nodeGroup.locator(".node-item").first().evaluate((item) => getComputedStyle(item).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  const nodeReorderSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node-groups") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dispatchImmediateDrag(
    page,
    '#nodeList .node-group [data-node-path="outcome_success"]',
    '#nodeList .node-group [data-node-path="outcome_fallback"]',
  );
  await nodeReorderSave;
  await expect(page.locator("#nodeList .node-group")).toHaveClass(/is-group-pinned-open/);
  await expect.poll(() => page.locator("#nodeList .node-group .event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);
  const nodeGroupBlockSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/node-groups") && candidate.request().method() === "PUT" && candidate.ok()
  ));
  await dragToLiveTarget(
    page,
    "#nodeList .node-group-drag-space",
    ".node-loose-drop-tail",
    async () => {
      await expect(page.locator("#nodeList .node-group")).toHaveClass(/is-group-block-dragging/);
      expect(await page.locator("#nodeList .node-group .event-group-items-shell").evaluate((shell) => (
        shell.getBoundingClientRect().height
      ))).toBeLessThan(2);
    },
  );
  await nodeGroupBlockSave;
  const droppedNodeGroup = page.locator("#nodeList .node-group");
  await expect(droppedNodeGroup).not.toHaveClass(/is-group-drop-opening|is-group-pinned-open/);
  await expect.poll(() => droppedNodeGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeLessThan(2);
  const groupedProject = await (await page.request.get(`${editorUrl}/api/project`)).json();
  expect(groupedProject.nodes.filter((node) => ["outcome_success", "outcome_fallback"].includes(node.path)).map((node) => node.group))
    .toEqual(["新群組", "新群組"]);
  await page.locator("#sidebarScrim").click();
  const groupedNames = Object.fromEntries(groupedProject.nodes.map((node) => [node.id || node.path, node.name]));
  const nextNodeSelect = page.locator('select[name="nextWeightedId"]').first();
  await expect(nextNodeSelect.locator('option[value="outcome_success"]'))
    .toHaveAttribute("data-picker-path", `新群組/${groupedNames.outcome_success}`);
  await expect(nextNodeSelect.locator('option[value="outcome_fallback"]'))
    .toHaveAttribute("data-picker-path", `新群組/${groupedNames.outcome_fallback}`);
  const nextNodePicker = nextNodeSelect.locator("xpath=..");
  await nextNodePicker.locator("[data-select-picker-toggle]").click();
  const nodeGroupChoice = nextNodePicker.locator("[data-select-folder-toggle]").filter({ hasText: "新群組" });
  await expect(nodeGroupChoice).toBeVisible();
  await nodeGroupChoice.click();
  await expect(nextNodePicker.locator('[data-select-value="outcome_success"]')).toBeVisible();

  await openNodeSidebar(page);
  const selectableNodeGroup = page.locator("#nodeList .node-group").filter({ has: page.locator('[data-node-path="outcome_success"]') });
  await selectableNodeGroup.locator(".node-group-header").hover();
  await expect.poll(() => selectableNodeGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);
  await selectableNodeGroup.locator('[data-node-path="outcome_success"]').click({ force: true });
  await openNodeSidebar(page);
  const editingNodeGroup = page.locator("#nodeList .node-group").filter({ has: page.locator('[data-node-path="outcome_success"]') });
  await expect(editingNodeGroup).toHaveClass(/is-group-editing/);
  await expect.poll(() => editingNodeGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeGreaterThan(20);

  await page.locator('#nodeList [data-node-path="root"]').click({ force: true });
  await expect(editingNodeGroup).toHaveClass(/is-group-selection-collapsing/);
  const nodeCollapseHeights = await editingNodeGroup.evaluate(async (group) => {
    const shell = group.querySelector(".event-group-items-shell");
    const heights = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      heights.push(shell.getBoundingClientRect().height);
    }
    return heights;
  });
  expect(nodeCollapseHeights[0] - nodeCollapseHeights.at(-1)).toBeGreaterThan(1);
  expect(nodeCollapseHeights.some((height) => height > 2 && height < nodeCollapseHeights[0] - 1)).toBe(true);
  await openNodeSidebar(page);
  await page.mouse.move(1200, 700);
  await expect(editingNodeGroup).not.toHaveClass(/is-group-editing/);
  await expect.poll(() => editingNodeGroup.locator(".event-group-items-shell").evaluate((shell) => (
    shell.getBoundingClientRect().height
  ))).toBeLessThan(2);
});

test("Content mounts the offline Ren'Py editor and keeps autosave persistence", async ({ page }) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      browserErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: /編輯器分頁|Editor tabs/ })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/^(已同步|Synced)$/);
  await page.getByRole("button", { name: "演出", exact: true }).click();
  await expect(page.locator("#contentEditorHost .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#contentEditorStatus")).toHaveText("語法支援已啟用");
  await expect(page.locator("#contentEditor")).toBeHidden();
  await expect(page.locator("#contentEditorHost .line-numbers").first()).toBeVisible();

  await page.locator("#contentEditorHost textarea").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#contentPanel")).toBeFocused();

  const fallback = page.locator("#contentEditor");
  const original = await fallback.inputValue();
  const marker = "# content editor browser persistence";
  const changed = `${original.replace(/\s*$/, "")}\n${marker}\n`;
  const saveResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/content")
      && candidate.request().method() === "POST"
      && candidate.ok()
  ));
  await fallback.evaluate((textarea, value) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, changed);
  await saveResponse;
  await reloadAndWaitForProject(page);
  await page.getByRole("button", { name: "演出", exact: true }).click();
  await expect(page.locator("#contentEditorHost .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#contentEditor")).toHaveValue(new RegExp(`${marker}\\n$`));
  await expect(page.locator("#contentEditorHost")).toContainText(marker);

  const restoreResponse = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/content")
      && candidate.request().method() === "POST"
      && candidate.ok()
  ));
  await page.locator("#contentEditor").evaluate((textarea, value) => {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, original);
  await restoreResponse;

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("workspace tabs drag horizontally, persist their order, and do not change the active workspace", async ({ page }) => {
  await page.goto(editorUrl);
  const tabIds = () => page.locator("#tabbar .tab").evaluateAll((tabs) => tabs.map((tab) => tab.dataset.tab));
  const defaultOrder = ["node", "events", "options", "content", "stats", "graph", "validation"];
  await expect.poll(tabIds).toEqual(defaultOrder);
  await expect(page.locator('.tab[data-tab="node"]')).toHaveClass(/active/);

  // A press that never crosses the drag threshold must remain an ordinary tab click.
  await page.locator('.tab[data-tab="events"]').click();
  await expect(page.locator('.tab[data-tab="events"]')).toHaveClass(/active/);
  await page.locator('.tab[data-tab="node"]').click();
  await expect(page.locator('.tab[data-tab="node"]')).toHaveClass(/active/);

  const pressedNodeBox = await page.locator('.tab[data-tab="node"]').boundingBox();
  if (!pressedNodeBox) throw new Error("Workspace tab press geometry is unavailable");
  await page.mouse.move(pressedNodeBox.x + pressedNodeBox.width / 2, pressedNodeBox.y + pressedNodeBox.height / 2);
  await page.mouse.down();
  await expect(page.locator('.tab[data-tab="node"]')).toHaveCSS("transform", "none");
  await page.mouse.up();

  const reorderSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "graph", "events", "before", async ({ pointerX, grabOffset }) => {
    const draggedTab = page.locator('#tabbar .tab[data-tab="graph"]');
    await expect(page.locator("#tabFocusIndicator")).toHaveCSS("opacity", "0");
    await expect.poll(tabIds).toEqual(defaultOrder);
    await expect(draggedTab).toHaveCSS("transition-duration", "0s");
    const draggedBox = await draggedTab.boundingBox();
    // Fractional tab widths can round the 1:1 grab point by up to two device
    // pixels while a genuine detached preview is displaced much farther.
    expect(Math.abs((draggedBox?.x || 0) + grabOffset - pointerX)).toBeLessThan(2);
    const tabbarBox = await page.locator("#tabbar").boundingBox();
    if (!tabbarBox) throw new Error("Workspace tab bar geometry is unavailable");
    await page.mouse.move(
      pointerX,
      tabbarBox.y + 1,
      { steps: 4 },
    );
    await page.waitForTimeout(50);
    const constrainedDraggedBox = await draggedTab.boundingBox();
    expect(constrainedDraggedBox?.y).toBeGreaterThanOrEqual(tabbarBox.y);
    expect((constrainedDraggedBox?.y || 0) + (constrainedDraggedBox?.height || 0))
      .toBeLessThanOrEqual(tabbarBox.y + tabbarBox.height);
    await expect(page.locator("#tabbar .tab")).toHaveCount(defaultOrder.length);
  }, 0.9);
  await reorderSave;
  const reordered = ["node", "graph", "events", "options", "content", "stats", "validation"];
  await expect.poll(tabIds).toEqual(reordered);
  await expect(page.locator('.tab[data-tab="node"]')).toHaveClass(/active/);
  await expect(page.locator(".list-reorder-preview.is-workspace-tab-preview")).toHaveCount(0);
  await expect.poll(() => page.locator("#tabbar .tab").evaluateAll((tabs) => {
    const barRect = tabs[0]?.parentElement?.getBoundingClientRect();
    if (!barRect) return false;
    const firstRect = tabs[0].getBoundingClientRect();
    return tabs.every((tab) => {
      const rect = tab.getBoundingClientRect();
      return getComputedStyle(tab).transform === "none"
        && Math.abs(rect.top - firstRect.top) < 0.5
        && Math.abs(rect.height - firstRect.height) < 0.5
        && rect.left >= barRect.left
        && rect.right <= barRect.right;
    });
  })).toBe(true);
  await expect.poll(() => page.locator("#tabFocusIndicator").evaluate((indicator) => {
    const activeTab = indicator.parentElement?.querySelector(".tab.active");
    return activeTab
      ? [indicator.offsetLeft, indicator.offsetWidth, activeTab.offsetLeft, activeTab.offsetWidth]
      : [];
  })).toEqual(await page.locator('.tab[data-tab="node"]').evaluate((activeTab) => (
    [activeTab.offsetLeft, activeTab.offsetWidth, activeTab.offsetLeft, activeTab.offsetWidth]
  )));

  await page.reload();
  await expect(page.getByRole("navigation", { name: /編輯器分頁|Editor tabs/ })).toBeVisible();
  await expect.poll(tabIds).toEqual(reordered);

  const restoreSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "graph", "stats", "after", null, 0.1);
  await restoreSave;
  await expect.poll(tabIds).toEqual(defaultOrder);

  const activeMoveSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "node", "events", "after", null, 0.9);
  await expect(page.locator("#tabbar")).toHaveClass(/is-workspace-tab-settling/);
  await expect(page.locator("#tabFocusIndicator")).toHaveCSS("opacity", "0");
  await activeMoveSave;
  await expect(page.locator("#tabbar")).not.toHaveClass(/is-workspace-tab-settling/);
  const releaseOffsets = await sampleWorkspaceIndicatorOffsets(page);
  expect(releaseOffsets.length).toBeGreaterThan(0);
  expect(releaseOffsets.every((offset) => (
    Math.abs(offset.left) < 0.5
    && Math.abs(offset.right) < 0.5
    && Math.abs(offset.top) < 0.5
    && Math.abs(offset.bottom) < 0.5
  ))).toBe(true);
  await expect.poll(tabIds).toEqual(["events", "node", "options", "content", "stats", "graph", "validation"]);

  const activeRestoreSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "node", "events", "before", null, 0.1);
  await activeRestoreSave;
  await expect.poll(tabIds).toEqual(defaultOrder);

  const fallbackReleaseSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "validation", "graph", "before", async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        buttons: 0,
      }));
    });
    await expect(page.locator(".list-reorder-preview")).toHaveCount(0);
    await expect(page.locator('#tabbar .tab[data-tab="validation"]')).toHaveCSS("visibility", "visible");
  }, 0.8);
  await fallbackReleaseSave;
  await expect.poll(tabIds).toEqual(["node", "events", "options", "content", "stats", "validation", "graph"]);

  const fallbackRestoreSave = page.waitForResponse((candidate) => (
    candidate.url().endsWith("/api/editor-settings")
    && candidate.request().method() === "PUT"
    && candidate.ok()
  ));
  await dragWorkspaceTab(page, "validation", "graph", "after");
  await fallbackRestoreSave;
  await expect.poll(tabIds).toEqual(defaultOrder);
  await expect(page.locator("#tabbar .tab")).toHaveCount(defaultOrder.length);
  await expect.poll(() => page.locator("#tabbar .tab").evaluateAll((tabs) => tabs.every((tab) => {
    const rect = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    return style.display !== "none"
      && style.visibility === "visible"
      && Number.parseFloat(style.opacity) > 0
      && rect.width > 0
      && rect.height > 0;
  }))).toBe(true);
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
    const tabbar = document.querySelector("#tabbar");
    const targetRect = target.getBoundingClientRect();
    const tabbarRect = tabbar.getBoundingClientRect();
    const tabbarStyle = getComputedStyle(tabbar);
    return {
      activeTab: document.querySelector(".tab.active")?.dataset.tab,
      indicatorLeft: Number.parseFloat(indicator.style.left),
      pointerNavigation: document.querySelector("#tabbar").classList.contains("is-pointer-navigation"),
      targetLeft: targetRect.left
        - tabbarRect.left
        - (Number.parseFloat(tabbarStyle.borderLeftWidth) || 0)
        + tabbar.scrollLeft,
    };
  });
  expect(pressedTabState.activeTab).toBe("node");
  expect(pressedTabState.indicatorLeft).toBeCloseTo(pressedTabState.targetLeft, 3);
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

  await eventTab.click();
  const eventSectionAction = page.locator(".form-section-header .section-add-button").first();
  await expect(eventSectionAction).toBeVisible();
  const eventSectionActionStyle = await eventSectionAction.evaluate((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      borderRadius: style.borderRadius,
      fontWeight: style.fontWeight,
    };
  });
  await page.locator('.tab[data-tab="stats"]').click();
  const stateSectionAction = page.locator(".state-section-heading .state-add-button").first();
  await expect(stateSectionAction).toBeVisible();
  await expect.poll(() => stateSectionAction.evaluate((button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      borderRadius: style.borderRadius,
      fontWeight: style.fontWeight,
    };
  })).toEqual(eventSectionActionStyle);
  await page.locator('.tab[data-tab="node"]').click();

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

for (const kind of ["Event", "Node"]) {
  test(`${kind} groups support three levels, retain singletons, and lift members to the parent`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const prefix = `nested_${kind.toLowerCase()}`;
    const paths = {
      x: [], a: ["Depth", "Inside"], b: ["Depth", "Inside"], z: ["Depth"],
      w: ["Below A"], v: ["Below B"],
    };
    if (kind === "Event") {
      expect((await request.post(`${editorUrl}/api/nodes`, { data: { id: prefix, path: prefix, name: prefix } })).ok()).toBe(true);
    }
    for (const suffix of Object.keys(paths)) {
      const id = `${prefix}_${suffix}`;
      const response = kind === "Node"
        ? await request.post(`${editorUrl}/api/nodes`, { data: { id, path: id, name: id } })
        : await request.post(`${editorUrl}/api/events`, { data: {
          node: prefix, event: { ID: id, Name: id, Trigger: "Auto:Node", Priority: 5, Weight: 1,
            Once: false, Conditions: [], Effects: [], Content: null, "End up": "REDO", "Next Node": null },
        } });
      expect(response.ok()).toBe(true);
    }
    const endpoint = kind === "Node" ? "/api/node-groups" : "/api/event-groups";
    const project = kind === "Node" ? await (await request.get(editorUrl + "/api/project")).json() : null;
    const memberIds = Object.keys(paths).map((suffix) => prefix + "_" + suffix);
    expect((await request.put(editorUrl + endpoint, { data: {
      ...(kind === "Event" ? { node: prefix } : {}),
      // Keep this gesture fixture in view regardless of earlier smoke-test Nodes.
      ...(project ? { order: [...memberIds, ...project.nodes.map((node) => node.path).filter((id) => !memberIds.includes(id))] } : {}),
      assignments: Object.fromEntries(Object.entries(paths).map(([suffix, parts]) => [`${prefix}_${suffix}`, parts])),
    } })).ok()).toBe(true);
    await page.goto(editorUrl);
    await openNodeSidebar(page);
    await page.locator(`#nodeList [data-node-path="${kind === "Event" ? prefix : prefix + "_x"}"]`).click();
    if (kind === "Event") {
      await page.getByRole("button", { name: /^事件 / }).click();
      await page.locator(`[data-event-id="${prefix}_x"]`).click();
    }
    else await openNodeSidebar(page);
    const flow = page.locator(kind === "Node" ? "#nodeList" : ".event-pool-flow");
    const a = flow.locator(`[data-group-item-id="${prefix}_a"]`);
    const b = flow.locator(`[data-group-item-id="${prefix}_b"]`);
    const z = flow.locator(`[data-group-item-id="${prefix}_z"]`);
    await flow.evaluate(async (root) => {
      const animations = root.closest(".sidebar, .subnav")?.getAnimations({ subtree: true }) || [];
      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
    });
    const upperNeighbor = flow.locator('[data-group-label="Below A"]');
    const lowerNeighbor = flow.locator('[data-group-label="Below B"]');
    await upperNeighbor.locator(":scope > .event-group-header").hover();
    await expect.poll(() => upperNeighbor.locator(":scope > .event-group-items-shell").evaluate(
      (shell) => shell.getBoundingClientRect().height,
    )).toBeGreaterThan(20);
    const groupFlowTop = (group) => group.evaluate((element) => {
      const scroll = element.closest(".node-list, .subnav-list");
      return element.getBoundingClientRect().top + (scroll?.scrollTop || 0);
    });
    const lowerTop = await groupFlowTop(lowerNeighbor);
    await lowerNeighbor.locator(":scope > .event-group-header").hover();
    await page.waitForTimeout(260);
    // Browser scroll anchoring may contribute a few subpixels; a collapsed
    // source group would move this by an entire member-row height.
    expect(Math.abs(await groupFlowTop(lowerNeighbor) - lowerTop)).toBeLessThan(4);
    await expect(upperNeighbor).toHaveClass(/is-group-hover-held/);
    await expect.poll(() => lowerNeighbor.locator(":scope > .event-group-items-shell").evaluate(
      (shell) => shell.getBoundingClientRect().height,
    )).toBeGreaterThan(20);
    await page.mouse.move(900, 800);
    await expect.poll(() => upperNeighbor.evaluate((group) => group.classList.contains("is-group-hover-held"))).toBe(false);
    await flow.locator('[data-group-label="Depth"] > .event-group-header').hover();
    await flow.locator('[data-group-label="Inside"] > .event-group-header').hover();
    await a.click();
    if (kind === "Node") await openNodeSidebar(page);
    await expect(flow.locator(".is-group-editing")).toHaveCount(2);
    const saved = (action) => Promise.all([
      page.waitForResponse((response) => response.url().endsWith(endpoint) && response.request().method() === "PUT" && response.ok()),
      action(),
    ]);
    const inside = flow.locator('[data-group-label="Inside"]');
    // A floating group must retain its complete heading/frame, including when
    // a nested group leaves its ancestor's CSS context or motion is disabled.
    for (const reduced of [false, true]) {
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      for (const label of ["Depth", "Inside"]) {
        const group = flow.locator(`[data-group-label="${label}"]`);
        const handle = group.locator(":scope > .event-group-header > .group-block-drag-space");
        await handle.hover();
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 });
        const preview = page.locator(".group-drag-preview.is-group-block-preview");
        await expect(preview).toBeVisible();
        await expect.poll(() => preview.locator(":scope > .event-group > .event-group-items-shell").evaluate(
          (shell) => shell.getBoundingClientRect().height,
        )).toBeLessThan(1);
        await expect.poll(() => preview.evaluate((wrapper) => {
          const frame = wrapper.firstElementChild.getBoundingClientRect();
          const clip = wrapper.getBoundingClientRect();
          return Math.abs(frame.bottom - clip.bottom);
        })).toBeLessThan(1);
        await page.screenshot({ path: test.info().outputPath(`floating-${label}-${reduced}.png`) });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(preview).toHaveCount(0);
      }
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => inside.evaluate((group) => {
      const items = group.querySelector(":scope > .event-group-items-shell > .event-group-items");
      const last = [...items.children].filter((item) => item.matches("[data-group-item-id], [data-group-drop]")).at(-1);
      return Math.round(group.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
    })).toBe(7);
    await saved(() => dragWithDwell(page, a, b, 720, async () => {
      await expectGroupReservation(b);
      await expect(inside).not.toHaveClass(/is-group-preview-open|is-group-drop-ready/);
      const geometry = await b.evaluate((item) => {
        const rect = item.getBoundingClientRect();
        const clip = item.parentElement.getBoundingClientRect();
        return { left: rect.left - clip.left, right: clip.right - rect.right,
          bottom: clip.bottom - rect.bottom, transform: getComputedStyle(item.closest("[data-group-drop]")).transform };
      });
      expect(geometry.transform).toBe("none");
      expect(geometry.left).toBeGreaterThanOrEqual(8.9);
      expect(geometry.right).toBeGreaterThanOrEqual(8.9);
      expect(geometry.bottom).toBeGreaterThanOrEqual(51);
      await page.screenshot({ path: test.info().outputPath("nested-group-preview.png") });
    }));
    const third = flow.locator('[data-group-depth="3"]');
    await expect(third.locator("[data-group-item-id]")).toHaveCount(2);
    const name = third.locator("input").first();
    await name.fill("Inn");
    await saved(() => name.press("Enter"));
    await a.click();
    if (kind === "Node") await openNodeSidebar(page);
    await expect(flow.locator(".is-group-editing")).toHaveCount(3);
    // A fourth level must not even be suggested; the gesture can still reorder.
    await dragWithDwell(page, a, b, 600, async () => {
      await expect(b).not.toHaveClass(/is-group-ready/);
    });
    await expect(flow.locator('[data-group-depth="4"]')).toHaveCount(0);
    await saved(() => dragToLiveTarget(page, `[data-group-item-id="${prefix}_a"]`, `[data-group-item-id="${prefix}_z"]`));
    await expect(a).toHaveAttribute("data-group-item-group", JSON.stringify(["Depth"]));
    await expect(third.locator("[data-group-item-id]")).toHaveCount(1);
    await reloadAndWaitForProject(page);
    await openNodeSidebar(page);
    if (kind === "Event") {
      await page.locator(`#nodeList [data-node-path="${prefix}"]`).click();
      await page.getByRole("button", { name: /^事件 / }).click();
    }
    await expect(third.locator("[data-group-item-id]")).toHaveCount(1);
    // Reveal the remaining member, then lift it too: now the empty ancestors disappear.
    await flow.locator('[data-group-label="Depth"] > .event-group-header').hover();
    await flow.locator('[data-group-label="Inside"] > .event-group-header').hover();
    await third.locator(".event-group-header").hover();
    await saved(() => dragToLiveTarget(page, `[data-group-item-id="${prefix}_b"]`, `[data-group-item-id="${prefix}_a"]`));
    await expect(b).toHaveAttribute("data-group-item-group", JSON.stringify(["Depth"]));
    await expect(flow.locator('[data-group-depth="3"]')).toHaveCount(0);
    await expect(flow.locator('[data-group-label="Inside"]')).toHaveCount(0);
    // Move a two-level subtree into another group, retaining its descendant path.
    expect((await request.put(editorUrl + endpoint, { data: {
      ...(kind === "Event" ? { node: prefix } : {}),
      assignments: { [prefix + "_b"]: ["Inn", "Room"] },
    } })).ok()).toBe(true);
    await reloadAndWaitForProject(page);
    await openNodeSidebar(page);
    if (kind === "Event") {
      await page.locator(`#nodeList [data-node-path="${prefix}"]`).click();
      await page.getByRole("button", { name: /^事件 / }).click();
    }
    await saved(() => dragWithDwell(page,
      flow.locator('[data-group-label="Inn"] > .event-group-header > .group-block-drag-space'),
      flow.locator('[data-group-label="Depth"] > .event-group-header')));
    await expect(b).toHaveAttribute("data-group-item-group", JSON.stringify(["Depth", "Inn", "Room"]));
    await expect(flow.locator('[data-group-depth="3"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
