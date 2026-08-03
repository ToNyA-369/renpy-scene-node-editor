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

async function changeSelect(scope, name, value) {
  await scope.locator(`select[name="${name}"]`).selectOption(value, { force: true });
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

  await page.goto(editorUrl);
  await expect(page.getByRole("navigation", { name: "編輯器分頁" })).toBeVisible();

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

  await changeSelect(page, "EndUp", "REPLACE");
  await expect(page.locator('select[name="EndUp"]')).toHaveValue("REPLACE");
  await expect(page.locator('select[name="nextWeightedId"]')).toHaveCount(1);

  await waitForEventSave(page, async () => {
    await page.getByRole("textbox", { name: "Name" }).fill(SAVED_EVENT_NAME);
  });
  await page.reload();
  await page.getByRole("button", { name: /^事件 / }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) }).click();

  await expect(page.locator('select[name="EndUp"]')).toHaveValue("REPLACE");
  await expect(page.locator('.condition-row[data-condition-type="memory"] select[name="conditionBank"]')).toHaveValue("test_session");
  await expect(page.locator('.condition-row[data-condition-type="memory"] input[name="conditionId"]')).toHaveValue("smoke_not_seen");
  await expect(page.locator('.condition-row[data-condition-type="memory"] select[name="conditionOp"]')).toHaveValue("not_has");
  await expect(page.locator('.effect-row[data-index="1"][data-effect-type="memory"] select[name="effectOp"]')).toHaveValue("clear");

  await page.locator('[data-remove-condition="0"]').click();
  await expect(page.locator(".condition-row")).toHaveCount(0);
  await page.locator('[data-remove-effect="1"]').click();
  await expect(page.locator(".effect-row")).toHaveCount(1);
  await waitForEventSave(page, async () => {
    await changeSelect(page, "EndUp", "GOTO");
  });
  await page.reload();
  await page.getByRole("button", { name: /^事件 / }).click();
  await page.getByRole("button", { name: new RegExp(`^${SAVED_EVENT_NAME} `) }).click();
  await expect(page.locator(".condition-row")).toHaveCount(0);
  await expect(page.locator(".effect-row")).toHaveCount(1);
  await expect(page.locator('select[name="EndUp"]')).toHaveValue("GOTO");

  await page.getByRole("button", { name: "關聯圖" }).click();
  await expect(page.locator("#projectGraphSvg")).toBeVisible();
  await expect(page.locator(".graph-edge.is-replace")).toHaveCount(1);
  await expect(page.locator(".graph-edge.is-management")).toHaveCount(1);

  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});
