"use strict";

(function exposeAutosaveCoordinator(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneAutosave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function createAutosaveCoordinator(options = {}) {
    const isEnabled = options.isEnabled || (() => true);
    const getDelay = options.getDelay || (() => 700);
    const setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
    const clearTimer = options.clearTimer || ((timer) => clearTimeout(timer));
    const onState = options.onState || (() => {});
    const onFailure = options.onFailure || (() => {});
    const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 3000;

    let saveTimer = null;
    let retryTimer = null;
    let pending = null;
    let failed = null;
    let queuedCount = 0;
    let revision = 0;
    let inFlight = Promise.resolve(true);

    const clearSaveTimer = () => {
      if (saveTimer !== null) clearTimer(saveTimer);
      saveTimer = null;
    };

    const clearRetryTimer = () => {
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
    };

    const setState = (message, kind = "", detail = "") => onState(message, kind, detail);

    function isCurrent(task) {
      return Boolean(task && task.revision === revision);
    }

    function hasPending() {
      return Boolean(pending);
    }

    function hasUnsaved() {
      return Boolean(pending || failed || queuedCount > 0);
    }

    function discard() {
      revision += 1;
      clearSaveTimer();
      clearRetryTimer();
      pending = null;
      failed = null;
    }

    async function cancelAndWait() {
      discard();
      await inFlight;
      discard();
    }

    function scheduleRun(delay = getDelay()) {
      clearSaveTimer();
      saveTimer = setTimer(() => {
        saveTimer = null;
        void run();
      }, delay);
    }

    function schedule(label, persist) {
      pending = { label, persist, revision: ++revision };
      failed = null;
      clearSaveTimer();
      clearRetryTimer();
      setState(isEnabled() ? "等待自動儲存" : "尚未儲存", "saving");
      if (isEnabled()) scheduleRun();
      return pending;
    }

    function retry() {
      if (!isEnabled() || pending || !failed?.retryable) return false;
      const task = failed;
      failed = null;
      pending = task;
      setState("重新連線中", "saving");
      void run();
      return true;
    }

    function scheduleRetry() {
      clearRetryTimer();
      retryTimer = setTimer(() => {
        retryTimer = null;
        retry();
      }, retryDelay);
    }

    async function run() {
      if (!pending || !isEnabled()) return true;
      clearSaveTimer();
      const task = pending;
      pending = null;
      setState("自動儲存中", "saving");
      queuedCount += 1;
      inFlight = inFlight.then(async () => {
        try {
          await task.persist(task);
          return true;
        } catch (error) {
          if (!isCurrent(task)) return true;
          const connectionLost = error?.code === "NETWORK_ERROR";
          task.retryable = connectionLost;
          if (!pending) failed = task;
          setState(connectionLost ? "連線中斷・重試中" : "自動儲存失敗", "error", error?.message || "");
          if (!task.failureNotified) {
            onFailure(task.label, error);
            task.failureNotified = true;
          }
          if (connectionLost && !pending) scheduleRetry();
          return false;
        } finally {
          queuedCount = Math.max(0, queuedCount - 1);
        }
      });

      const succeeded = await inFlight;
      if (!isCurrent(task)) {
        if (pending && isEnabled() && saveTimer === null) scheduleRun();
        return true;
      }
      if (pending && isEnabled()) {
        scheduleRun();
        setState("等待自動儲存", "saving");
      } else if (succeeded) {
        setState("已自動儲存");
      }
      return succeeded;
    }

    async function flush() {
      if (!isEnabled()) return true;
      if (!pending && failed?.retryable) {
        clearRetryTimer();
        pending = failed;
        failed = null;
      }
      if (!pending && failed) return false;
      while (pending) {
        if (!await run()) return false;
      }
      return Boolean(await inFlight) && !failed;
    }

    function runPendingIfEnabled() {
      if (!isEnabled() || !pending) return Promise.resolve(true);
      return run();
    }

    return {
      cancelAndWait,
      discard,
      flush,
      hasPending,
      hasUnsaved,
      isCurrent,
      retry,
      run,
      runPendingIfEnabled,
      schedule,
      waitForInFlight: () => inFlight,
    };
  }

  return { createAutosaveCoordinator };
});
