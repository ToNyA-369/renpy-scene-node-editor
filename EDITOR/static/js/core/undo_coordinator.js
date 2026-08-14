"use strict";

(function exposeUndoCoordinator(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneUndo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function isNativeUndoTarget(target) {
    if (!target?.closest) return false;
    if (target.closest("[contenteditable='true'], .monaco-editor")) return true;
    const field = target.closest("input, textarea");
    if (!field) return false;
    if (field.tagName === "TEXTAREA") return true;
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(field.type);
  }

  function createUndoCoordinator({ flush, hasUnsaved, requestUndo, refresh, onState, onError }) {
    let running = false;

    async function undo() {
      if (running) return false;
      running = true;
      try {
        const flushed = await flush();
        if (!flushed || hasUnsaved()) throw new Error("儲存失敗");
        onState("返回上一步中...", "saving");
        await requestUndo();
        await refresh();
        onState("已返回上一步");
        return true;
      } catch (error) {
        onState("返回上一步失敗", "error", error?.message || "");
        onError(error);
        return false;
      } finally {
        running = false;
      }
    }

    return { isRunning: () => running, undo };
  }

  return { createUndoCoordinator, isNativeUndoTarget };
});
