"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createAutosaveCoordinator } = require("../../EDITOR/static/js/core/autosave_coordinator.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function harness({ enabled = true } = {}) {
  let nextTimer = 1;
  const timers = new Map();
  const states = [];
  const failures = [];
  const settings = { enabled };
  const coordinator = createAutosaveCoordinator({
    isEnabled: () => settings.enabled,
    getDelay: () => 10,
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onState: (message, kind, detail) => states.push({ message, kind, detail }),
    onFailure: (label, error) => failures.push({ label, error }),
  });
  return { coordinator, failures, settings, states, timers };
}

test("a newer edit makes an in-flight snapshot stale and only the newest snapshot becomes current", async () => {
  const { coordinator, states } = harness();
  const firstRequest = deferred();
  const saved = [];

  const firstTask = coordinator.schedule("first", async (task) => {
    await firstRequest.promise;
    saved.push({ name: "first", current: coordinator.isCurrent(task) });
  });
  const firstRun = coordinator.run();
  const secondTask = coordinator.schedule("second", async (task) => {
    saved.push({ name: "second", current: coordinator.isCurrent(task) });
  });

  assert.equal(coordinator.isCurrent(firstTask), false);
  assert.equal(coordinator.isCurrent(secondTask), true);
  firstRequest.resolve();
  assert.equal(await firstRun, true);
  assert.equal(await coordinator.flush(), true);
  assert.deepEqual(saved, [
    { name: "first", current: false },
    { name: "second", current: true },
  ]);
  assert.equal(states.at(-1).message, "已自動儲存");
});

test("flush waits for the latest save before navigation continues", async () => {
  const { coordinator } = harness();
  const request = deferred();
  const order = [];

  coordinator.schedule("node", async () => {
    order.push("save-start");
    await request.promise;
    order.push("save-end");
  });
  const navigation = coordinator.flush().then((saved) => {
    assert.equal(saved, true);
    order.push("navigate");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["save-start"]);
  request.resolve();
  await navigation;
  assert.deepEqual(order, ["save-start", "save-end", "navigate"]);
});

test("a non-network save failure blocks navigation and is reported once", async () => {
  const { coordinator, failures } = harness();
  coordinator.schedule("event", async () => {
    throw new Error("invalid event");
  });

  assert.equal(await coordinator.flush(), false);
  assert.equal(await coordinator.flush(), false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].label, "event");
  assert.equal(coordinator.hasUnsaved(), true);
});

test("flush retries a network failure immediately without duplicating its notification", async () => {
  const { coordinator, failures } = harness();
  let attempts = 0;
  coordinator.schedule("content", async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("offline");
      error.code = "NETWORK_ERROR";
      throw error;
    }
  });

  assert.equal(await coordinator.run(), false);
  assert.equal(await coordinator.flush(), true);
  assert.equal(attempts, 2);
  assert.equal(failures.length, 1);
  assert.equal(coordinator.hasUnsaved(), false);
});

test("cancelAndWait drops a queued snapshot before deletion", async () => {
  const { coordinator } = harness();
  let writes = 0;
  coordinator.schedule("content", async () => { writes += 1; });

  await coordinator.cancelAndWait();

  assert.equal(writes, 0);
  assert.equal(coordinator.hasPending(), false);
  assert.equal(coordinator.hasUnsaved(), false);
});

test("cancelAndWait waits for an in-flight snapshot and marks it stale before deletion", async () => {
  const { coordinator } = harness();
  const request = deferred();
  let task;
  task = coordinator.schedule("node", async () => {
    await request.promise;
    assert.equal(coordinator.isCurrent(task), false);
  });
  void coordinator.run();

  let deletionReady = false;
  const cancellation = coordinator.cancelAndWait().then(() => { deletionReady = true; });
  await Promise.resolve();
  assert.equal(deletionReady, false);
  request.resolve();
  await cancellation;
  assert.equal(deletionReady, true);
  assert.equal(coordinator.hasUnsaved(), false);
});

test("disabled autosave preserves a pending edit until autosave is enabled", async () => {
  const { coordinator, settings } = harness({ enabled: false });
  let writes = 0;
  coordinator.schedule("stats", async () => { writes += 1; });

  assert.equal(await coordinator.flush(), true);
  assert.equal(writes, 0);
  assert.equal(coordinator.hasUnsaved(), true);

  settings.enabled = true;
  assert.equal(await coordinator.runPendingIfEnabled(), true);
  assert.equal(writes, 1);
  assert.equal(coordinator.hasUnsaved(), false);
});

test("an explicit undo flush can commit a pending snapshot while autosave is disabled", async () => {
  const { coordinator } = harness({ enabled: false });
  let writes = 0;
  coordinator.schedule("options", async () => { writes += 1; });

  assert.equal(await coordinator.flush({ force: true }), true);
  assert.equal(writes, 1);
  assert.equal(coordinator.hasUnsaved(), false);
});
